from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.api import PUBLIC, RoleViewSet, User
from config.lists import ScopedListMixin
from service.api import daily_special_stats

from .models import DailySpecial, Dish
from .serializers import DailySpecialSerializer, DishSerializer

R = User.Role


def todays_special():
    return DailySpecial.objects.filter(date=timezone.localdate(), is_available=True).first()


class DishViewSet(RoleViewSet):
    serializer_class = DishSerializer
    read_roles = PUBLIC

    def get_queryset(self):
        qs = Dish.objects.prefetch_related('ingredients')
        return qs.orderable() if self.request.query_params.get('orderable') else qs


class DailySpecialViewSet(ScopedListMixin, RoleViewSet):
    """Plat du jour: the Chef creates one per date (today or later) and withdraws it when sold out.

    Each entry also reports how many were sold and its average rating (subqueries, so the two never multiply).
    """
    serializer_class = DailySpecialSerializer
    read_roles = PUBLIC
    write_roles = (R.CHEF,)

    def get_queryset(self):
        return DailySpecial.objects.annotate(**daily_special_stats())

    history_ordering = ('-date',)

    def active_filter(self):  # today and the planned ones
        return Q(date__gte=timezone.localdate())

    def perform_destroy(self, instance):
        try:
            super().perform_destroy(instance)
        except ValidationError:
            raise ValidationError('Ce plat a déjà été commandé : retirez-le du menu plutôt que de le supprimer.')


class MenuView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=inline_serializer('Menu', {
        'carte': DishSerializer(many=True), 'plat_du_jour': DailySpecialSerializer(allow_null=True)}))
    def get(self, request):
        special = todays_special()
        return Response({
            'carte': DishSerializer(Dish.objects.orderable().prefetch_related('ingredients'), many=True,
                                    context={'request': request}).data,
            'plat_du_jour': DailySpecialSerializer(special, context={'request': request}).data if special else None,
        })
