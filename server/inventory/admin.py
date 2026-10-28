from django.contrib import admin

from .models import Ingredient, StockRequest, Supplier

admin.site.register(Supplier, list_display=['name', 'category', 'contact_phone'], list_filter=['category'])
admin.site.register(Ingredient, list_display=['name', 'quantity_in_stock', 'unit', 'is_out_of_stock'])
admin.site.register(StockRequest, list_display=['ingredient', 'quantity_requested', 'supplier', 'status', 'created_at'],
                    list_filter=['status'])
