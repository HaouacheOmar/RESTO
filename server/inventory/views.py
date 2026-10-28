from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.api import RoleViewSet, User
from config.lists import ScopedListMixin
from realtime.api import broadcast

from .models import Ingredient, StockRequest, Supplier
from .serializers import IngredientSerializer, StockRequestSerializer, SupplierSerializer

R = User.Role


class SupplierViewSet(RoleViewSet):
    queryset = Supplier.objects.order_by('name')
    serializer_class = SupplierSerializer


class IngredientViewSet(RoleViewSet):
    queryset = Ingredient.objects.prefetch_related('dishes')
    serializer_class = IngredientSerializer
    read_roles = write_roles = (R.STOCK_MANAGER,)

    def perform_update(self, serializer):
        was_out = serializer.instance.is_out_of_stock
        ingredient = serializer.save()
        if ingredient.is_out_of_stock != was_out:
            broadcast('manager', 'rupture_started' if ingredient.is_out_of_stock else 'rupture_ended', serializer.data)


class StockRequestViewSet(ScopedListMixin, RoleViewSet):
    queryset = StockRequest.objects.select_related('ingredient', 'supplier')
    serializer_class = StockRequestSerializer
    http_method_names = ['get', 'post']
    read_roles = (R.STOCK_MANAGER,)
    action_roles = {'create': (R.STOCK_MANAGER,)}

    def active_filter(self):  # waiting for the manager or for the supplier
        return Q(status__in=[StockRequest.Status.PENDING, StockRequest.Status.APPROVED])

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
