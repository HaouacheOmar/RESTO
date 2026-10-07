from django.db import transaction
from django.db.models import Avg, Count, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import AUTHENTICATED, HasRole, ReadOnlyRoleViewSet, RoleViewSet
from catalog.models import Ingredient, RestaurantTable, StockRequest

from .events import broadcast
from .models import Addition, Order, OrderItem, Reservation, Review, Seance
from .serializers import (AdditionSerializer, OrderSerializer, ReservationSerializer, ReviewSerializer,
                          SeanceSerializer)

R = User.Role
RS = Reservation.Status


def _lock(model, pk, *statuses):
    """Row-lock an object and check it is in one of the expected statuses (call inside transaction.atomic)."""
    obj = model.objects.select_for_update().filter(pk=pk).first()
    if obj is None:
        raise ValidationError('Introuvable.')
    if obj.status not in statuses:
        raise ValidationError(f'Statut actuel : {obj.status}, attendu : {" ou ".join(statuses)}.')
    return obj


def _method(request):
    method = request.data.get('method', Addition.Method.CASH)
    if method not in Addition.Method.values:
        raise ValidationError({'method': f'Choix possibles : {Addition.Method.values}.'})
    return method


class ReservationViewSet(RoleViewSet):
    """Client books → parking attendant secures or refuses a spot → reservation manager confirms → check-in."""
    serializer_class = ReservationSerializer
    http_method_names = ['get', 'post']
    read_roles = AUTHENTICATED
    action_roles = {
        'create': (R.CLIENT,),
        'cancel': (R.CLIENT,),
        'confirm_parking': (R.PARKING_ATTENDANT,),
        'refuse_parking': (R.PARKING_ATTENDANT,),
        'confirm': (R.RESERVATION_MANAGER,),
        'reassign_table': (R.RESERVATION_MANAGER,),
        'check_in': (R.RESERVATION_MANAGER,),
        'no_show': (R.RESERVATION_MANAGER,),
    }

    def get_queryset(self):
        qs = Reservation.objects.select_related('client', 'table')
        user = self.request.user
        if self.role == R.CLIENT:
            qs = qs.filter(client=user)
        elif self.role == R.PARKING_ATTENDANT:
            qs = qs.filter(has_vehicle=True)
        elif self.role not in (R.ADMIN_MANAGER, R.RESERVATION_MANAGER):
            return qs.none()
        if status := self.request.query_params.get('status'):
            qs = qs.filter(status=status)
        return qs

    def perform_create(self, serializer):
        reservation = serializer.save(client=self.request.user)
        broadcast('reservations', 'reservation_created', serializer.data)
        if reservation.has_vehicle:
            broadcast('parking', 'parking_requested', serializer.data)

    def _respond(self, reservation, event):
        data = self.get_serializer(reservation).data
        broadcast(f'user_{reservation.client_id}', event, data)
        broadcast('reservations', event, data)
        return Response(data)

    def _set(self, reservation, event, **fields):
        for name, value in fields.items():
            setattr(reservation, name, value)
        reservation.save(update_fields=list(fields))
        return self._respond(reservation, event)

    def _table(self, reservation, number, guest_count, now=False):
        """A table that fits the (possibly corrected) party, in the requested zone, free for the reservation slot."""
        tables = Reservation.free_tables(reservation.zone, guest_count, reservation.reservation_time, exclude=reservation)
        if now:  # check-in: must also be physically free
            tables = tables.exclude(seances__status=Seance.Status.OPEN)
        table = tables.filter(number=number).first() if number is not None else tables.first()
        if table is None:
            raise ValidationError({'table': 'Aucune table libre de cette zone pour ce nombre de personnes.'})
        return table

    @extend_schema(request=inline_serializer('ParkingSpot', {'parking_spot': serializers.CharField()}))
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def confirm_parking(self, request, pk=None):
        reservation = _lock(Reservation, self.get_object().pk, RS.PENDING, RS.CONFIRMED)
        spot = str(request.data.get('parking_spot', '')).strip()
        if reservation.parking_status != Reservation.Parking.REQUESTED or not spot:
            raise ValidationError('Pas de demande de parking en attente, ou place non précisée.')
        if Reservation.overlapping(reservation.reservation_time).filter(
                parking_spot=spot).exclude(pk=reservation.pk).exists():
            raise ValidationError(f'La place {spot} est déjà prise sur ce créneau.')
        return self._set(reservation, 'parking_confirmed', parking_status=Reservation.Parking.SECURED,
                         parking_spot=spot)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def refuse_parking(self, request, pk=None):
        reservation = _lock(Reservation, self.get_object().pk, RS.PENDING, RS.CONFIRMED)
        if reservation.parking_status != Reservation.Parking.REQUESTED:
            raise ValidationError('Pas de demande de parking en attente.')
        return self._set(reservation, 'parking_refused', parking_status=Reservation.Parking.REFUSED)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def confirm(self, request, pk=None):
        reservation = _lock(Reservation, self.get_object().pk, RS.PENDING)
        return self._set(reservation, 'reservation_confirmed', status=RS.CONFIRMED)

    @extend_schema(request=inline_serializer('TableChoice', {'table_number': serializers.IntegerField()}))
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def reassign_table(self, request, pk=None):
        """Replace the proposed table by another one of the same zone (body: `table_number`)."""
        reservation = _lock(Reservation, self.get_object().pk, RS.PENDING, RS.CONFIRMED)
        if request.data.get('table_number') is None:
            raise ValidationError({'table_number': 'Préciser la nouvelle table.'})
        table = self._table(reservation, request.data['table_number'], reservation.guest_count)
        return self._set(reservation, 'table_reassigned', table=table)

    @extend_schema(request=inline_serializer('CheckIn', {'guest_count': serializers.IntegerField(required=False), 'table_number': serializers.IntegerField(required=False)}))
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def check_in(self, request, pk=None):
        """Seat the client and open the Séance. Optional body: corrected `guest_count`, chosen `table_number`."""
        reservation = _lock(Reservation, self.get_object().pk, RS.CONFIRMED)
        try:
            guests = int(request.data.get('guest_count') or reservation.guest_count)
        except (TypeError, ValueError):
            guests = 0
        if guests < 1:
            raise ValidationError({'guest_count': 'Nombre de personnes invalide.'})
        list(RestaurantTable.objects.select_for_update().filter(zone=reservation.zone))
        number = request.data.get('table_number')
        if number is None and reservation.table and guests <= reservation.table.capacity:
            number = reservation.table.number  # keep the proposed table when it still fits
        table = self._table(reservation, number, guests, now=True)
        seance = Seance.objects.create(table=table, reservation=reservation,
                                       name=reservation.client.get_full_name() or reservation.client.username)
        broadcast('kitchen_pos', 'seance_opened', SeanceSerializer(seance).data)
        return self._set(reservation, 'checked_in', status=RS.CHECKED_IN, guest_count=guests, table=table)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def no_show(self, request, pk=None):
        reservation = _lock(Reservation, self.get_object().pk, RS.PENDING, RS.CONFIRMED)
        if reservation.reservation_time > timezone.now():
            raise ValidationError('L’heure de réservation n’est pas encore passée.')
        return self._set(reservation, 'reservation_no_show', status=RS.NO_SHOW)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def cancel(self, request, pk=None):
        reservation = _lock(Reservation, self.get_object().pk, RS.PENDING, RS.CONFIRMED)  # clients see only theirs
        return self._set(reservation, 'reservation_cancelled', status=RS.CANCELLED)


class SeanceViewSet(ReadOnlyRoleViewSet):
    """Séances open via check-in or a server's first order on a free table; they end by `pay` or `close`."""
    serializer_class = SeanceSerializer
    read_roles = (R.CASHIER, R.SERVER, R.RESERVATION_MANAGER)
    action_roles = {'pay': (R.CASHIER,), 'close': (R.SERVER, R.RESERVATION_MANAGER)}

    def get_queryset(self):
        qs = Seance.objects.select_related('table', 'reservation__client').prefetch_related('orders__items')
        if status := self.request.query_params.get('status'):
            qs = qs.filter(status=status)
        return qs

    def _end(self, seance, status):
        seance.status, seance.closed_at = status, timezone.now()
        seance.save(update_fields=['status', 'closed_at'])
        if seance.reservation:
            seance.reservation.status = RS.DONE
            seance.reservation.save(update_fields=['status'])
        broadcast('kitchen_pos', 'seance_closed', {'seance': seance.pk, 'table_number': seance.table.number})

    @extend_schema(request=inline_serializer('Payment', {'method': serializers.ChoiceField(Addition.Method.choices, required=False)}), responses=AdditionSerializer)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def pay(self, request, pk=None):
        """Cashier collects the Addition: every pending order of the Séance, one payment, then the table is free."""
        seance = _lock(Seance, self.get_object().pk, Seance.Status.OPEN)
        orders = list(seance.orders.select_for_update().filter(status=Order.Status.PENDING))
        if not orders:
            raise ValidationError('Aucune commande à encaisser : clore la Séance à la place.')
        addition = Addition.objects.create(seance=seance, client=seance.client, collected_by=request.user,
                                           amount=sum(o.total for o in orders), method=_method(request))
        Order.objects.filter(pk__in=[o.pk for o in orders]).update(status=Order.Status.PAID, addition=addition)
        self._end(seance, Seance.Status.PAID)
        data = AdditionSerializer(addition).data
        broadcast('manager', 'addition_paid', data)
        return Response(data)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def close(self, request, pk=None):
        """Close a Séance where nobody ordered (left without ordering, opened by mistake)."""
        seance = _lock(Seance, self.get_object().pk, Seance.Status.OPEN)
        if seance.orders.exclude(status=Order.Status.CANCELLED).exists():
            raise ValidationError('La Séance a des commandes : encaisser l’Addition.')
        self._end(seance, Seance.Status.CLOSED)
        return Response(self.get_serializer(seance).data)


class AdditionViewSet(ReadOnlyRoleViewSet):
    serializer_class = AdditionSerializer
    read_roles = (R.CASHIER, R.CLIENT)
    action_roles = {'ticket': (R.CASHIER, R.SERVER)}

    def get_queryset(self):
        qs = Addition.objects.select_related('seance__table').prefetch_related(
            'orders__items__dish', 'orders__items__daily_special', 'orders__server', 'orders__deliverer', 'reviews')
        user = self.request.user
        return qs.filter(client=user) if self.role == R.CLIENT else qs

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True)
    def ticket(self, request, pk=None):
        addition = self.get_object()
        seance = addition.seance
        client = addition.client
        lines = OrderItem.objects.filter(order__addition=addition).select_related('dish', 'daily_special')
        return Response({
            'addition': addition.pk,
            'name': seance.name if seance else (client.get_full_name() or client.username if client else None),
            'date': addition.created_at,
            'table_number': seance.table.number if seance else None,
            'items': [{'name': i.name, 'quantity': i.quantity, 'unit_price': i.unit_price,
                       'subtotal': i.unit_price * i.quantity} for i in lines],
            'total': addition.amount,
            'method': addition.method,
        })


class OrderViewSet(RoleViewSet):
    """Commandes: dine-in (server, inside a Séance) and Livraison (client → reservation manager → deliverer)."""
    serializer_class = OrderSerializer
    http_method_names = ['get', 'post']
    read_roles = AUTHENTICATED
    action_roles = {
        'create': (R.SERVER, R.CLIENT),
        'cancel': (R.SERVER, R.CLIENT),
        'assign_deliverer': (R.RESERVATION_MANAGER,),
        'deliver': (R.DELIVERER,),
        'fail': (R.DELIVERER,),
    }

    def get_queryset(self):
        qs = Order.objects.select_related('client', 'seance__table').prefetch_related(
            'items__dish', 'items__daily_special')
        user = self.request.user
        if self.role == R.CLIENT:
            qs = qs.filter(client=user, is_delivery=True)
        elif self.role == R.DELIVERER:
            qs = qs.filter(deliverer=user)
        elif self.role in (R.PARKING_ATTENDANT, R.STOCK_MANAGER, R.CHEF):
            return qs.none()
        if status := self.request.query_params.get('status'):
            qs = qs.filter(status=status)
        if (delivery := self.request.query_params.get('is_delivery')) is not None:
            qs = qs.filter(is_delivery=delivery in ('1', 'true', 'True'))
        return qs

    def perform_create(self, serializer):
        order = serializer.save()
        if getattr(serializer, 'opened_seance', False):
            broadcast('kitchen_pos', 'seance_opened', SeanceSerializer(order.seance).data)
        broadcast('deliveries' if order.is_delivery else 'kitchen_pos', 'order_created', serializer.data)

    def _deliverer_back(self, order):
        User.objects.filter(pk=order.deliverer_id).update(availability=User.Availability.AVAILABLE)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def cancel(self, request, pk=None):
        """Whole order only: a server before the Addition is paid, a client while no deliverer is assigned."""
        order = _lock(Order, self.get_object().pk, Order.Status.PENDING)
        if order.is_delivery != (request.user.role == R.CLIENT):
            raise PermissionDenied('Le serveur annule en salle, le client annule sa livraison.')
        order.status = Order.Status.CANCELLED
        order.save(update_fields=['status'])
        data = self.get_serializer(order).data
        broadcast('deliveries' if order.is_delivery else 'kitchen_pos', 'order_cancelled', data)
        return Response(data)

    @extend_schema(request=inline_serializer('DelivererChoice', {'deliverer': serializers.IntegerField()}))
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign_deliverer(self, request, pk=None):
        order = _lock(Order, self.get_object().pk, Order.Status.PENDING)
        if not order.is_delivery:
            raise ValidationError('Cette commande n’est pas une livraison.')
        deliverer = User.objects.select_for_update().filter(
            pk=request.data.get('deliverer'), role=R.DELIVERER, is_active=True,
            availability=User.Availability.AVAILABLE).first()
        if deliverer is None:
            raise ValidationError({'deliverer': 'Livreur introuvable ou non disponible.'})
        deliverer.availability = User.Availability.BUSY
        deliverer.save(update_fields=['availability'])
        order.deliverer, order.status = deliverer, Order.Status.DELIVERING
        order.save(update_fields=['deliverer', 'status'])
        data = self.get_serializer(order).data
        broadcast(f'user_{deliverer.pk}', 'delivery_assigned', data)
        broadcast(f'user_{order.client_id}', 'order_on_the_way', data)
        return Response(data)

    def _own_delivery(self, request):
        order = _lock(Order, self.get_object().pk, Order.Status.DELIVERING)  # deliverers only see theirs
        if order.deliverer_id != request.user.pk:
            raise PermissionDenied('Cette livraison ne vous est pas attribuée.')
        return order

    @extend_schema(request=inline_serializer('DeliveryPayment', {'method': serializers.ChoiceField(Addition.Method.choices, required=False)}))
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def deliver(self, request, pk=None):
        """Handed over + cash collected: the delivery's Addition is paid to the deliverer, who is free again."""
        order = self._own_delivery(request)
        addition = Addition.objects.create(client=order.client, collected_by=request.user, amount=order.total,
                                           method=_method(request))
        order.status, order.addition = Order.Status.DELIVERED, addition
        order.save(update_fields=['status', 'addition'])
        self._deliverer_back(order)
        broadcast('manager', 'addition_paid', AdditionSerializer(addition).data)
        data = self.get_serializer(order).data
        broadcast(f'user_{order.client_id}', 'order_delivered', data)
        return Response(data)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def fail(self, request, pk=None):
        """Livraison échouée (client absent / refused): no Addition, deliverer free again, manager told."""
        order = self._own_delivery(request)
        order.status = Order.Status.FAILED
        order.save(update_fields=['status'])
        self._deliverer_back(order)
        data = self.get_serializer(order).data
        broadcast('manager', 'delivery_failed', data)
        broadcast(f'user_{order.client_id}', 'delivery_failed', data)
        return Response(data)


class ReviewViewSet(RoleViewSet):
    """Avis on one of the client's paid Additions; the manager sees everything."""
    serializer_class = ReviewSerializer
    http_method_names = ['get', 'post']
    read_roles = (R.CLIENT,)
    action_roles = {'create': (R.CLIENT,)}

    def get_queryset(self):
        user = self.request.user
        return Review.objects.filter(client=user) if self.role == R.CLIENT else Review.objects.all()

    def perform_create(self, serializer):
        serializer.save(client=self.request.user)
        broadcast('manager', 'review_created', serializer.data)


def _ratings(qs, *fields):
    return list(qs.values(*fields).annotate(average=Avg('rating'), count=Count('id')).order_by('-average'))


class DashboardView(APIView):
    """Manager statistics: revenue, best sellers, ratings, stock, incidents."""
    permission_classes = [HasRole()]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        paid = [Order.Status.PAID, Order.Status.DELIVERED]
        return Response({
            'revenue_total': Addition.objects.aggregate(total=Sum('amount'))['total'] or 0,
            'revenue_by_day': list(Addition.objects.annotate(day=TruncDate('created_at')).values('day')
                                   .annotate(total=Sum('amount'), additions=Count('id')).order_by('-day')[:30]),
            'orders_by_status': list(Order.objects.values('status').annotate(count=Count('id')).order_by('status')),
            'top_items': list(OrderItem.objects.filter(order__status__in=paid)
                              .annotate(item=Coalesce('dish__name', 'daily_special__name')).values('item')
                              .annotate(sold=Sum('quantity')).order_by('-sold')[:10]),
            'restaurant_rating': Review.objects.filter(dish=None, daily_special=None, staff=None).aggregate(
                average=Avg('rating'), count=Count('id')),
            'staff_ratings': _ratings(Review.objects.filter(staff__isnull=False), 'staff', 'staff__username',
                                      'staff__role'),
            'dish_ratings': _ratings(Review.objects.filter(dish__isnull=False), 'dish', 'dish__name'),
            'daily_special_ratings': _ratings(Review.objects.filter(daily_special__isnull=False), 'daily_special',
                                              'daily_special__name', 'daily_special__date'),
            'no_shows': Reservation.objects.filter(status=RS.NO_SHOW).count(),
            'failed_deliveries': Order.objects.filter(status=Order.Status.FAILED).count(),
            'ruptures': list(Ingredient.objects.filter(is_out_of_stock=True).values('id', 'name')),
            'pending_stock_requests': StockRequest.objects.filter(status=StockRequest.Status.PENDING).count(),
        })
