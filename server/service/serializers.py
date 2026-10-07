from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from accounts.models import User
from catalog.models import Dish, RestaurantTable

from .models import Addition, Order, OrderItem, Reservation, Review, Seance

REVIEW_WINDOW = timedelta(days=7)


class ReservationSerializer(serializers.ModelSerializer):
    client_name = serializers.CharField(source='client.get_full_name', read_only=True)
    client_username = serializers.CharField(source='client.username', read_only=True)
    client_phone = serializers.CharField(source='client.phone', read_only=True)
    table_number = serializers.IntegerField(source='table.number', read_only=True, default=None)

    class Meta:
        model = Reservation
        fields = '__all__'
        read_only_fields = ['client', 'table', 'parking_status', 'parking_spot', 'status']
        extra_kwargs = {'guest_count': {'min_value': 1}}

    def validate_reservation_time(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError('La réservation doit être dans le futur.')
        return value

    @transaction.atomic
    def create(self, data):
        zone = data.get('zone', RestaurantTable.Zone.STANDARD)
        # Note: locks every table of the zone, serialising bookings per zone; fine at restaurant scale
        list(RestaurantTable.objects.select_for_update().filter(zone=zone))
        table = Reservation.free_tables(zone, data['guest_count'], data['reservation_time']).first()
        if table is None:
            raise serializers.ValidationError('Aucune table disponible pour ce créneau.')
        if data.get('has_vehicle'):
            data['parking_status'] = Reservation.Parking.REQUESTED
        return Reservation.objects.create(table=table, **data)


class OrderItemSerializer(serializers.ModelSerializer):
    """One of `dish` (Carte) or `daily_special` (today's Plat du jour)."""
    name = serializers.CharField(read_only=True)

    class Meta:
        model = OrderItem
        fields = ['dish', 'daily_special', 'name', 'quantity', 'unit_price']
        read_only_fields = ['unit_price']
        extra_kwargs = {'quantity': {'min_value': 1}}

    def validate(self, item):
        dish, special = item.get('dish'), item.get('daily_special')
        if bool(dish) == bool(special):
            raise serializers.ValidationError('Chaque ligne porte soit un plat de la Carte, soit le Plat du jour.')
        if dish and not Dish.objects.orderable().filter(pk=dish.pk).exists():
            raise serializers.ValidationError(f'« {dish.name} » n’est pas disponible.')
        if special and not (special.is_available and special.date == timezone.localdate()):
            raise serializers.ValidationError(f'« {special.name} » n’est pas le Plat du jour disponible.')
        return item


class OrderSerializer(serializers.ModelSerializer):
    """Server: dine-in with `table_number` (+ optional `seance_name` for a walk-in). Client: `delivery_address`."""
    items = OrderItemSerializer(many=True)
    table_number = serializers.IntegerField(write_only=True, required=False)
    seance_name = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=100)
    table = serializers.IntegerField(source='seance.table.number', read_only=True, default=None)
    deliverer_name = serializers.CharField(source='deliverer.first_name', read_only=True, default=None)
    client_name = serializers.SerializerMethodField()
    client_phone = serializers.CharField(source='client.phone', read_only=True, default=None)

    class Meta:
        model = Order
        fields = '__all__'
        read_only_fields = ['seance', 'addition', 'client', 'server', 'deliverer', 'is_delivery', 'status', 'total']

    def get_client_name(self, order) -> str | None:
        return (order.client.get_full_name() or order.client.username) if order.client else None

    def validate_items(self, items):
        if not items:
            raise serializers.ValidationError('La commande est vide.')
        return items

    def validate(self, data):
        if self.context['request'].user.role == User.Role.CLIENT:
            if not data.get('delivery_address'):
                raise serializers.ValidationError({'delivery_address': 'Adresse de livraison requise.'})
        elif not RestaurantTable.objects.filter(number=data.get('table_number')).exists():
            raise serializers.ValidationError({'table_number': 'Table inconnue.'})
        return data

    def _seance(self, table_number, name):
        """The table's open Séance, or a new walk-in Séance if the table is free and not reserved soon."""
        table = RestaurantTable.objects.select_for_update().get(number=table_number)
        seance = Seance.objects.filter(table=table, status=Seance.Status.OPEN).first()
        if seance:
            return seance, False
        if Reservation.overlapping(timezone.now()).filter(
                table=table, status__in=[Reservation.Status.PENDING, Reservation.Status.CONFIRMED]).exists():
            raise serializers.ValidationError({'table_number': 'Table réservée sur le créneau : choisir une autre table.'})
        return Seance.objects.create(table=table, name=name or Seance.WALK_IN_NAME), True

    @transaction.atomic
    def create(self, data):
        user = self.context['request'].user
        items = data.pop('items')
        table_number, name = data.pop('table_number', None), data.pop('seance_name', '')
        if user.role == User.Role.CLIENT:
            data.update(client=user, is_delivery=True)
        else:
            seance, self.opened_seance = self._seance(table_number, name)
            data.update(seance=seance, client=seance.client, server=user, delivery_address='')
        order = Order.objects.create(**data)
        lines = [OrderItem(order=order, quantity=i['quantity'], dish=i.get('dish'), daily_special=i.get('daily_special'),
                           unit_price=(i.get('dish') or i.get('daily_special')).price) for i in items]
        OrderItem.objects.bulk_create(lines)
        order.total = sum(line.unit_price * line.quantity for line in lines)
        order.save(update_fields=['total'])
        return order


class SeanceSerializer(serializers.ModelSerializer):
    table_number = serializers.IntegerField(source='table.number', read_only=True)
    orders = OrderSerializer(many=True, read_only=True)
    total_due = serializers.SerializerMethodField()

    class Meta:
        model = Seance
        fields = '__all__'

    def get_total_due(self, seance) -> str:
        return str(sum((o.total for o in seance.orders.all() if o.status == Order.Status.PENDING), Decimal(0)))


class AdditionItemSerializer(serializers.Serializer):
    dish = serializers.IntegerField(allow_null=True)
    daily_special = serializers.IntegerField(allow_null=True)
    name = serializers.CharField()


class StaffRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    role = serializers.CharField()


class ReviewRefSerializer(serializers.Serializer):
    dish = serializers.IntegerField(allow_null=True)
    daily_special = serializers.IntegerField(allow_null=True)
    staff = serializers.IntegerField(allow_null=True)
    rating = serializers.IntegerField()


class AdditionSerializer(serializers.ModelSerializer):
    """Also lists what the Addition contained, who served it and what was already reviewed (for Avis)."""
    orders = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    table_number = serializers.IntegerField(source='seance.table.number', read_only=True, default=None)
    items = serializers.SerializerMethodField()
    staff = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()
    reviewable_until = serializers.SerializerMethodField()

    class Meta:
        model = Addition
        fields = '__all__'

    def _orders(self, addition):
        return [o for o in addition.orders.all() if o.status != Order.Status.CANCELLED]

    @extend_schema_field(AdditionItemSerializer(many=True))
    def get_items(self, addition):
        seen = {}
        for order in self._orders(addition):
            for line in order.items.all():
                seen.setdefault((line.dish_id, line.daily_special_id), line.name)
        return [{'dish': d, 'daily_special': s, 'name': n} for (d, s), n in seen.items()]

    @extend_schema_field(StaffRefSerializer(many=True))
    def get_staff(self, addition):
        people = {}
        for order in self._orders(addition):
            for person in (order.server, order.deliverer):
                if person:
                    people[person.pk] = {'id': person.pk, 'name': person.get_full_name() or person.username,
                                         'role': person.role}
        return list(people.values())

    @extend_schema_field(ReviewRefSerializer(many=True))
    def get_reviews(self, addition):
        return [{'dish': r.dish_id, 'daily_special': r.daily_special_id, 'staff': r.staff_id, 'rating': r.rating}
                for r in addition.reviews.all()]

    def get_reviewable_until(self, addition) -> str:
        return (addition.created_at + REVIEW_WINDOW).isoformat()


class ReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = Review
        fields = '__all__'
        read_only_fields = ['client']
        extra_kwargs = {'rating': {'min_value': 1, 'max_value': 5}}

    def validate(self, data):
        addition, client = data['addition'], self.context['request'].user
        dish, special, staff = data.get('dish'), data.get('daily_special'), data.get('staff')
        if addition.client_id != client.pk:
            raise serializers.ValidationError({'addition': 'Cette Addition n’est pas la vôtre.'})
        if addition.created_at < timezone.now() - REVIEW_WINDOW:
            raise serializers.ValidationError({'addition': 'Les avis sont possibles 7 jours après le paiement.'})
        if sum(x is not None for x in (dish, special, staff)) > 1:
            raise serializers.ValidationError('Un avis vise une seule cible.')
        lines = OrderItem.objects.filter(order__addition=addition)
        if dish and not lines.filter(dish=dish).exists():
            raise serializers.ValidationError({'dish': 'Ce plat ne fait pas partie de l’Addition.'})
        if special and not lines.filter(daily_special=special).exists():
            raise serializers.ValidationError({'daily_special': 'Ce Plat du jour ne fait pas partie de l’Addition.'})
        if staff and not addition.orders.filter(server=staff).exists() and not addition.orders.filter(
                deliverer=staff).exists():
            raise serializers.ValidationError({'staff': 'Cette personne ne vous a pas servi.'})
        if Review.objects.filter(addition=addition, dish=dish, daily_special=special, staff=staff).exists():
            raise serializers.ValidationError('Vous avez déjà laissé cet avis.')
        return data
