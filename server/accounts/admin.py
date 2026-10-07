from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import JobApplication, User


@admin.register(User)
class RestoUserAdmin(UserAdmin):
    list_display = ['username', 'email', 'role', 'availability', 'is_active']
    list_filter = ['role', 'availability', 'is_active']
    fieldsets = UserAdmin.fieldsets + (('Restaurant', {'fields': ['role', 'phone', 'availability']}),)
    add_fieldsets = UserAdmin.add_fieldsets + (('Restaurant', {'fields': ['role', 'phone']}),)


@admin.register(JobApplication)
class JobApplicationAdmin(admin.ModelAdmin):
    list_display = ['full_name', 'requested_role', 'status', 'created_at']
    list_filter = ['status', 'requested_role']
    exclude = ['password']
