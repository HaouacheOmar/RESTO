from django.db import models
from django.db.models import Q


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
    ingredients = models.ManyToManyField('inventory.Ingredient', blank=True, related_name='dishes')  # Recette

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
