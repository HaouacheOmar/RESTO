from django.apps import AppConfig


class MonitoringConfig(AppConfig):
    """table monitoring with cameras.

    a camera looks at the dining room, a separate program (the "vision worker") counts the people
    seated at each table, and this module shows that count next to what the restaurant already knows
    (open séance, reservation). it only reads the core data: it never changes a séance or a reservation.
    """
    name = 'monitoring'

    def ready(self):
        from . import schema  # noqa: F401  (registers the device sign-in in the api docs)
