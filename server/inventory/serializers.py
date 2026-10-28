from rest_framework import serializers

from .models import Ingredient, StockRequest, Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = '__all__'


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
