"""talks to the resto api: gets the table zones, sends the table counts."""
import logging
import time
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)


def iso(seconds):
    """unix time (seconds) -> iso 8601 text in utc, the format the api expects."""
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


class Reporter:
    def __init__(self, api_url, token, report_every=3.0):
        self.client = httpx.Client(base_url=api_url, timeout=10,
                                   headers={'Authorization': f'Device {token}'})
        self.report_every = report_every
        self.last_sent, self.last_payload = 0.0, None

    def config(self, retries=30):
        """the camera's zones. retried with a growing wait: the api may still be starting."""
        delay = 1.0
        for attempt in range(retries):
            try:
                response = self.client.get('/api/monitoring/device/config/')
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as error:
                log.warning('config not available yet (%s), retry %d in %.0fs', error, attempt + 1, delay)
                time.sleep(delay)
                delay = min(delay * 2, 30)
        raise RuntimeError('could not get the camera configuration from the api')

    def refresh(self):
        """the camera's configuration again, or None if the api does not answer (we keep the old one)."""
        try:
            response = self.client.get('/api/monitoring/device/config/')
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as error:
            log.warning('could not refresh the configuration: %s', error)
            return None

    def maybe_send(self, states, now):
        """send when a table changed, or at least every `report_every` seconds (a heartbeat)."""
        tables = [{'table_number': s.table_number, 'people': s.people, 'occupied': s.occupied, 'since': iso(s.since)}
                  for s in sorted(states.values(), key=lambda s: s.table_number)]
        key = [(t['table_number'], t['people'], t['occupied']) for t in tables]
        if key == self.last_payload and now - self.last_sent < self.report_every:
            return False
        try:
            self.client.post('/api/monitoring/device/observations/',
                             json={'observed_at': iso(now), 'tables': tables}).raise_for_status()
            self.last_sent, self.last_payload = now, key
            return True
        except httpx.HTTPError as error:
            # never crash the video loop because the api is down: we try again on the next frames
            log.warning('could not send the counts: %s', error)
            return False
