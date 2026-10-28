import secrets
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from django.core.cache import cache

from .models import User

TICKET_TTL = 30  # seconds: the client connects right after asking for it


def issue_ticket(user):
    """A random single-use ticket for one WebSocket connection, so the JWT never travels in a URL (proxy logs)."""
    ticket = secrets.token_urlsafe(32)
    cache.set(f'ws-ticket:{ticket}', user.pk, TICKET_TTL)
    return ticket


@database_sync_to_async
def _user_from_ticket(ticket):
    key = f'ws-ticket:{ticket}'
    user_id = cache.get(key)
    if user_id is None or not cache.delete(key):  # single use: only the first connection gets through
        return AnonymousUser()
    return User.objects.filter(pk=user_id, is_active=True).first() or AnonymousUser()


class TicketAuthMiddleware:
    """Authenticate WebSocket connections with `?ticket=` (from POST /api/realtime/ticket/)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        ticket = parse_qs(scope.get('query_string', b'').decode()).get('ticket', [None])[0]
        scope['user'] = await _user_from_ticket(ticket) if ticket else AnonymousUser()
        return await self.app(scope, receive, send)
