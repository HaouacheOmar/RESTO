from django.db import transaction
from django.db.models import Avg, Count, Exists, IntegerField, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import AUTHENTICATED, PUBLIC, RoleViewSet
from service.events import broadcast
from service.models import Order, OrderItem, Reservation, Review, Seance

from .models import DailySpecial, Dish, Ingredient, RestaurantTable, StockRequest, Supplier
from .serializers import (DailySpecialSerializer, DishSerializer, IngredientSerializer, RestaurantTableSerializer,
                          StockRequestSerializer, SupplierSerializer)

R = User.Role


def todays_special():
    return DailySpecial.objects.filter(date=timezone.localdate(), is_available=True).first()


class SupplierViewSet(RoleViewSet):
    queryset = Supplier.objects.order_by('name')
    serializer_class = SupplierSerializer


class RestaurantTableViewSet(RoleViewSet):
    serializer_class = RestaurantTableSerializer
    read_roles = AUTHENTICATED

    def get_queryset(self):
        blocking = Reservation.blocking_walk_ins(timezone.now()).filter(table=OuterRef('pk')).order_by('reservation_time')
        return RestaurantTable.objects.annotate(
            is_occupied=Exists(Seance.objects.filter(table=OuterRef('pk'), status=Seance.Status.OPEN)),
            reserved_at=Subquery(blocking.values('reservation_time')[:1]),
        )


class DishViewSet(RoleViewSet):
    serializer_class = DishSerializer
    read_roles = PUBLIC

    def get_queryset(self):
        qs = Dish.objects.prefetch_related('ingredients')
        return qs.orderable() if self.request.query_params.get('orderable') else qs


class DailySpecialViewSet(RoleViewSet):
    """Plat du jour: the Chef creates one per date (today or later) and withdraws it when sold out.

    Each entry also reports how many were sold and its average rating (subqueries, so the two never multiply).
    """
    serializer_class = DailySpecialSerializer
    read_roles = PUBLIC
    write_roles = (R.CHEF,)

    def get_queryset(self):
        sold = (OrderItem.objects.filter(daily_special=OuterRef('pk'),
                                         order__status__in=[Order.Status.PAID, Order.Status.DELIVERED])
                .values('daily_special').annotate(n=Sum('quantity')).values('n'))
        reviews = Review.objects.filter(daily_special=OuterRef('pk')).values('daily_special')
        return DailySpecial.objects.annotate(
            sold=Coalesce(Subquery(sold, output_field=IntegerField()), 0),
            rating=Subquery(reviews.annotate(a=Avg('rating')).values('a')),
            rating_count=Coalesce(Subquery(reviews.annotate(c=Count('id')).values('c'), output_field=IntegerField()), 0),
        )

    def perform_destroy(self, instance):
        try:
            super().perform_destroy(instance)
        except ValidationError:
            raise ValidationError('Ce plat a déjà été commandé : retirez-le du menu plutôt que de le supprimer.')


class MenuView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=inline_serializer('Menu', {
        'carte': DishSerializer(many=True), 'plat_du_jour': DailySpecialSerializer(allow_null=True)}))
    def get(self, request):
        special = todays_special()
        return Response({
            'carte': DishSerializer(Dish.objects.orderable().prefetch_related('ingredients'), many=True,
                                    context={'request': request}).data,
            'plat_du_jour': DailySpecialSerializer(special, context={'request': request}).data if special else None,
        })


class IngredientViewSet(RoleViewSet):
    queryset = Ingredient.objects.prefetch_related('dishes')
    serializer_class = IngredientSerializer
    read_roles = write_roles = (R.STOCK_MANAGER,)

    def perform_update(self, serializer):
        was_out = serializer.instance.is_out_of_stock
        ingredient = serializer.save()
        if ingredient.is_out_of_stock != was_out:
            broadcast('manager', 'rupture_started' if ingredient.is_out_of_stock else 'rupture_ended', serializer.data)


class StockRequestViewSet(RoleViewSet):
    queryset = StockRequest.objects.select_related('ingredient', 'supplier')
    serializer_class = StockRequestSerializer
    http_method_names = ['get', 'post']
    read_roles = (R.STOCK_MANAGER,)
    action_roles = {'create': (R.STOCK_MANAGER,)}

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)
        broadcast('manager', 'stock_request_created', serializer.data)

    def _move(self, expected, new, **fields):
        stock_request = StockRequest.objects.select_for_update().get(pk=self.get_object().pk)
        if stock_request.status != expected:
            raise ValidationError(f'Statut actuel : {stock_request.status}, attendu : {expected}.')
        for name, value in {'status': new, **fields}.items():
            setattr(stock_request, name, value)
        stock_request.save()
        data = self.get_serializer(stock_request).data
        if stock_request.requested_by_id:  # the stock manager follows their request
            broadcast(f'user_{stock_request.requested_by_id}', 'stock_request_updated', data)
        return Response(data)

    @extend_schema(request=inline_serializer('SupplierChoice', {'supplier': serializers.IntegerField()}))
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def approve(self, request, pk=None):
        supplier = Supplier.objects.filter(pk=request.data.get('supplier'),
                                           category=Supplier.Category.INGREDIENTS).first()
        if supplier is None:
            raise ValidationError({'supplier': 'Choisir un fournisseur d’ingrédients.'})
        return self._move(StockRequest.Status.PENDING, StockRequest.Status.APPROVED, supplier=supplier)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def fulfill(self, request, pk=None):
        return self._move(StockRequest.Status.APPROVED, StockRequest.Status.FULFILLED)
