from django.contrib import admin

from .models import DailySpecial, Dish

admin.site.register(Dish, list_display=['name', 'price', 'is_available'], filter_horizontal=['ingredients'])
admin.site.register(DailySpecial, list_display=['date', 'name', 'price', 'is_available'])
