from django.db.models import Avg, Count, Sum
from django.db.models.functions import Coalesce, TruncDate
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.api import HasRole
from inventory.api import Ingredient, StockRequest
from service.api import Addition, Order, OrderItem, Reservation, Review


def _ratings(qs, *fields):
    return list(qs.values(*fields).annotate(average=Avg('rating'), count=Count('id')).order_by('-average'))


class DashboardView(APIView):
    """Manager statistics: revenue, best sellers, ratings, stock, incidents."""
    permission_classes = [HasRole()]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        paid = [Order.Status.PAID, Order.Status.DELIVERED]
        return Response({
            'revenue_total': Addition.objects.aggregate(total=Sum('amount'))['total'] or 0,
            'revenue_by_day': list(Addition.objects.annotate(day=TruncDate('created_at')).values('day')
                                   .annotate(total=Sum('amount'), additions=Count('id')).order_by('-day')[:30]),
            'orders_by_status': list(Order.objects.values('status').annotate(count=Count('id')).order_by('status')),
            'top_items': list(OrderItem.objects.filter(order__status__in=paid)
                              .annotate(item=Coalesce('dish__name', 'daily_special__name')).values('item')
                              .annotate(sold=Sum('quantity')).order_by('-sold')[:10]),
            'restaurant_rating': Review.objects.filter(dish=None, daily_special=None, staff=None).aggregate(
                average=Avg('rating'), count=Count('id')),
            'staff_ratings': _ratings(Review.objects.filter(staff__isnull=False), 'staff', 'staff__username',
                                      'staff__first_name', 'staff__last_name', 'staff__role'),
            'dish_ratings': _ratings(Review.objects.filter(dish__isnull=False), 'dish', 'dish__name'),
            'daily_special_ratings': _ratings(Review.objects.filter(daily_special__isnull=False), 'daily_special',
                                              'daily_special__name', 'daily_special__date'),
            'no_shows': Reservation.objects.filter(status=Reservation.Status.NO_SHOW).count(),
            'failed_deliveries': Order.objects.filter(status=Order.Status.FAILED).count(),
            'ruptures': list(Ingredient.objects.filter(is_out_of_stock=True).values('id', 'name')),
            'pending_stock_requests': StockRequest.objects.filter(status=StockRequest.Status.PENDING).count(),
        })
