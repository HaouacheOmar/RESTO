from django.utils import timezone
from rest_framework import serializers

from .models import DailySpecial, Dish


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
