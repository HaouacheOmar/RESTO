import hashlib
import secrets

from django.core.exceptions import ValidationError
from django.db import models

# we point to the table model by its name ('app.Model') instead of importing it:
# this keeps the modules independent (the rule of our modular monolith).
TABLE = 'service.RestaurantTable'


def hash_token(token):
    """turn a secret token into a fingerprint (sha-256).

    we only save the fingerprint in the database: if someone steals the database,
    they still cannot use it to pretend to be a camera.
    """
    return hashlib.sha256(token.encode()).hexdigest()


class Camera(models.Model):
    """one camera, and the vision worker program that watches it.

    the worker proves who it is with a secret "device token" (like a password for a machine).
    replay_video and replay_timeline are for the public demo, where no worker runs:
    they point to a clip that was blurred in advance and to the readings recorded with it.
    """
    slug = models.SlugField(unique=True)  # short name used in urls, for example "salle"
    name = models.CharField(max_length=100)
    token_hash = models.CharField(max_length=64, unique=True)
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)  # last time the worker talked to us
    replay_video = models.CharField(max_length=300, blank=True)
    replay_timeline = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def rotate_token(self):
        """create a new secret token for this camera.

        the token is returned only once (to be given to the worker); we keep only its fingerprint.
        """
        token = secrets.token_urlsafe(32)
        self.token_hash = hash_token(token)
        return token


def validate_polygon(value):
    """check that a table zone is a real shape: at least 3 points, each one [x, y] between 0 and 1.

    0 to 1 means "a fraction of the image" (0.5 = the middle), so the zone works for any video size.
    """
    ok = (isinstance(value, list) and len(value) >= 3 and all(
        isinstance(p, list) and len(p) == 2 and all(isinstance(c, (int, float)) and 0 <= c <= 1 for c in p)
        for p in value))
    if not ok:
        raise ValidationError('Au moins 3 points [x, y], coordonnées entre 0 et 1 (fraction de l’image).')


class TableZone(models.Model):
    """where a table is in the camera image, drawn as a polygon (a shape made of points)."""
    camera = models.ForeignKey(Camera, on_delete=models.CASCADE, related_name='zones')
    table = models.OneToOneField(TABLE, on_delete=models.CASCADE, related_name='+')  # one zone per table
    polygon = models.JSONField(validators=[validate_polygon])

    def __str__(self):
        return f'{self.camera} · {self.table}'


class TableObservation(models.Model):
    """the latest thing the camera saw at one table.

    there is only one row per table and we overwrite it each time: we keep no history,
    so nothing about the guests is stored over time (privacy by design).
    """
    table = models.OneToOneField(TABLE, on_delete=models.CASCADE, primary_key=True, related_name='+')
    camera = models.ForeignKey(Camera, on_delete=models.CASCADE, related_name='observations')
    people = models.PositiveSmallIntegerField()  # how many people are seated in the table zone
    occupied = models.BooleanField()
    since = models.DateTimeField()  # when the table became occupied (or empty)
    observed_at = models.DateTimeField()  # when the worker sent this reading

    class Meta:
        # the database itself refuses an "empty" table that still counts people
        constraints = [models.CheckConstraint(condition=models.Q(occupied=False, people=0) | models.Q(occupied=True),
                                              name='empty_table_has_nobody')]
