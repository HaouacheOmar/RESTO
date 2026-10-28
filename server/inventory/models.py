from django.conf import settings
from django.db import models
from django.db.models import Q

# These models moved here from `catalog`: their tables keep the old names, so no data was copied.


class Supplier(models.Model):
    class Category(models.TextChoices):
        EQUIPMENT = 'EQUIPMENT', 'Matériel'
        INGREDIENTS = 'INGREDIENTS', 'Ingrédients'

    name = models.CharField(max_length=100)
    category = models.CharField(max_length=20, choices=Category.choices)
    contact_phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)

    class Meta:
        db_table = 'catalog_supplier'

    def __str__(self):
        return self.name


class Ingredient(models.Model):
    name = models.CharField(max_length=100, unique=True)
    quantity_in_stock = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    unit = models.CharField(max_length=20)  # kg, L, unités...
    is_out_of_stock = models.BooleanField(default=False)  # Rupture

    class Meta:
        db_table = 'catalog_ingredient'
        ordering = ['name']

    def __str__(self):
        return self.name


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
        db_table = 'catalog_stockrequest'
        ordering = ['-created_at']
        constraints = [models.CheckConstraint(condition=Q(quantity_requested__gt=0), name='stock_request_qty_positive')]
        indexes = [models.Index(fields=['status'], name='stock_request_status')]
