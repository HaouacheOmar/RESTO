from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse


def _check(probe):
    try:
        probe()
        return 'ok'
    except Exception:  # any failure means "down"; details stay in the logs, not in a public response
        return 'down'


def healthz(request):
    """Public health check. 503 only when the database is down: without Redis the API still works (no live updates)."""
    def db():
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')

    checks = {'database': _check(db), 'redis': _check(lambda: cache.get('healthz'))}
    return JsonResponse(checks, status=200 if checks['database'] == 'ok' else 503)
