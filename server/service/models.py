from django.conf import settings
from django.db import models
from django.db.models import Q

from catalog.models import DailySpecial, Dish, RestaurantTable

USER = settings.AUTH_USER_MODEL


class Reservation(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING'
        CONFIRMED = 'CONFIRMED'
        CHECKED_IN = 'CHECKED_IN'
        DONE = 'DONE'
        CANCELLED = 'CANCELLED'  # by the client only
        NO_SHOW = 'NO_SHOW'

    class Parking(models.TextChoices):
        REQUESTED = 'REQUESTED'
        SECURED = 'SECURED'
        REFUSED = 'REFUSED'  # lot full; the reservation stays valid

    ACTIVE = [Status.PENDING, Status.CONFIRMED, Status.CHECKED_IN]

    client = models.ForeignKey(USER, on_delete=models.CASCADE, related_name='reservations')
    table = models.ForeignKey(RestaurantTable, on_delete=models.SET_NULL, null=True, related_name='reservations')
    guest_count = models.PositiveSmallIntegerField()
    zone = models.CharField(max_length=10, choices=RestaurantTable.Zone.choices, default=RestaurantTable.Zone.STANDARD)
    reservation_time = models.DateTimeField()
    has_vehicle = models.BooleanField(default=False)
    parking_status = models.CharField(max_length=10, choices=Parking.choices, blank=True)  # blank = no vehicle
    parking_spot = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['reservation_time']
        constraints = [models.CheckConstraint(condition=Q(guest_count__gt=0), name='reservation_guests_positive')]

    @classmethod
    def overlapping(cls, when):
        """Active reservations whose slot overlaps a slot starting at `when`."""
        slot = settings.RESERVATION_SLOT
        return cls.objects.filter(status__in=cls.ACTIVE, reservation_time__gt=when - slot,
                                  reservation_time__lt=when + slot)

    @classmethod
    def blocking_walk_ins(cls, now):
        """Reservations not yet seated whose slot covers `now`: their table can't take a walk-in."""
        return cls.overlapping(now).filter(status__in=[cls.Status.PENDING, cls.Status.CONFIRMED])

    @classmethod
    def free_tables(cls, zone, guest_count, when, exclude=None):
        """Tables of the zone that fit the party and are not reserved for the slot, smallest first."""
        busy = cls.overlapping(when).filter(table__isnull=False)
        if exclude is not None:
            busy = busy.exclude(pk=exclude.pk)
        return (RestaurantTable.objects.filter(zone=zone, capacity__gte=guest_count)
                .exclude(id__in=busy.values('table')).order_by('capacity', 'number'))


class Seance(models.Model):
    """Séance: occupation of a table from seating until the Addition is paid (with or without a Réservation)."""

    class Status(models.TextChoices):
        OPEN = 'OPEN'
        PAID = 'PAID'
        CLOSED = 'CLOSED'  # closed empty: nobody ordered

    WALK_IN_NAME = 'Client sur place'

    table = models.ForeignKey(RestaurantTable, on_delete=models.PROTECT, related_name='seances')
    reservation = models.OneToOneField(Reservation, on_delete=models.PROTECT, null=True, blank=True,
                                       related_name='seance')
    name = models.CharField(max_length=100)  # Nom de Séance, printed on the ticket
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-opened_at']
        constraints = [models.UniqueConstraint(fields=['table'], condition=Q(status='OPEN'),
                                               name='one_open_seance_per_table')]

    @property
    def client(self):
        return self.reservation.client if self.reservation else None


class Addition(models.Model):
    """Unit of payment: every order of a Séance (cashier) or the single order of a delivery (deliverer)."""

    class Method(models.TextChoices):
        CASH = 'CASH'
        CARD = 'CARD'

    seance = models.OneToOneField(Seance, on_delete=models.PROTECT, null=True, blank=True, related_name='addition')
    client = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name='additions')
    collected_by = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, related_name='collected_additions')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices, default=Method.CASH)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class Order(models.Model):
    """Commande: dine-in (in a Séance, by a server) or delivery (by a client)."""

    class Status(models.TextChoices):
        PENDING = 'PENDING'
        PAID = 'PAID'
        DELIVERING = 'DELIVERING'
        DELIVERED = 'DELIVERED'
        CANCELLED = 'CANCELLED'
        FAILED = 'FAILED'  # Livraison échouée

    seance = models.ForeignKey(Seance, on_delete=models.PROTECT, null=True, blank=True, related_name='orders')
    addition = models.ForeignKey(Addition, on_delete=models.PROTECT, null=True, blank=True, related_name='orders')
    client = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name='orders')
    server = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True, related_name='served_orders')
    deliverer = models.ForeignKey(USER, on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name='delivered_orders')
    is_delivery = models.BooleanField(default=False)
    delivery_address = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.CheckConstraint(condition=Q(is_delivery=True) | Q(seance__isnull=False),
                                              name='dine_in_order_has_seance')]


class OrderItem(models.Model):
    """A line: either a Carte dish or the Plat du jour."""
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name='items')
    dish = models.ForeignKey(Dish, on_delete=models.PROTECT, null=True, blank=True)
    daily_special = models.ForeignKey(DailySpecial, on_delete=models.PROTECT, null=True, blank=True)
    quantity = models.PositiveSmallIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)  # frozen at order time

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name='order_item_qty_positive'),
            models.CheckConstraint(condition=Q(dish__isnull=True) ^ Q(daily_special__isnull=True),
                                   name='order_item_one_product'),
        ]

    @property
    def name(self):
        return (self.dish or self.daily_special).name


class Review(models.Model):
    """Avis on a paid Addition: the restaurant (no target), a dish / Plat du jour of it, or a server / deliverer."""
    addition = models.ForeignKey(Addition, on_delete=models.CASCADE, related_name='reviews')
    client = models.ForeignKey(USER, on_delete=models.CASCADE, related_name='reviews')
    rating = models.PositiveSmallIntegerField()
    comment = models.TextField(blank=True)
    dish = models.ForeignKey(Dish, on_delete=models.CASCADE, null=True, blank=True, related_name='reviews')
    daily_special = models.ForeignKey(DailySpecial, on_delete=models.CASCADE, null=True, blank=True,
                                      related_name='reviews')
    staff = models.ForeignKey(USER, on_delete=models.CASCADE, null=True, blank=True, related_name='reviews_received')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.CheckConstraint(condition=Q(rating__gte=1, rating__lte=5), name='review_rating_1_5'),
            models.CheckConstraint(
                condition=~Q(dish__isnull=False, daily_special__isnull=False) & ~Q(dish__isnull=False, staff__isnull=False)
                & ~Q(daily_special__isnull=False, staff__isnull=False), name='review_single_target'),
            models.UniqueConstraint(fields=['addition', 'dish', 'daily_special', 'staff'], nulls_distinct=False,
                                    name='one_review_per_target_per_addition'),
        ]
