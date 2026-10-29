import hashlib
import hmac
import time

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission

from .models import Camera, hash_token


class DeviceTokenAuthentication(BaseAuthentication):
    """lets a vision worker (a machine, not a person) sign in.

    the worker sends the header "Authorization: Device <token>". we hash the token and look for a
    camera with that fingerprint. if found, request.auth is that camera; there is no user account.
    """
    keyword = b'device'

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != self.keyword:
            return None  # not a device request: let the other sign-in methods try
        if len(parts) != 2:
            raise AuthenticationFailed('En-tête Device invalide.')
        camera = Camera.objects.filter(token_hash=hash_token(parts[1].decode()), is_active=True).first()
        if camera is None:
            raise AuthenticationFailed('Jeton de caméra invalide.')
        # remember that the worker is alive (used to show the camera as "en ligne")
        Camera.objects.filter(pk=camera.pk).update(last_seen_at=timezone.now())
        return AnonymousUser(), camera

    def authenticate_header(self, request):
        return 'Device'


class IsDevice(BasePermission):
    """only a signed-in vision worker may call the endpoints protected by this."""

    def has_permission(self, request, view):
        return isinstance(request.auth, Camera)


def stream_ticket(camera, ttl=60):
    """make a short-lived signed ticket that opens one camera's blurred video stream.

    the ticket looks like "slug.expires.signature". the signature is an hmac: a code computed from the
    text and a secret shared with the worker. the worker recomputes it; if anyone changes the text or the
    expiry date, the codes no longer match and the stream is refused. no database is needed for this.
    """
    expires = int(time.time()) + ttl
    payload = f'{camera.slug}.{expires}'
    signature = hmac.new(settings.MONITORING_STREAM_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f'{payload}.{signature}'
