from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN_MANAGER = 'ADMIN_MANAGER', 'Gérant'
        RESERVATION_MANAGER = 'RESERVATION_MANAGER', 'Responsable réservation'
        CHEF = 'CHEF', 'Chef'
        SERVER = 'SERVER', 'Serveur'
        CASHIER = 'CASHIER', 'Caissier'
        DELIVERER = 'DELIVERER', 'Livreur'
        PARKING_ATTENDANT = 'PARKING_ATTENDANT', 'Stationneur'
        STOCK_MANAGER = 'STOCK_MANAGER', 'Gestionnaire de stock'
        CLIENT = 'CLIENT', 'Client'

    class Availability(models.TextChoices):
        AVAILABLE = 'AVAILABLE'
        BUSY = 'BUSY'
        OFFLINE = 'OFFLINE'

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CLIENT)
    phone = models.CharField(max_length=20, blank=True)
    # Only meaningful for deliverers.
    availability = models.CharField(max_length=10, choices=Availability.choices, default=Availability.AVAILABLE)


class JobApplication(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING'
        ACCEPTED = 'ACCEPTED'
        REJECTED = 'REJECTED'

    full_name = models.CharField(max_length=100)
    phone = models.CharField(max_length=20)
    requested_role = models.CharField(max_length=20, choices=[
        (User.Role.DELIVERER, 'Livreur'), (User.Role.PARKING_ATTENDANT, 'Stationneur'),
    ])
    username = models.CharField(max_length=150)  # only unique among accounts: a rejected person may re-apply
    password = models.CharField(max_length=128)  # hashed with make_password
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.full_name} ({self.requested_role})'
