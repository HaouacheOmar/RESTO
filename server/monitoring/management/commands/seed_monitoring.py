import os

from django.core.management.base import BaseCommand
from django.db import transaction

from service.api import RestaurantTable

from ...models import Camera, TableZone, hash_token

# the demo camera looks at three tables of the demo restaurant (see vision/samples/zones-mixkit-4385.json).
# polygons are fractions of the image: [x, y] with 0..1, so they fit any video size.
ZONES = {
    1: [[0.50, 0.26], [0.70, 0.26], [0.70, 0.42], [0.50, 0.42]],
    3: [[0.47, 0.42], [0.78, 0.42], [0.78, 0.74], [0.47, 0.74]],
    4: [[0.44, 0.74], [0.88, 0.74], [0.88, 1.00], [0.44, 1.00]],
}
# the far end of the room and the aisle: always pixelated, nobody is counted there
PRIVACY_MASKS = [
    [[0.12, 0.0], [0.80, 0.0], [0.80, 0.25], [0.12, 0.25]],
    [[0.12, 0.25], [0.47, 0.25], [0.44, 1.0], [0.12, 1.0]],
]


class Command(BaseCommand):
    """creates the demo camera if it is missing. like seed_demo, it never overwrites what already exists.

    on the public demo no worker runs: the screen replays /monitoring/demo.mp4 (blurred in advance) with
    /monitoring/timeline.json. with MONITORING_DEMO_TOKEN set (docker compose "vision" profile), a live
    worker can sign in with that token instead.
    """
    help = 'Create the demo monitoring camera and its table zones (only what is missing).'

    @transaction.atomic
    def handle(self, **options):
        camera, created = Camera.objects.get_or_create(slug='salle', defaults={
            'name': 'Salle principale', 'replay_video': '/monitoring/demo.mp4',
            'replay_timeline': '/monitoring/timeline.json', 'privacy_masks': PRIVACY_MASKS,
            'token_hash': hash_token(os.environ.get('MONITORING_DEMO_TOKEN') or os.urandom(16).hex()),
        })
        tables = {t.number: t for t in RestaurantTable.objects.filter(number__in=ZONES)}
        for number, polygon in ZONES.items():
            if number in tables:
                TableZone.objects.get_or_create(table=tables[number], defaults={'camera': camera, 'polygon': polygon})
        self.stdout.write(f'Monitoring demo camera {"created" if created else "already there"}.')
