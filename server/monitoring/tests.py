import hashlib
import hmac
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from service.models import Reservation, RestaurantTable

from .models import Camera, TableObservation, TableZone

R = User.Role
SQUARE = [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]


class MonitoringTests(APITestCase):
    def setUp(self):
        self.users = {role: User.objects.create_user(username=role.lower(), password='x', role=role) for role in R}
        self.t1 = RestaurantTable.objects.create(number=1, capacity=3)
        self.t2 = RestaurantTable.objects.create(number=2, capacity=4)
        self.camera = Camera(slug='salle', name='Salle')
        self.token = self.camera.rotate_token()
        self.camera.save()
        TableZone.objects.create(camera=self.camera, table=self.t1, polygon=SQUARE)
        self.device = APIClient()  # the worker has its own client: it never shares the users' sign-in

    def as_(self, role):
        self.client.force_authenticate(self.users[role])
        return self.client

    def send(self, *tables, token=None, at=None):
        """the worker posting one batch of readings."""
        return self.device.post('/api/monitoring/device/observations/', {
            'observed_at': (at or timezone.now()).isoformat(),
            'tables': [{'table_number': n, 'people': p, 'occupied': p > 0, 'since': timezone.now().isoformat()}
                       for n, p in tables],
        }, format='json', HTTP_AUTHORIZATION=f'Device {token or self.token}')

    def table(self, number, role=R.RESERVATION_MANAGER):
        return next(t for t in self.as_(role).get('/api/monitoring/tables/').json() if t['number'] == number)

    def test_only_the_manager_and_the_reservation_desk_see_it(self):
        for role in (R.ADMIN_MANAGER, R.RESERVATION_MANAGER):
            self.assertEqual(self.as_(role).get('/api/monitoring/tables/').status_code, 200)
        for role in (R.SERVER, R.CASHIER, R.CHEF, R.CLIENT, R.PARKING_ATTENDANT):
            self.assertEqual(self.as_(role).get('/api/monitoring/tables/').status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/monitoring/tables/').status_code, 401)

    def test_worker_signs_in_with_its_token_and_gets_its_zones(self):
        self.assertEqual(self.client.get('/api/monitoring/device/config/', HTTP_AUTHORIZATION='Device wrong').status_code, 401)
        config = self.client.get('/api/monitoring/device/config/', HTTP_AUTHORIZATION=f'Device {self.token}').json()
        self.assertEqual(config['zones'], [{'table_number': 1, 'capacity': 3, 'polygon': SQUARE}])
        self.camera.refresh_from_db()
        self.assertIsNotNone(self.camera.last_seen_at)  # shown as online

    def test_readings_are_stored_and_shown_next_to_the_core_state(self):
        self.assertEqual(self.send((1, 2)).status_code, 204)
        t1 = self.table(1)
        self.assertEqual((t1['capacity'], t1['is_occupied'], t1['camera']['people']), (3, False, 2))
        self.assertTrue(t1['watched'])
        self.assertFalse(self.table(2)['watched'])  # outside the camera's view

        self.assertEqual(self.send((1, 0)).status_code, 204)  # they left: overwritten, no history kept
        self.assertEqual(TableObservation.objects.count(), 1)
        self.assertEqual(self.table(1)['camera']['occupied'], False)

    def test_a_camera_only_reports_its_own_tables_and_sane_values(self):
        self.assertEqual(self.send((2, 1)).status_code, 400)  # table 2 is not in its zones
        bad = self.device.post('/api/monitoring/device/observations/', {
            'observed_at': timezone.now().isoformat(),
            'tables': [{'table_number': 1, 'people': 2, 'occupied': False, 'since': timezone.now().isoformat()}],
        }, format='json', HTTP_AUTHORIZATION=f'Device {self.token}')
        self.assertEqual(bad.status_code, 400)  # empty but with people: nonsense
        self.camera.rotate_token()
        self.camera.save()
        self.assertEqual(self.send((1, 1)).status_code, 401)  # the old token stopped working

    def test_no_n_plus_one_queries(self):
        """the cost of a batch must not grow with the number of tables (no query per table)."""
        for number in (2, 3):
            table = RestaurantTable.objects.get(number=number) if number == 2 else RestaurantTable.objects.create(number=3, capacity=2)
            TableZone.objects.create(camera=self.camera, table=table, polygon=SQUARE)
        self.send((1, 1))  # first contact, so both batches below update existing rows
        self.send((1, 1), (2, 1), (3, 1))
        # 7 queries whatever the batch size: camera by token, its "last seen", transaction start,
        # the tables, all previous readings, one upsert, transaction end
        with self.assertNumQueries(7):
            self.send((1, 2))
        with self.assertNumQueries(7):
            self.send((1, 3), (2, 2), (3, 2))
        with self.assertNumQueries(3):  # the tables screen: readings, zones, tables with their state
            self.table(1)

    def test_old_readings_are_ignored(self):
        self.send((1, 2), at=timezone.now() - timedelta(minutes=5))
        self.assertIsNone(self.table(1)['camera'])

    def test_the_core_wins_a_reserved_table_stays_reserved(self):
        Reservation.objects.create(client=self.users[R.CLIENT], table=self.t1, guest_count=2,
                                   reservation_time=timezone.now() + timedelta(minutes=30),
                                   status=Reservation.Status.CONFIRMED)
        self.send((1, 2))  # guests arrived early and sat down
        t1 = self.table(1, role=R.ADMIN_MANAGER)
        self.assertIsNotNone(t1['reserved_at'])  # still reserved: only the desk's check-in changes that
        self.assertEqual(t1['camera']['people'], 2)
        self.assertEqual(Reservation.objects.get().status, Reservation.Status.CONFIRMED)  # untouched

    def test_stream_ticket_is_signed_for_the_worker(self):
        desk = self.as_(R.RESERVATION_MANAGER)
        self.assertEqual(desk.post('/api/monitoring/cameras/salle/stream/').status_code, 404)  # no worker here
        with override_settings(MONITORING_STREAM_SECRET='s3cret', MONITORING_STREAM_URL='http://vision:8090'):
            url = desk.post('/api/monitoring/cameras/salle/stream/').json()['url']
            self.assertTrue(url.startswith('http://vision:8090/salle/mjpeg?ticket='))
            slug, expires, signature = url.split('ticket=')[1].split('.')
            expected = hmac.new(b's3cret', f'{slug}.{expires}'.encode(), hashlib.sha256).hexdigest()
            self.assertEqual(signature, expected)
            self.send((1, 1))
            cameras = desk.get('/api/monitoring/cameras/').json()
            self.assertEqual((cameras[0]['online'], cameras[0]['live']), (True, True))
        self.assertEqual(self.as_(R.SERVER).post('/api/monitoring/cameras/salle/stream/').status_code, 403)
