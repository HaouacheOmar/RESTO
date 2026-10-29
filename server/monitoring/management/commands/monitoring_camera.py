import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from service.api import RestaurantTable

from ...models import Camera, TableZone, validate_polygon


class Command(BaseCommand):
    """create or update a camera, give it a new secret token, and load its table zones.

    example:
        python manage.py monitoring_camera salle "Salle principale" --zones zones.json
    zones.json maps a table number to its polygon: {"1": [[0.1, 0.5], [0.3, 0.5], [0.3, 0.8]], ...}
    the token is printed once: copy it into the worker's configuration (RESTO_DEVICE_TOKEN).
    """
    help = 'Create or update a monitoring camera, print a new device token, load its table zones.'

    def add_arguments(self, parser):
        parser.add_argument('slug')
        parser.add_argument('name')
        parser.add_argument('--zones', type=Path, help='JSON file: {"table number": [[x, y], ...]}')
        parser.add_argument('--replay-video', default='')
        parser.add_argument('--replay-timeline', default='')

    @transaction.atomic
    def handle(self, slug, name, zones, replay_video, replay_timeline, **options):
        camera = Camera.objects.filter(slug=slug).first() or Camera(slug=slug)
        camera.name, camera.replay_video, camera.replay_timeline = name, replay_video, replay_timeline
        token = camera.rotate_token()  # any old token stops working now
        camera.save()
        if zones:
            for number, polygon in json.loads(zones.read_text(encoding='utf-8')).items():
                table = RestaurantTable.objects.filter(number=int(number)).first()
                if table is None:
                    raise CommandError(f'No table n°{number}.')
                validate_polygon(polygon)
                TableZone.objects.update_or_create(table=table, defaults={'camera': camera, 'polygon': polygon})
        self.stdout.write(f'Camera "{camera.slug}" ready, {camera.zones.count()} table zone(s).')
        self.stdout.write(f'Device token (shown once): {token}')
