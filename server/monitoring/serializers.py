from rest_framework import serializers

# we only use other modules through their api.py (checked by import-linter)
from service.api import RestaurantTable

from .models import Camera, TableObservation, TableZone, validate_polygon

# a "serializer" checks the json that comes in (and shapes the json that goes out).


class ObservedTableSerializer(serializers.Serializer):
    """what the worker saw at one table."""
    table_number = serializers.IntegerField(min_value=1)
    people = serializers.IntegerField(min_value=0, max_value=50)
    occupied = serializers.BooleanField()
    since = serializers.DateTimeField()

    def validate(self, data):
        # an empty table cannot have people in it: refuse readings that make no sense
        if not data['occupied'] and data['people']:
            raise serializers.ValidationError('Une table vide ne peut pas compter de personnes.')
        return data


class ObservationBatchSerializer(serializers.Serializer):
    """what the worker sends every few seconds: the state of every table its camera can see."""
    observed_at = serializers.DateTimeField()
    tables = ObservedTableSerializer(many=True, max_length=200)


class CameraSerializer(serializers.ModelSerializer):
    online = serializers.BooleanField(read_only=True)  # the worker talked to us recently
    live = serializers.BooleanField(read_only=True)  # a live video stream can be opened

    class Meta:
        model = Camera
        fields = ['slug', 'name', 'area', 'online', 'live', 'replay_video', 'replay_timeline']


# ---------------------------------------------------------------------------------------------
# camera setup (the manager's "caméras" page)
# ---------------------------------------------------------------------------------------------
def validate_outline(value):
    """the tabletop outline is optional: empty, or a real polygon."""
    if value:
        validate_polygon(value)


class ZoneInputSerializer(serializers.Serializer):
    """one table drawn by the manager on the camera image (points in fractions of the image, 0 to 1)."""
    table_number = serializers.IntegerField(min_value=1)
    polygon = serializers.JSONField(validators=[validate_polygon])  # the table and its chairs: for counting
    outline = serializers.JSONField(required=False, default=list, validators=[validate_outline])  # the tabletop


class CameraSetupSerializer(serializers.ModelSerializer):
    """a camera with everything the manager sets up: its area, its tables and its privacy masks.

    "zones" replaces the camera's whole list of tables at once (what the drawing screen sends).
    a table can only be watched by one camera, so nobody is counted twice when cameras overlap.
    """
    online = serializers.BooleanField(read_only=True)
    live = serializers.BooleanField(read_only=True)
    privacy_masks = serializers.ListField(child=serializers.JSONField(validators=[validate_polygon]),
                                          max_length=20, required=False)
    zones = ZoneInputSerializer(many=True, required=False, write_only=True, max_length=100)

    class Meta:
        model = Camera
        fields = ['slug', 'name', 'area', 'is_active', 'online', 'live', 'last_seen_at', 'privacy_masks', 'zones',
                  'replay_video', 'replay_timeline']
        read_only_fields = ['last_seen_at', 'replay_video', 'replay_timeline']

    def validate_slug(self, slug):
        # the worker and the stream address use the slug: it cannot change once the camera exists
        if self.instance and slug != self.instance.slug:
            raise serializers.ValidationError('L’identifiant d’une caméra ne peut pas changer.')
        return slug

    def validate_zones(self, zones):
        numbers = [z['table_number'] for z in zones]
        if len(numbers) != len(set(numbers)):
            raise serializers.ValidationError('Une table ne peut être dessinée qu’une fois.')
        # two queries whatever the number of tables (no n+1): the tables, then the zones of the other cameras
        tables = {t.number: t for t in RestaurantTable.objects.filter(number__in=numbers)}
        missing = [n for n in numbers if n not in tables]
        if missing:
            raise serializers.ValidationError(f'La table n°{missing[0]} n’existe pas.')
        taken = TableZone.objects.filter(table__in=tables.values()).select_related('camera', 'table')
        if self.instance:
            taken = taken.exclude(camera=self.instance)
        if (other := taken.first()) is not None:
            raise serializers.ValidationError(
                f'La table n°{other.table.number} est déjà suivie par la caméra « {other.camera.name} ». '
                'Retirez-la d’abord de cette caméra.')
        for zone in zones:
            zone['table'] = tables[zone['table_number']]
        return zones

    def create(self, data):
        zones = data.pop('zones', [])
        camera = Camera(**data)
        camera.token = camera.rotate_token()  # shown once in the answer, never stored in clear
        camera.save()
        self._save_zones(camera, zones)
        return camera

    def update(self, camera, data):
        zones = data.pop('zones', None)
        camera = super().update(camera, data)
        if zones is not None:
            camera.zones.all().delete()
            self._save_zones(camera, zones)
            # a table taken out of this camera keeps no old reading from it
            TableObservation.objects.filter(camera=camera).exclude(table__in=[z['table'] for z in zones]).delete()
        return camera

    def _save_zones(self, camera, zones):
        # one insert for all the tables
        TableZone.objects.bulk_create([TableZone(camera=camera, table=z['table'], polygon=z['polygon'],
                                                 outline=z['outline']) for z in zones])
        if hasattr(camera, '_prefetched_objects_cache'):
            camera._prefetched_objects_cache.pop('zones', None)  # the answer must show the new zones

    def to_representation(self, camera):
        data = super().to_representation(camera)
        prefetched = 'zones' in getattr(camera, '_prefetched_objects_cache', {})  # the list view loads them in advance
        zones = sorted(camera.zones.all() if prefetched else camera.zones.select_related('table'),
                       key=lambda z: z.table.number)
        data['zones'] = [{'table_number': z.table.number, 'polygon': z.polygon, 'outline': z.outline} for z in zones]
        if token := getattr(camera, 'token', None):
            data['token'] = token  # only right after creating the camera
        return data
