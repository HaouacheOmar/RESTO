from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import AUTHENTICATED, PUBLIC, RoleViewSet
from service.events import broadcast
from service.models import Seance

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
        return RestaurantTable.objects.annotate(is_occupied=Exists(
            Seance.objects.filter(table=OuterRef('pk'), status=Seance.Status.OPEN)))


class DishViewSet(RoleViewSet):
    """The Carte. Public read; `?orderable=1` keeps only Plats disponibles."""
    serializer_class = DishSerializer
    read_roles = PUBLIC

    def get_queryset(self):
        qs = Dish.objects.prefetch_related('ingredients')
        return qs.orderable() if self.request.query_params.get('orderable') else qs


class DailySpecialViewSet(RoleViewSet):
    """Plat du jour: the Chef creates one per date and withdraws it (`is_available=false`) when sold out."""
    queryset = DailySpecial.objects.all()
    serializer_class = DailySpecialSerializer
    read_roles = PUBLIC
    write_roles = (R.CHEF,)


class MenuView(APIView):
    """Menu = what can be ordered today: orderable Carte dishes + today's Plat du jour."""
    permission_classes = [AllowAny]

    def get(self, request):
        special = todays_special()
        return Response({
            'carte': DishSerializer(Dish.objects.orderable().prefetch_related('ingredients'), many=True,
                                    context={'request': request}).data,
            'plat_du_jour': DailySpecialSerializer(special, context={'request': request}).data if special else None,
        })


class IngredientViewSet(RoleViewSet):
    """Only the stock manager starts and ends a Rupture (`is_out_of_stock`)."""
    queryset = Ingredient.objects.all()
    serializer_class = IngredientSerializer
    read_roles = write_roles = (R.STOCK_MANAGER,)

    def perform_update(self, serializer):
        was_out = serializer.instance.is_out_of_stock
        ingredient = serializer.save()
        if ingredient.is_out_of_stock != was_out:
            broadcast('manager', 'rupture_started' if ingredient.is_out_of_stock else 'rupture_ended', serializer.data)


class StockRequestViewSet(RoleViewSet):
    """Stock manager files Demandes de réapprovisionnement; the manager approves (choosing a supplier), then fulfils."""
    queryset = StockRequest.objects.select_related('ingredient')
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
        return Response(self.get_serializer(stock_request).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def approve(self, request, pk=None):
        supplier = Supplier.objects.filter(pk=request.data.get('supplier'),
                                           category=Supplier.Category.INGREDIENTS).first()
        if supplier is None:
            raise ValidationError({'supplier': 'Choisir un fournisseur d’ingrédients.'})
        return self._move(StockRequest.Status.PENDING, StockRequest.Status.APPROVED, supplier=supplier)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def fulfill(self, request, pk=None):
        return self._move(StockRequest.Status.APPROVED, StockRequest.Status.FULFILLED)
