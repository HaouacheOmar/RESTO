from django.db.models import ProtectedError
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated

from .models import User

PUBLIC = 'public'
AUTHENTICATED = 'authenticated'


def HasRole(*roles):
    """Permission class allowing the given roles; the manager is always allowed."""
    allowed = {User.Role.ADMIN_MANAGER, *roles}

    class _HasRole(BasePermission):
        def has_permission(self, request, view):
            return request.user.is_authenticated and request.user.role in allowed

    return _HasRole


def _permission(roles):
    if roles == PUBLIC:
        return AllowAny()
    if roles == AUTHENTICATED:
        return IsAuthenticated()
    return HasRole(*roles)()


class RolePermissionMixin:
    """Viewset permissions declared per action as role tuples, PUBLIC or AUTHENTICATED.

    `action_roles` wins, then `read_roles` for list/retrieve, else `write_roles`. Empty tuple = manager only.
    """
    read_roles = ()
    write_roles = ()
    action_roles = {}

    @property
    def role(self):
        """Current user's role; None for anonymous requests (e.g. OpenAPI schema generation)."""
        return getattr(self.request.user, 'role', None)

    def get_permissions(self):
        if self.action in self.action_roles:
            roles = self.action_roles[self.action]
        elif self.action in ('list', 'retrieve'):
            roles = self.read_roles
        else:
            roles = self.write_roles
        return [_permission(roles)]


class RoleViewSet(RolePermissionMixin, viewsets.ModelViewSet):
    def perform_destroy(self, instance):
        """Something still points at it (an order, a session, a request): a clear 400 instead of a 500."""
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError('Impossible de supprimer : cet élément est déjà utilisé. Désactivez-le plutôt.')


class ReadOnlyRoleViewSet(RolePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """For objects that only change through @actions."""
