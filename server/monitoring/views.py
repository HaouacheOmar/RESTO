from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

# we only use other modules through their api.py (checked by import-linter)
from accounts.api import HasRole, User
from realtime.api import broadcast
from service.api import RestaurantTable, tables_with_state

from .auth import DeviceTokenAuthentication, IsDevice, stream_ticket
from .models import Camera, TableObservation, TableZone
from .serializers import CameraSerializer, CameraSetupSerializer, ObservationBatchSerializer

R = User.Role
# who can use this feature: the reservation desk, and the manager (the manager always passes HasRole)
WATCHERS = (R.RESERVATION_MANAGER,)


def _stale_after():
    """readings older than this moment are too old to trust (the worker or the camera may be down)."""
    return timezone.now() - timedelta(seconds=settings.MONITORING_STALE_SECONDS)


def _live_enabled():
    """a live stream needs both the worker's address and the secret shared with it."""
    return bool(settings.MONITORING_STREAM_SECRET and settings.MONITORING_STREAM_URL)


def _with_status(cameras):
    """adds "online" (the worker talked to us recently) and "live" (a stream can be opened) to each camera."""
    fresh, cameras = _stale_after(), list(cameras)
    for camera in cameras:
        camera.online = bool(camera.is_active and camera.last_seen_at and camera.last_seen_at >= fresh)
        camera.live = _live_enabled() and camera.online
    return cameras


class MonitoredTablesView(APIView):
    """every table with two kinds of facts side by side:

    - what the restaurant knows (the core): an open séance, a reservation coming up;
    - what the camera sees: how many people are seated, if the reading is recent enough.

    the screen decides the colour from both. the core always wins: a reserved table stays "réservée".
    """
    permission_classes = [HasRole(*WATCHERS)]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        fresh = _stale_after()
        seen = {o.table_id: o for o in TableObservation.objects.all()}
        # which camera watches each table (one query, the camera's slug comes with a join)
        watched = dict(TableZone.objects.values_list('table_id', 'camera__slug'))
        return Response([{
            'number': t.number, 'capacity': t.capacity, 'zone': t.zone,
            'is_occupied': t.is_occupied, 'seance_name': t.seance_name, 'reserved_at': t.reserved_at,
            'watched': t.pk in watched,  # is this table inside a camera's view?
            'camera_slug': watched.get(t.pk),  # and which one (a restaurant can have several cameras)
            # the camera part is null when there is no reading or when it is too old
            'camera': ({'people': o.people, 'occupied': o.occupied, 'since': o.since, 'observed_at': o.observed_at}
                       if (o := seen.get(t.pk)) and o.observed_at >= fresh else None),
        } for t in tables_with_state().order_by('number')])


class CameraListView(APIView):
    """the cameras, with "online" (the worker answers) and "live" (a video stream can be opened)."""
    permission_classes = [HasRole(*WATCHERS)]

    @extend_schema(responses=CameraSerializer(many=True))
    def get(self, request):
        return Response(CameraSerializer(_with_status(Camera.objects.filter(is_active=True)), many=True).data)


class StreamTicketView(APIView):
    """gives the screen a url to watch one camera's blurred stream, and one for a still image of it
    (the background the manager draws the tables on). the urls work for 60 seconds.

    each camera has its own worker: the reverse proxy sends /stream/<slug>/... to that camera's worker.
    """
    permission_classes = [HasRole(*WATCHERS)]

    @extend_schema(request=None, responses=inline_serializer('StreamUrl', {
        'url': serializers.CharField(), 'snapshot': serializers.CharField()}))
    def post(self, request, slug):
        camera = get_object_or_404(Camera, slug=slug, is_active=True)
        if not _live_enabled():
            raise NotFound('Pas de flux en direct sur cet environnement.')
        base, ticket = f'{settings.MONITORING_STREAM_URL}/{camera.slug}', stream_ticket(camera)
        return Response({'url': f'{base}/mjpeg?ticket={ticket}', 'snapshot': f'{base}/snapshot.jpg?ticket={ticket}'})


class CameraSetupListView(APIView):
    """the manager's camera list (also the inactive ones), and adding a camera.

    a new camera gets a secret token, shown only in this answer: it goes into the worker's settings.
    """
    permission_classes = [HasRole()]  # the manager only

    @extend_schema(responses=CameraSetupSerializer(many=True))
    def get(self, request):
        cameras = _with_status(Camera.objects.prefetch_related('zones__table'))  # 3 queries, whatever the size
        return Response(CameraSetupSerializer(cameras, many=True).data)

    @extend_schema(request=CameraSetupSerializer, responses={201: CameraSetupSerializer})
    @transaction.atomic
    def post(self, request):
        serializer = CameraSetupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        camera = serializer.save()
        return Response(CameraSetupSerializer(_with_status([camera])[0]).data, status=201)


class CameraSetupView(APIView):
    """change one camera (name, area, on/off, tables drawn, privacy masks) or remove it.

    the worker reads its configuration again every minute, so a change applies without restarting it.
    """
    permission_classes = [HasRole()]

    @extend_schema(request=CameraSetupSerializer, responses=CameraSetupSerializer)
    @transaction.atomic
    def patch(self, request, slug):
        camera = get_object_or_404(Camera.objects.select_for_update(), slug=slug)
        serializer = CameraSetupSerializer(camera, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(CameraSetupSerializer(_with_status([serializer.save()])[0]).data)

    @extend_schema(responses={204: None})
    def delete(self, request, slug):
        get_object_or_404(Camera, slug=slug).delete()  # its zones and readings go with it
        return Response(status=204)


class CameraTokenView(APIView):
    """a new secret token for a camera (lost, or maybe stolen). the old one stops working at once."""
    permission_classes = [HasRole()]

    @extend_schema(request=None, responses=inline_serializer('CameraToken', {'token': serializers.CharField()}))
    def post(self, request, slug):
        camera = get_object_or_404(Camera, slug=slug)
        token = camera.rotate_token()
        camera.save(update_fields=['token_hash'])
        return Response({'token': token})


class DeviceConfigView(APIView):
    """called by the worker when it starts: which tables to watch and where they are in the image.

    the zones are set up on the server, so changing a zone never needs a new worker release.
    """
    authentication_classes = [DeviceTokenAuthentication]
    permission_classes = [IsDevice]
    throttle_classes = []  # a trusted machine, already identified by its token

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        camera = request.auth
        zones = camera.zones.select_related('table').order_by('table__number')
        return Response({'camera': camera.slug, 'stale_after_seconds': settings.MONITORING_STALE_SECONDS,
                         'privacy_masks': camera.privacy_masks,
                         'zones': [{'table_number': z.table.number, 'capacity': z.table.capacity,
                                    'polygon': z.polygon, 'outline': z.outline} for z in zones]})


class DeviceObservationView(APIView):
    """the worker sends its readings here every few seconds.

    we save the latest reading of each table. when a count or an occupied/empty state changes,
    we push a "monitoring_update" event so the open screens update right away.
    """
    authentication_classes = [DeviceTokenAuthentication]
    permission_classes = [IsDevice]
    throttle_classes = []

    @extend_schema(request=ObservationBatchSerializer, responses={204: None})
    @transaction.atomic
    def post(self, request):
        camera = request.auth
        batch = ObservationBatchSerializer(data=request.data)
        batch.is_valid(raise_exception=True)
        readings = batch.validated_data['tables']
        # a camera may only report the tables that are inside its own zones
        tables = {t.number: t for t in RestaurantTable.objects.filter(
            pk__in=camera.zones.values('table'), number__in=[r['table_number'] for r in readings])}
        unknown = [r['table_number'] for r in readings if r['table_number'] not in tables]
        if unknown:
            raise ValidationError({'tables': f'La table n°{unknown[0]} n’est pas dans le champ de cette caméra.'})

        # no n+1 queries: we load all the previous readings in one query...
        previous = {o.table_id: (o.people, o.occupied)
                    for o in TableObservation.objects.filter(table__in=tables.values())}
        rows, changed = [], []
        for reading in readings:
            table = tables[reading['table_number']]
            rows.append(TableObservation(
                table=table, camera=camera, people=reading['people'], occupied=reading['occupied'],
                since=reading['since'], observed_at=batch.validated_data['observed_at']))
            if previous.get(table.pk) != (reading['people'], reading['occupied']):
                changed.append({'table_number': table.number, 'people': reading['people'], 'occupied': reading['occupied']})
        # ...and save them all in one "upsert" (insert, or update the row if the table already has one)
        TableObservation.objects.bulk_create(
            rows, update_conflicts=True, unique_fields=['table'],
            update_fields=['camera', 'people', 'occupied', 'since', 'observed_at'])
        if changed:
            # the reservation desk listens to the "reservations" group, and so does the manager
            broadcast('reservations', 'monitoring_update', {'camera': camera.slug, 'tables': changed})
        return Response(status=204)
