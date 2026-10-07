from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import JobApplication, User


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, validators=[validate_password])

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name', 'role', 'phone',
                  'availability', 'is_active']

    def validate(self, data):
        if self.instance is None and not data.get('password'):
            raise serializers.ValidationError({'password': 'Requis à la création.'})
        return data

    def create(self, data):
        return User.objects.create_user(**data)

    def update(self, user, data):
        password = data.pop('password', None)
        if password:
            user.set_password(password)
        return super().update(user, data)


class RegisterSerializer(serializers.ModelSerializer):
    """Public client sign-up: email + username + password."""
    email = serializers.EmailField(required=True)
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password', 'first_name', 'last_name', 'phone']

    def create(self, data):
        return User.objects.create_user(role=User.Role.CLIENT, **data)


class JobApplicationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = JobApplication
        fields = ['id', 'full_name', 'phone', 'requested_role', 'username', 'password', 'status', 'created_at']
        read_only_fields = ['status']

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('Ce nom d’utilisateur est déjà pris.')
        return value

    def create(self, data):
        data['password'] = make_password(data['password'])
        return super().create(data)
