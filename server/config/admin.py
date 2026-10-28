from django.contrib import admin
from django.core.cache import cache
from django.http import HttpResponse
from rest_framework.throttling import BaseThrottle

MAX_FAILURES = 5
LOCKOUT = 15 * 60  # seconds


class RestoAdminSite(admin.AdminSite):
    """The Django admin, for the manager only, locked for 15 minutes after 5 failed logins from one IP."""
    site_header = 'RESTO · administration'

    def has_permission(self, request):
        return super().has_permission(request) and request.user.role == request.user.Role.ADMIN_MANAGER

    def login(self, request, extra_context=None):
        key = f'admin-login-failures:{BaseThrottle().get_ident(request)}'  # same client IP rule as the API limits
        if request.method == 'POST' and cache.get(key, 0) >= MAX_FAILURES:
            return HttpResponse('Trop de tentatives. Réessayez dans 15 minutes.', status=429)
        response = super().login(request, extra_context)
        if request.method == 'POST' and response.status_code != 302:  # 302 = signed in
            cache.add(key, 0, LOCKOUT)
            cache.incr(key)
        return response
