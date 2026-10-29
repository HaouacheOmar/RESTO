import os

from django.core.management.base import BaseCommand
from django.db import transaction

from service.api import RestaurantTable

from ...models import Camera, TableZone, hash_token

# the demo camera looks at three tables of the demo restaurant (see vision/samples/zones-mixkit-4385.json).
# polygons are fractions of the image: [x, y] with 0..1, so they fit any video size.
# each table: the zone used for counting (the table and its chairs), and the outline of the tabletop
# (only drawn on the video)
ZONES = {
    1: ([[0.50, 0.26], [0.70, 0.26], [0.70, 0.42], [0.50, 0.42]],
        [[0.555, 0.286], [0.633, 0.286], [0.645, 0.374], [0.559, 0.374]]),
    3: ([[0.47, 0.42], [0.78, 0.42], [0.78, 0.69], [0.47, 0.69]],
        [[0.558, 0.426], [0.659, 0.426], [0.666, 0.628], [0.571, 0.628]]),
    4: ([[0.44, 0.69], [0.88, 0.69], [0.88, 1.00], [0.44, 1.00]],
        [[0.575, 0.703], [0.700, 0.703], [0.717, 0.950], [0.581, 0.950]]),
}
AREA = 'Salle principale'  # the area this camera covers
# the far end of the room and the aisle: always blurred, nobody is counted there
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
            'name': 'Salle principale', 'area': AREA, 'replay_video': '/monitoring/demo.mp4',
            'replay_timeline': '/monitoring/timeline.json', 'privacy_masks': PRIVACY_MASKS,
            'token_hash': hash_token(os.environ.get('MONITORING_DEMO_TOKEN') or os.urandom(16).hex()),
        })
        if not camera.area:  # cameras made before areas existed: fill in, never overwrite
            Camera.objects.filter(pk=camera.pk).update(area=AREA)
        tables = {t.number: t for t in RestaurantTable.objects.filter(number__in=ZONES)}
        for number, (polygon, outline) in ZONES.items():
            if number in tables:
                zone, _ = TableZone.objects.get_or_create(table=tables[number], defaults={
                    'camera': camera, 'polygon': polygon, 'outline': outline})
                if not zone.outline:  # zones made before outlines existed: fill in, never overwrite
                    TableZone.objects.filter(pk=zone.pk).update(outline=outline)
        self.stdout.write(f'Monitoring demo camera {"created" if created else "already there"}.')
