from django.utils import timezone
from rest_framework import serializers

from .models import DailySpecial, Dish, Ingredient, RestaurantTable, StockRequest, Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = '__all__'


class RestaurantTableSerializer(serializers.ModelSerializer):
    is_occupied = serializers.BooleanField(read_only=True, default=False)  # annotated: has an open Séance
    # annotated: a reservation not yet seated holds the table now (no walk-in possible)
    reserved_at = serializers.DateTimeField(read_only=True, default=None, allow_null=True)

    class Meta:
        model = RestaurantTable
        fields = '__all__'


class DishSerializer(serializers.ModelSerializer):
    """Carte dish. `ingredients` is the Recette (ingredient ids)."""
    is_orderable = serializers.SerializerMethodField()

    class Meta:
        model = Dish
        fields = '__all__'
        extra_kwargs = {'is_available': {'default': True}}  # multipart omits booleans → DRF would read False

    def get_is_orderable(self, dish) -> bool:
        return dish.is_available and not any(i.is_out_of_stock for i in dish.ingredients.all())


class DailySpecialSerializer(serializers.ModelSerializer):
    # annotated by DailySpecialViewSet; absent (None) on the public Menu
    sold = serializers.IntegerField(read_only=True, default=None)
    rating = serializers.FloatField(read_only=True, default=None)
    rating_count = serializers.IntegerField(read_only=True, default=None)

    class Meta:
        model = DailySpecial
        fields = '__all__'
        extra_kwargs = {'is_available': {'default': True}}  # multipart omits booleans → DRF would read False

    def validate_date(self, value):
        moving = self.instance is None or value != self.instance.date
        if moving and value < timezone.localdate():
            raise serializers.ValidationError('Cette date est déjà passée.')
        return value


class IngredientSerializer(serializers.ModelSerializer):
    # Carte dishes whose Recette uses it: what a Rupture takes off the Menu
    dishes = serializers.SlugRelatedField(many=True, read_only=True, slug_field='name')

    class Meta:
        model = Ingredient
        fields = '__all__'


class StockRequestSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source='ingredient.name', read_only=True)
    supplier_name = serializers.CharField(source='supplier.name', read_only=True, default=None)

    class Meta:
        model = StockRequest
        fields = '__all__'
        read_only_fields = ['requested_by', 'supplier', 'status']
