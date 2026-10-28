from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    """The manager's dashboard: reads the other modules through their api.py. No models."""
    name = 'analytics'
