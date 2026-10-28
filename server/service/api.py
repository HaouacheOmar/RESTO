"""What the other modules may use from service (dining: tables, reservations, Séances, orders, Additions, reviews)."""
from django.db.models import Avg, Count, IntegerField, OuterRef, Subquery, Sum
from django.db.models.functions import Coalesce

from .models import Addition, Order, OrderItem, Reservation, RestaurantTable, Review, Seance

__all__ = ['Addition', 'Order', 'OrderItem', 'Reservation', 'RestaurantTable', 'Review', 'Seance',
           'daily_special_stats']


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
