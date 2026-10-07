from rest_framework import serializers

from .models import DailySpecial, Dish, Ingredient, RestaurantTable, StockRequest, Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = '__all__'


class RestaurantTableSerializer(serializers.ModelSerializer):
    is_occupied = serializers.BooleanField(read_only=True, default=False)  # annotated: has an open Séance

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
    class Meta:
        model = DailySpecial
        fields = '__all__'
        extra_kwargs = {'is_available': {'default': True}}  # multipart omits booleans → DRF would read False


class IngredientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Ingredient
        fields = '__all__'


class StockRequestSerializer(serializers.ModelSerializer):
    ingredient_name = serializers.CharField(source='ingredient.name', read_only=True)

    class Meta:
        model = StockRequest
        fields = '__all__'
        read_only_fields = ['requested_by', 'supplier', 'status']
