from django.contrib import admin

from .models import DailySpecial, Dish, Ingredient, RestaurantTable, StockRequest, Supplier

admin.site.register(Supplier, list_display=['name', 'category', 'contact_phone'], list_filter=['category'])
admin.site.register(RestaurantTable, list_display=['number', 'capacity', 'zone'], list_filter=['zone'])
admin.site.register(Dish, list_display=['name', 'price', 'is_available'], filter_horizontal=['ingredients'])
admin.site.register(DailySpecial, list_display=['date', 'name', 'price', 'is_available'])
admin.site.register(Ingredient, list_display=['name', 'quantity_in_stock', 'unit', 'is_out_of_stock'])
admin.site.register(StockRequest, list_display=['ingredient', 'quantity_requested', 'supplier', 'status', 'created_at'],
                    list_filter=['status'])
