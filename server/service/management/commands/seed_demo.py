from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from accounts.models import User
from catalog.models import DailySpecial, Dish, Ingredient, RestaurantTable, Supplier

PASSWORD = 'demo-resto-2026'
R = User.Role

ACCOUNTS = [  # username, role, first name, last name
    ('manager', R.ADMIN_MANAGER, 'Samir', 'Belkacem'),
    ('reservations', R.RESERVATION_MANAGER, 'Nadia', 'Hamidi'),
    ('chef', R.CHEF, 'Yacine', 'Mansouri'),
    ('waiter', R.SERVER, 'Rania', 'Kaci'),
    ('cashier', R.CASHIER, 'Farid', 'Ouali'),
    ('driver', R.DELIVERER, 'Karim', 'Bensalem'),
    ('parking', R.PARKING_ATTENDANT, 'Mourad', 'Ait'),
    ('stock', R.STOCK_MANAGER, 'Lina', 'Cherif'),
    ('client', R.CLIENT, 'Amel', 'Saidi'),
]

TABLES = [(1, 2, 'STANDARD'), (2, 2, 'STANDARD'), (3, 4, 'STANDARD'), (4, 4, 'STANDARD'), (5, 6, 'STANDARD'),
          (6, 8, 'STANDARD'), (10, 4, 'VIP'), (11, 6, 'VIP'), (12, 8, 'VIP')]

INGREDIENTS = [('Semoule', 'kg', 25), ('Agneau', 'kg', 12), ('Poulet', 'kg', 15), ('Tomate', 'kg', 20),
               ('Pois chiches', 'kg', 8), ('Pâte feuilletée', 'kg', 5), ('Thé vert', 'kg', 2), ('Menthe', 'bottes', 30),
               ('Amandes', 'kg', 4), ('Miel', 'L', 3), ('Oeufs', 'unités', 120), ('Pomme de terre', 'kg', 30)]

CARTE = [  # name, description, price, recipe
    ('Couscous royal', 'Semoule, agneau, poulet et légumes.', '1800', ['Semoule', 'Agneau', 'Poulet', 'Tomate', 'Pois chiches']),
    ('Tajine zitoune', 'Poulet aux olives et pommes de terre.', '1400', ['Poulet', 'Pomme de terre']),
    ('Chakhchoukha', 'Galette émiettée, sauce rouge et agneau.', '1500', ['Agneau', 'Tomate', 'Pois chiches']),
    ('Bourek', 'Feuilles croustillantes farcies.', '400', ['Pâte feuilletée', 'Agneau', 'Oeufs']),
    ('Chorba frik', 'Soupe de blé vert à l’agneau.', '600', ['Agneau', 'Tomate', 'Pois chiches']),
    ('Salade méchouia', 'Poivrons et tomates grillés.', '500', ['Tomate']),
    ('Frites maison', '', '300', ['Pomme de terre']),
    ('Baklawa', 'Feuilleté aux amandes et au miel.', '350', ['Amandes', 'Miel', 'Pâte feuilletée']),
    ('Thé à la menthe', '', '150', ['Thé vert', 'Menthe']),
    ('Eau minérale', '', '100', []),
]

SUPPLIERS = [('Meubles du Centre', Supplier.Category.EQUIPMENT, '0550 11 22 33'),
             ('Marché de gros Boumerdès', Supplier.Category.INGREDIENTS, '0661 44 55 66')]


class Command(BaseCommand):
    help = 'Fill the database with a demo restaurant (idempotent: safe to run again).'

    @transaction.atomic
    def handle(self, *args, **options):
        for username, role, first, last in ACCOUNTS:
            user, _ = User.objects.update_or_create(username=username, defaults={
                'role': role, 'first_name': first, 'last_name': last, 'email': f'{username}@resto.demo',
                'is_staff': role == R.ADMIN_MANAGER, 'is_superuser': role == R.ADMIN_MANAGER})
            user.set_password(PASSWORD)
            user.save()
        for number, capacity, zone in TABLES:
            RestaurantTable.objects.update_or_create(number=number, defaults={'capacity': capacity, 'zone': zone})
        ingredients = {name: Ingredient.objects.update_or_create(name=name, defaults={
            'unit': unit, 'quantity_in_stock': qty})[0] for name, unit, qty in INGREDIENTS}
        for name, description, price, recipe in CARTE:
            dish, _ = Dish.objects.update_or_create(name=name, defaults={
                'description': description, 'price': Decimal(price)})
            dish.ingredients.set(ingredients[i] for i in recipe)
        DailySpecial.objects.update_or_create(date=timezone.localdate(), defaults={
            'name': 'Rechta au poulet', 'description': 'Nouilles fraîches, sauce blanche, poulet et navets.',
            'price': Decimal('1200')})
        for name, category, phone in SUPPLIERS:
            Supplier.objects.update_or_create(name=name, defaults={'category': category, 'contact_phone': phone})

        self.stdout.write(self.style.SUCCESS('Demo restaurant ready.'))
        self.stdout.write(f'Accounts (password "{PASSWORD}"): ' + ', '.join(a[0] for a in ACCOUNTS))
