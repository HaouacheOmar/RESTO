from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import TokenError


@database_sync_to_async
def _user_from_token(raw):
    auth = JWTAuthentication()
    try:
        return auth.get_user(auth.get_validated_token(raw))
    except (TokenError, AuthenticationFailed):  # invalid token, unknown or inactive user
        return AnonymousUser()


class JWTQueryAuthMiddleware:
    """Authenticate WebSocket connections with `?token=<access JWT>`."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = parse_qs(scope.get('query_string', b'').decode()).get('token', [None])[0]
        scope['user'] = await _user_from_token(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)
