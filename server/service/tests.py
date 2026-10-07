from datetime import timedelta
from decimal import Decimal

from asgiref.sync import async_to_sync, sync_to_async
from channels.testing import WebsocketCommunicator
from django.utils import timezone
from rest_framework.test import APITestCase, APITransactionTestCase

from accounts.models import User
from catalog.models import DailySpecial, Dish, Ingredient, RestaurantTable, StockRequest, Supplier

from .consumers import NotificationConsumer
from .models import Addition, Order, Reservation, Seance

R = User.Role
TOMORROW = timezone.now().replace(microsecond=0) + timedelta(days=1)


class RestoTestCase(APITestCase):
    def setUp(self):
        self.users = {role: User.objects.create_user(username=role.lower(), password='x', role=role) for role in R}
        self.client_user = self.users[R.CLIENT]
        self.t2 = RestaurantTable.objects.create(number=1, capacity=2)
        self.t4 = RestaurantTable.objects.create(number=2, capacity=4)
        self.t6 = RestaurantTable.objects.create(number=3, capacity=6)
        self.vip = RestaurantTable.objects.create(number=10, capacity=6, zone=RestaurantTable.Zone.VIP)
        self.tomato = Ingredient.objects.create(name='Tomate', unit='kg', quantity_in_stock=5)
        self.couscous = Dish.objects.create(name='Couscous', price=Decimal('12.50'))
        self.couscous.ingredients.add(self.tomato)
        self.tea = Dish.objects.create(name='Thé', price=Decimal('2.00'))

    def as_(self, who):
        self.client.force_authenticate(self.users.get(who, who))
        return self.client

    def post(self, who, url, data=None):
        with self.captureOnCommitCallbacks(execute=True):
            return self.as_(who).post(url, data or {}, format='json')

    def reserve(self, guests=3, zone='STANDARD', when=TOMORROW, vehicle=False):
        return self.post(R.CLIENT, '/api/reservations/', {
            'guest_count': guests, 'zone': zone, 'reservation_time': when.isoformat(), 'has_vehicle': vehicle})

    def seated(self, **check_in):
        """Reservation → confirm → check-in. Returns (reservation dict, Seance)."""
        res = self.reserve().json()
        self.post(R.RESERVATION_MANAGER, f'/api/reservations/{res["id"]}/confirm/')
        res = self.post(R.RESERVATION_MANAGER, f'/api/reservations/{res["id"]}/check_in/', check_in)
        self.assertEqual(res.status_code, 200, res.content)
        res = res.json()
        return res, Seance.objects.get(reservation_id=res['id'])

    def order(self, table_number, *lines, who=R.SERVER, **extra):
        items = [{'dish': d.pk, 'quantity': q} for d, q in lines]
        return self.post(who, '/api/orders/', {'table_number': table_number, 'items': items, **extra})

    def delivery(self, *lines):
        return self.post(R.CLIENT, '/api/orders/', {
            'delivery_address': '1 rue Didouche', 'items': [{'dish': d.pk, 'quantity': q} for d, q in lines]})


class ReservationTests(RestoTestCase):
    def test_table_proposal_respects_capacity_zone_and_overlap(self):
        self.assertEqual(Reservation.free_tables('STANDARD', 3, TOMORROW).first(), self.t4)  # best fit
        self.assertEqual(Reservation.free_tables('VIP', 3, TOMORROW).first(), self.vip)
        self.assertIsNone(Reservation.free_tables('STANDARD', 7, TOMORROW).first())

        self.assertEqual(self.reserve().json()['table'], self.t4.pk)
        self.assertEqual(self.reserve().json()['table'], self.t6.pk)  # t4 taken for the slot
        self.assertEqual(self.reserve(when=TOMORROW + timedelta(hours=1)).status_code, 400)
        self.assertEqual(self.reserve(when=TOMORROW + timedelta(hours=3)).json()['table'], self.t4.pk)
        self.assertEqual(self.reserve(when=timezone.now() - timedelta(hours=1)).status_code, 400)

    def test_parking_secured_refused_and_never_double_booked(self):
        a = self.reserve(guests=2, vehicle=True).json()
        b = self.reserve(guests=3, vehicle=True).json()
        self.assertEqual(a['parking_status'], 'REQUESTED')
        url = '/api/reservations/{}/{}/'
        self.assertEqual(self.post(R.PARKING_ATTENDANT, url.format(a['id'], 'confirm_parking'),
                                   {'parking_spot': 'P1'}).json()['parking_status'], 'SECURED')
        self.assertEqual(self.post(R.PARKING_ATTENDANT, url.format(b['id'], 'confirm_parking'),
                                   {'parking_spot': 'P1'}).status_code, 400)
        refused = self.post(R.PARKING_ATTENDANT, url.format(b['id'], 'refuse_parking')).json()
        self.assertEqual((refused['parking_status'], refused['status']), ('REFUSED', 'PENDING'))  # still valid
        self.assertEqual(self.post(R.RESERVATION_MANAGER, url.format(b['id'], 'confirm')).status_code, 200)

    def test_reassign_table_same_zone_only(self):
        res = self.reserve().json()
        url = f'/api/reservations/{res["id"]}/reassign_table/'
        self.assertEqual(self.post(R.RESERVATION_MANAGER, url, {'table_number': self.vip.number}).status_code, 400)
        self.assertEqual(self.post(R.RESERVATION_MANAGER, url, {'table_number': self.t2.number}).status_code, 400)
        self.assertEqual(self.post(R.RESERVATION_MANAGER, url, {'table_number': self.t6.number}).json()['table'],
                         self.t6.pk)

    def test_check_in_with_more_guests_moves_table(self):
        res, seance = self.seated(guest_count=5)
        self.assertEqual((res['guest_count'], res['table'], seance.table), (5, self.t6.pk, self.t6))
        tables = {t['number']: t['is_occupied'] for t in self.as_(R.SERVER).get('/api/tables/').json()}
        self.assertTrue(tables[self.t6.number])
        self.assertFalse(tables[self.t4.number])

    def test_check_in_impossible_without_a_fitting_table(self):
        res = self.reserve().json()
        self.post(R.RESERVATION_MANAGER, f'/api/reservations/{res["id"]}/confirm/')
        self.assertEqual(self.post(R.RESERVATION_MANAGER, f'/api/reservations/{res["id"]}/check_in/',
                                   {'guest_count': 9}).status_code, 400)
        self.assertFalse(Seance.objects.exists())

    def test_no_show_only_after_reservation_time_and_cancel_only_by_client(self):
        future = self.reserve().json()
        self.assertEqual(self.post(R.RESERVATION_MANAGER, f'/api/reservations/{future["id"]}/no_show/').status_code,
                         400)
        self.assertEqual(self.post(R.RESERVATION_MANAGER, f'/api/reservations/{future["id"]}/cancel/').status_code,
                         403)
        self.assertEqual(self.post(R.CLIENT, f'/api/reservations/{future["id"]}/cancel/').json()['status'],
                         'CANCELLED')
        late = Reservation.objects.create(client=self.client_user, table=self.t2, guest_count=2,
                                          reservation_time=timezone.now() - timedelta(minutes=20))
        self.assertEqual(self.post(R.RESERVATION_MANAGER, f'/api/reservations/{late.pk}/no_show/').json()['status'],
                         'NO_SHOW')


class SeanceTests(RestoTestCase):
    def test_one_addition_for_every_order_of_the_seance(self):
        res, seance = self.seated()
        mains = self.order(self.t4.number, (self.couscous, 2)).json()
        dessert = self.order(self.t4.number, (self.tea, 3)).json()
        oops = self.order(self.t4.number, (self.tea, 1)).json()
        self.assertEqual({mains['seance'], dessert['seance'], oops['seance']}, {seance.pk})
        self.assertEqual(self.post(R.SERVER, f'/api/orders/{oops["id"]}/cancel/').json()['status'], 'CANCELLED')
        self.assertEqual(Decimal(str(self.as_(R.CASHIER).get(f'/api/seances/{seance.pk}/').json()['total_due'])),
                         Decimal('31.00'))

        addition = self.post(R.CASHIER, f'/api/seances/{seance.pk}/pay/', {'method': 'CARD'}).json()
        self.assertEqual((Decimal(addition['amount']), addition['method'], addition['client']),
                         (Decimal('31.00'), 'CARD', self.client_user.pk))
        self.assertEqual(set(addition['orders']), {mains['id'], dessert['id']})
        self.assertEqual(self.post(R.CASHIER, f'/api/seances/{seance.pk}/pay/').status_code, 400)  # no double pay
        self.assertEqual(Reservation.objects.get(pk=res['id']).status, 'DONE')
        self.assertEqual(Order.objects.get(pk=oops['id']).status, 'CANCELLED')

        ticket = self.as_(R.CASHIER).get(f'/api/additions/{addition["id"]}/ticket/').json()
        self.assertEqual((ticket['name'], ticket['table_number'], Decimal(ticket['total'])),
                         ('client', self.t4.number, Decimal('31.00')))
        self.assertEqual(len(ticket['items']), 2)
        # table free again → the next server order opens a new walk-in Séance
        self.assertNotEqual(self.order(self.t4.number, (self.tea, 1)).json()['seance'], seance.pk)

    def test_walk_in_opens_a_seance_unless_the_table_is_reserved_soon(self):
        order = self.order(self.t2.number, (self.tea, 1), seance_name='Famille B').json()
        seance = Seance.objects.get(pk=order['seance'])
        self.assertEqual((seance.name, seance.reservation, order['client']), ('Famille B', None, None))
        self.assertEqual(Seance.objects.get(pk=self.order(self.t6.number, (self.tea, 1)).json()['seance']).name,
                         'Client sur place')

        Reservation.objects.create(client=self.client_user, table=self.t4, guest_count=3,
                                   reservation_time=timezone.now() + timedelta(minutes=30),
                                   status=Reservation.Status.CONFIRMED)
        self.assertEqual(self.order(self.t4.number, (self.tea, 1)).status_code, 400)

    def test_close_only_an_empty_seance(self):
        res, seance = self.seated()
        order = self.order(self.t4.number, (self.tea, 1)).json()
        self.assertEqual(self.post(R.SERVER, f'/api/seances/{seance.pk}/close/').status_code, 400)
        self.post(R.SERVER, f'/api/orders/{order["id"]}/cancel/')
        self.assertEqual(self.post(R.SERVER, f'/api/seances/{seance.pk}/close/').json()['status'], 'CLOSED')
        self.assertEqual(Reservation.objects.get(pk=res['id']).status, 'DONE')
        self.assertFalse(Addition.objects.exists())

    def test_client_cannot_cancel_dine_in(self):
        self.seated()
        order = self.order(self.t4.number, (self.tea, 1)).json()
        self.assertEqual(self.post(R.CLIENT, f'/api/orders/{order["id"]}/cancel/').status_code, 404)  # not visible


class DeliveryTests(RestoTestCase):
    def test_delivery_paid_to_the_deliverer(self):
        deliverer = self.users[R.DELIVERER]
        other = User.objects.create_user(username='other', password='x', role=R.DELIVERER)
        first, second = self.delivery((self.couscous, 1)).json(), self.delivery((self.tea, 1)).json()
        self.assertEqual(len(self.as_(R.RESERVATION_MANAGER).get(
            '/api/users/?role=DELIVERER&availability=AVAILABLE').json()), 2)
        assign = '/api/orders/{}/assign_deliverer/'
        self.assertEqual(self.post(R.RESERVATION_MANAGER, assign.format(first['id']),
                                   {'deliverer': deliverer.pk}).json()['status'], 'DELIVERING')
        self.assertEqual(self.post(R.RESERVATION_MANAGER, assign.format(second['id']),
                                   {'deliverer': deliverer.pk}).status_code, 400)  # busy
        self.assertEqual(self.post(R.CLIENT, f'/api/orders/{first["id"]}/cancel/').status_code, 400)  # assigned
        self.assertEqual(self.post(other, f'/api/orders/{first["id"]}/deliver/').status_code, 404)

        self.assertEqual(self.post(R.DELIVERER, f'/api/orders/{first["id"]}/deliver/').json()['status'], 'DELIVERED')
        deliverer.refresh_from_db()
        self.assertEqual(deliverer.availability, 'AVAILABLE')
        addition = Order.objects.get(pk=first['id']).addition
        self.assertEqual((addition.amount, addition.collected_by, addition.client, addition.seance),
                         (Decimal('12.50'), deliverer, self.client_user, None))

    def test_client_cancels_before_assignment(self):
        order = self.delivery((self.tea, 1)).json()
        self.assertEqual(self.post(R.SERVER, f'/api/orders/{order["id"]}/cancel/').status_code, 403)
        self.assertEqual(self.post(R.CLIENT, f'/api/orders/{order["id"]}/cancel/').json()['status'], 'CANCELLED')

    def test_failed_delivery(self):
        deliverer = self.users[R.DELIVERER]
        order = self.delivery((self.tea, 1)).json()
        self.post(R.RESERVATION_MANAGER, f'/api/orders/{order["id"]}/assign_deliverer/', {'deliverer': deliverer.pk})
        self.assertEqual(self.post(R.DELIVERER, f'/api/orders/{order["id"]}/fail/').json()['status'], 'FAILED')
        deliverer.refresh_from_db()
        self.assertEqual(deliverer.availability, 'AVAILABLE')
        self.assertFalse(Addition.objects.exists())
        self.assertEqual(self.as_(R.ADMIN_MANAGER).get('/api/dashboard/').json()['failed_deliveries'], 1)


class MenuAndStockTests(RestoTestCase):
    def test_rupture_makes_recipe_dishes_unavailable_until_the_stock_manager_ends_it(self):
        self.as_(R.STOCK_MANAGER).patch(f'/api/ingredients/{self.tomato.pk}/', {'is_out_of_stock': True})
        self.assertEqual([d['name'] for d in self.as_(None).get('/api/menu/').json()['carte']], ['Thé'])
        self.assertEqual(self.delivery((self.couscous, 1)).status_code, 400)

        supplier = Supplier.objects.create(name='Primeurs', category='INGREDIENTS')
        equipment = Supplier.objects.create(name='Mobilier', category='EQUIPMENT')
        req = self.post(R.STOCK_MANAGER, '/api/stock-requests/', {'ingredient': self.tomato.pk,
                                                                  'quantity_requested': 10}).json()
        url = f'/api/stock-requests/{req["id"]}/'
        self.assertEqual(self.post(R.ADMIN_MANAGER, url + 'fulfill/').status_code, 400)  # not approved yet
        self.assertEqual(self.post(R.ADMIN_MANAGER, url + 'approve/', {'supplier': equipment.pk}).status_code, 400)
        self.assertEqual(self.post(R.ADMIN_MANAGER, url + 'approve/', {'supplier': supplier.pk}).json()['supplier'],
                         supplier.pk)
        self.assertEqual(self.post(R.ADMIN_MANAGER, url + 'fulfill/').json()['status'], 'FULFILLED')
        self.tomato.refresh_from_db()
        self.assertTrue(self.tomato.is_out_of_stock)  # fulfilling does not end the Rupture

        self.as_(R.STOCK_MANAGER).patch(f'/api/ingredients/{self.tomato.pk}/', {'is_out_of_stock': False})
        self.assertEqual(len(self.as_(None).get('/api/menu/').json()['carte']), 2)
        self.assertEqual(StockRequest.objects.get().status, 'FULFILLED')

    def test_daily_special_by_the_chef_one_per_date(self):
        today = timezone.localdate()
        special = {'date': today.isoformat(), 'name': 'Chorba', 'price': '6.00'}
        self.assertEqual(self.as_(R.SERVER).post('/api/daily-specials/', special).status_code, 403)
        chorba = self.as_(R.CHEF).post("/api/daily-specials/", special).json()  # multipart, like a photo upload
        self.assertEqual(self.as_(R.CHEF).post('/api/daily-specials/', {**special, 'name': 'Bis'}).status_code, 400)
        self.assertEqual(self.as_(None).get('/api/menu/').json()['plat_du_jour']['name'], 'Chorba')

        yesterday = DailySpecial.objects.create(date=today - timedelta(days=1), name='Rechta', price=7)
        line = lambda **item: self.post(R.CLIENT, '/api/orders/', {  # noqa: E731
            'delivery_address': 'x', 'items': [{'quantity': 2, **item}]})
        self.assertEqual(line(daily_special=yesterday.pk).status_code, 400)
        self.assertEqual(line(daily_special=chorba['id'], dish=self.tea.pk).status_code, 400)
        self.assertEqual(Decimal(line(daily_special=chorba['id']).json()['total']), Decimal('12.00'))

        self.as_(R.CHEF).patch(f'/api/daily-specials/{chorba["id"]}/', {'is_available': False})  # sold out
        self.assertIsNone(self.as_(None).get('/api/menu/').json()['plat_du_jour'])
        self.assertEqual(line(daily_special=chorba['id']).status_code, 400)


    def test_daily_special_switches_at_local_midnight(self):
        """Algiers is UTC+1: at 23:30 UTC it is already the next day in the restaurant."""
        from datetime import datetime, timezone as dt_timezone
        from unittest import mock

        late_evening_utc = datetime(2026, 3, 9, 23, 30, tzinfo=dt_timezone.utc)
        DailySpecial.objects.create(date='2026-03-10', name='Dobara', price=5)
        with mock.patch('django.utils.timezone.now', return_value=late_evening_utc):
            self.assertEqual(self.as_(None).get('/api/menu/').json()['plat_du_jour']['name'], 'Dobara')


class ReviewTests(RestoTestCase):
    def paid_addition(self):
        _, seance = self.seated()
        self.order(self.t4.number, (self.couscous, 1))
        return self.post(R.CASHIER, f'/api/seances/{seance.pk}/pay/').json()

    def test_reviews_target_only_what_the_addition_contains(self):
        addition = self.paid_addition()
        review = lambda **target: self.post(R.CLIENT, '/api/reviews/', {  # noqa: E731
            'addition': addition['id'], 'rating': 5, **target})
        self.assertEqual(review().status_code, 201)  # the restaurant
        self.assertEqual(review().status_code, 400)  # once per target
        self.assertEqual(review(dish=self.couscous.pk).status_code, 201)
        self.assertEqual(review(dish=self.tea.pk).status_code, 400)  # not eaten
        self.assertEqual(review(staff=self.users[R.SERVER].pk).status_code, 201)
        self.assertEqual(review(staff=self.users[R.CASHIER].pk).status_code, 400)  # did not serve
        self.assertEqual(review(dish=self.couscous.pk, staff=self.users[R.SERVER].pk).status_code, 400)

        mine = self.as_(R.CLIENT).get(f'/api/additions/{addition["id"]}/').json()  # what the review form needs
        self.assertEqual([i['name'] for i in mine['items']], ['Couscous'])
        self.assertEqual([p['id'] for p in mine['staff']], [self.users[R.SERVER].pk])
        self.assertEqual(len(mine['reviews']), 3)

        dash = self.as_(R.ADMIN_MANAGER).get('/api/dashboard/').json()
        self.assertEqual(Decimal(dash['revenue_total']), Decimal('12.50'))
        self.assertEqual(dash['top_items'][0]['item'], 'Couscous')
        self.assertEqual(dash['staff_ratings'][0]['average'], 5)

    def test_review_only_own_addition_within_7_days(self):
        addition = self.paid_addition()
        stranger = User.objects.create_user(username='stranger', password='x', role=R.CLIENT)
        self.assertEqual(self.post(stranger, '/api/reviews/', {'addition': addition['id'], 'rating': 4})
                         .status_code, 400)
        Addition.objects.filter(pk=addition['id']).update(created_at=timezone.now() - timedelta(days=8))
        self.assertEqual(self.post(R.CLIENT, '/api/reviews/', {'addition': addition['id'], 'rating': 4})
                         .status_code, 400)


class AccountTests(RestoTestCase):
    def test_roles(self):
        self.assertEqual(self.as_(None).get('/api/dishes/').status_code, 200)  # public Carte
        self.assertEqual(self.as_(None).get('/api/orders/').status_code, 401)
        self.assertEqual(self.post(R.SERVER, '/api/dishes/', {'name': 'X', 'price': 1}).status_code, 403)
        self.assertEqual(self.post(R.CLIENT, '/api/seances/1/pay/').status_code, 403)
        self.assertEqual(self.as_(R.CASHIER).get('/api/dashboard/').status_code, 403)
        self.assertEqual(self.post(R.ADMIN_MANAGER, '/api/users/', {
            'username': 'chef2', 'password': 'S3cure-pass!', 'role': 'CHEF'}).status_code, 201)

    def test_rejected_candidate_can_reapply_then_log_in(self):
        apply = {'full_name': 'Karim B', 'phone': '0550', 'requested_role': 'DELIVERER',
                 'username': 'karim', 'password': 'S3cure-pass!'}
        first = self.post(None, '/api/job-applications/', apply).json()
        self.post(R.ADMIN_MANAGER, f'/api/job-applications/{first["id"]}/reject/')
        second = self.post(None, '/api/job-applications/', apply)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(self.post(R.ADMIN_MANAGER, f'/api/job-applications/{second.json()["id"]}/accept/')
                         .json()['role'], 'DELIVERER')
        self.assertIn('access', self.as_(None).post('/api/auth/token/', {
            'username': 'karim', 'password': 'S3cure-pass!'}).json())
        self.assertEqual(self.post(None, '/api/job-applications/', apply).status_code, 400)  # now an account


class AuthCookieTests(APITestCase):
    def test_refresh_token_only_in_httponly_cookie_and_revoked_on_logout(self):
        User.objects.create_user(username='amel', password='S3cure-pass!', role=R.CLIENT)
        login = self.client.post('/api/auth/token/', {'username': 'amel', 'password': 'S3cure-pass!'})
        self.assertEqual(set(login.json()), {'access'})  # never in the body
        cookie = login.cookies['resto_refresh']
        self.assertTrue(cookie['httponly'])
        self.assertEqual((cookie['samesite'], cookie['path']), ('Strict', '/api/auth/'))

        self.assertIn('access', self.client.post('/api/auth/token/refresh/').json())
        stolen = cookie.value
        self.assertEqual(self.client.post('/api/auth/logout/').status_code, 204)
        self.assertEqual(self.client.post('/api/auth/token/refresh/').status_code, 401)  # cookie gone
        self.client.cookies['resto_refresh'] = stolen
        self.assertEqual(self.client.post('/api/auth/token/refresh/').status_code, 401)  # revoked

    def test_wrong_password_sets_no_cookie(self):
        response = self.client.post('/api/auth/token/', {'username': 'nobody', 'password': 'x'})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('resto_refresh', response.cookies)


class SeedDemoTests(APITestCase):
    def test_seed_is_idempotent_and_usable(self):
        from io import StringIO

        from django.core.management import call_command

        from .management.commands.seed_demo import PASSWORD
        for _ in range(2):
            call_command('seed_demo', stdout=StringIO())
        self.assertEqual((User.objects.count(), RestaurantTable.objects.count(), Dish.objects.count()), (9, 9, 10))
        menu = self.client.get('/api/menu/').json()
        self.assertEqual((len(menu['carte']), menu['plat_du_jour']['name']), (10, 'Rechta au poulet'))
        self.assertIn('access', self.client.post('/api/auth/token/', {'username': 'client', 'password': PASSWORD}).json())


class RealtimeTests(APITransactionTestCase):
    """Channels closes "old" DB connections around consumer calls, which breaks TestCase's wrapping transaction."""

    def test_cashier_socket_receives_walk_in_order(self):
        cashier = User.objects.create_user(username='cashier', password='x', role=R.CASHIER)
        server = User.objects.create_user(username='server', password='x', role=R.SERVER)
        RestaurantTable.objects.create(number=7, capacity=2)
        tea = Dish.objects.create(name='Thé', price=Decimal('2.00'))
        self.client.force_authenticate(server)

        async def scenario():
            ws = WebsocketCommunicator(NotificationConsumer.as_asgi(), '/ws/')
            ws.scope['user'] = cashier
            self.assertTrue((await ws.connect())[0])
            await sync_to_async(self.client.post)(
                '/api/orders/', {'table_number': 7, 'items': [{'dish': tea.pk, 'quantity': 1}]}, format='json')
            messages = [await ws.receive_json_from(timeout=5), await ws.receive_json_from(timeout=5)]
            await ws.disconnect()
            return messages

        opened, created = async_to_sync(scenario)()
        self.assertEqual((opened['event'], created['event']), ('seance_opened', 'order_created'))
        self.assertEqual(created['payload']['id'], Order.objects.get().pk)

    def test_socket_auth_via_jwt_query_token(self):
        from rest_framework_simplejwt.tokens import AccessToken

        from config.asgi import application
        user = User.objects.create_user(username='manager', password='x', role=R.ADMIN_MANAGER)

        async def connect(query):
            ws = WebsocketCommunicator(application, f'/ws/{query}', headers=[(b'origin', b'http://localhost')])
            connected, _ = await ws.connect()
            await ws.disconnect()
            return connected

        self.assertTrue(async_to_sync(connect)(f'?token={AccessToken.for_user(user)}'))
        self.assertFalse(async_to_sync(connect)('?token=garbage'))
        self.assertFalse(async_to_sync(connect)(''))
