import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django_app = get_asgi_application()  # must load before importing models

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402
from django.urls import path  # noqa: E402

from accounts.middleware import JWTQueryAuthMiddleware  # noqa: E402
from service.consumers import NotificationConsumer  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_app,
    'websocket': AllowedHostsOriginValidator(JWTQueryAuthMiddleware(URLRouter([
        path('ws/', NotificationConsumer.as_asgi()),
    ]))),
})
