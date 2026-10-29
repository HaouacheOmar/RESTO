from django.contrib import admin

from .models import Camera, TableZone


class TableZoneInline(admin.TabularInline):
    """edit a camera's table zones on the camera page."""
    model = TableZone
    extra = 0


@admin.register(Camera)
class CameraAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_active', 'last_seen_at']
    exclude = ['token_hash']  # tokens are created with "manage.py monitoring_camera", never typed by hand
    inlines = [TableZoneInline]
