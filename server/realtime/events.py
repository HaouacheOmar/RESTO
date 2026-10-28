from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

# Groups: kitchen_pos (caisse + serveurs), reservations, parking, deliveries, manager, user_<id>.


def broadcast(group, event, payload):
    """Push `{event, payload}` to a WebSocket group once the current DB transaction commits.

    `payload` must be JSON-able (serializer.data is).
    """
    message = {'type': 'notify', 'event': event, 'payload': payload}
    transaction.on_commit(lambda: async_to_sync(get_channel_layer().group_send)(group, message))
