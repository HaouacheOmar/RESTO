from django.apps import AppConfig


class RealtimeConfig(AppConfig):
    """Live events: broadcast() and the WebSocket consumer. No models."""
    name = 'realtime'
