"""What the other modules may use from service (dining: tables, reservations, Séances, orders, Additions, reviews)."""
from django.db.models import Avg, Count, Exists, IntegerField, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from .models import Addition, Order, OrderItem, Reservation, RestaurantTable, Review, Seance

__all__ = ['Addition', 'Order', 'OrderItem', 'Reservation', 'RestaurantTable', 'Review', 'Seance',
           'daily_special_stats', 'tables_with_state']


def tables_with_state():
    """Every table with its live state, computed (never stored): `is_occupied` (an open Séance) and
    `reserved_at` (a reservation not yet seated holds it now, so no walk-in), plus `seance_name`."""
    now = timezone.now()
    blocking = Reservation.blocking_walk_ins(now).filter(table=OuterRef('pk')).order_by('reservation_time')
    open_seance = Seance.objects.filter(table=OuterRef('pk'), status=Seance.Status.OPEN)
    return RestaurantTable.objects.annotate(
        is_occupied=Exists(open_seance),
        reserved_at=Subquery(blocking.values('reservation_time')[:1]),
        seance_name=Subquery(open_seance.values('name')[:1]),
    )


def daily_special_stats():
    """Annotations for a DailySpecial queryset: portions sold (paid or delivered) and reviews.

    Subqueries, so sales and reviews never multiply each other.
    """
    sold = (OrderItem.objects.filter(daily_special=OuterRef('pk'),
                                     order__status__in=[Order.Status.PAID, Order.Status.DELIVERED])
            .values('daily_special').annotate(n=Sum('quantity')).values('n'))
    reviews = Review.objects.filter(daily_special=OuterRef('pk')).values('daily_special')
    return {
        'sold': Coalesce(Subquery(sold, output_field=IntegerField()), 0),
        'rating': Subquery(reviews.annotate(a=Avg('rating')).values('a')),
        'rating_count': Coalesce(Subquery(reviews.annotate(c=Count('id')).values('c'), output_field=IntegerField()), 0),
    }
