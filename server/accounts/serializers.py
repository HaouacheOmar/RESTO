from django.contrib.auth.hashers import make_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
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


class PasswordResetConfirmSerializer(serializers.Serializer):
    """The `uid` and `token` from the emailed link, and the new password."""
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(data['uid'])), is_active=True)
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            user = None
        if user is None or not default_token_generator.check_token(user, data['token']):
            raise serializers.ValidationError({'token': 'Ce lien n’est plus valable. Demandez-en un nouveau.'})
        try:
            validate_password(data['password'], user)
        except DjangoValidationError as error:
            raise serializers.ValidationError({'password': list(error.messages)})
        return {**data, 'user': user}
