from django.contrib import admin

from .models import Addition, Order, OrderItem, Reservation, Review, Seance


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0


admin.site.register(Reservation, list_display=['client', 'reservation_time', 'guest_count', 'zone', 'table', 'status',
                                                'parking_status', 'parking_spot'], list_filter=['status', 'zone'])
admin.site.register(Seance, list_display=['id', 'table', 'name', 'status', 'opened_at', 'closed_at'],
                    list_filter=['status'])
admin.site.register(Order, list_display=['id', 'seance', 'client', 'is_delivery', 'status', 'total', 'created_at'],
                    list_filter=['status', 'is_delivery'], inlines=[OrderItemInline])
admin.site.register(Addition, list_display=['id', 'seance', 'client', 'amount', 'method', 'collected_by', 'created_at'])
admin.site.register(Review, list_display=['addition', 'client', 'rating', 'dish', 'daily_special', 'staff', 'created_at'])
