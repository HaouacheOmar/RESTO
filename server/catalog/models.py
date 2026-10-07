from django.conf import settings
from django.db import models
from django.db.models import Q


class Supplier(models.Model):
    class Category(models.TextChoices):
        EQUIPMENT = 'EQUIPMENT', 'Matériel'
        INGREDIENTS = 'INGREDIENTS', 'Ingrédients'

    name = models.CharField(max_length=100)
    category = models.CharField(max_length=20, choices=Category.choices)
    contact_phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)

    def __str__(self):
        return self.name


class RestaurantTable(models.Model):
    class Zone(models.TextChoices):
        STANDARD = 'STANDARD'
        VIP = 'VIP'

    number = models.PositiveIntegerField(unique=True)
    capacity = models.PositiveSmallIntegerField()
    zone = models.CharField(max_length=10, choices=Zone.choices, default=Zone.STANDARD)

    class Meta:
        ordering = ['number']
        constraints = [models.CheckConstraint(condition=Q(capacity__gt=0), name='table_capacity_positive')]

    def __str__(self):
        return f'Table {self.number} ({self.capacity}p, {self.zone})'


class Ingredient(models.Model):
    name = models.CharField(max_length=100, unique=True)
    quantity_in_stock = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit = models.CharField(max_length=20)  # kg, L, unités...
    is_out_of_stock = models.BooleanField(default=False)  # Rupture

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class DishQuerySet(models.QuerySet):
    def orderable(self):
        """Plats disponibles: offered by the manager and no Recette ingredient in Rupture."""
        return self.filter(is_available=True).exclude(ingredients__is_out_of_stock=True)


class Dish(models.Model):
    """A dish of the Carte (permanent menu)."""
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    photo = models.ImageField(upload_to='dishes/', blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    is_available = models.BooleanField(default=True)  # manager's switch; see DishQuerySet.orderable
    ingredients = models.ManyToManyField(Ingredient, blank=True, related_name='dishes')  # Recette

    objects = DishQuerySet.as_manager()

    class Meta:
        ordering = ['name']
        constraints = [models.CheckConstraint(condition=Q(price__gte=0), name='dish_price_non_negative')]

    def __str__(self):
        return self.name


class DailySpecial(models.Model):
    """Plat du jour: created by the Chef for one date, separate from the Carte, no Recette."""
    date = models.DateField(unique=True)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    photo = models.ImageField(upload_to='daily_specials/', blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    is_available = models.BooleanField(default=True)  # the Chef withdraws it when sold out

    class Meta:
        ordering = ['-date']
        constraints = [models.CheckConstraint(condition=Q(price__gte=0), name='daily_special_price_non_negative')]

    def __str__(self):
        return f'{self.name} ({self.date})'


class StockRequest(models.Model):
    """Demande de réapprovisionnement. Fulfilling it does NOT end the Rupture: the stock manager does."""

    class Status(models.TextChoices):
        PENDING = 'PENDING'
        APPROVED = 'APPROVED'
        FULFILLED = 'FULFILLED'

    ingredient = models.ForeignKey(Ingredient, on_delete=models.CASCADE, related_name='requests')
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    quantity_requested = models.DecimalField(max_digits=10, decimal_places=2)
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, null=True, blank=True)  # set on approval
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.CheckConstraint(condition=Q(quantity_requested__gt=0), name='stock_request_qty_positive')]
