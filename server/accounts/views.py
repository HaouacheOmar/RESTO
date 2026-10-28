import logging

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, permissions, serializers
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from service.events import broadcast

from config.lists import ScopedListMixin

from .middleware import issue_ticket
from .models import JobApplication, User
from .permissions import PUBLIC, RoleViewSet
from .serializers import (JobApplicationSerializer, PasswordResetConfirmSerializer, RegisterSerializer,
                          UserSerializer)

log = logging.getLogger(__name__)


# The refresh token never reaches JavaScript: it lives in an httpOnly cookie only sent to /api/auth/.
REFRESH_COOKIE = 'resto_refresh'
COOKIE_PATH = '/api/auth/'
AccessOnly = inline_serializer('AccessToken', {'access': serializers.CharField()})


def _set_refresh_cookie(response, refresh):
    response.set_cookie(
        REFRESH_COOKIE, refresh, max_age=int(jwt_settings.REFRESH_TOKEN_LIFETIME.total_seconds()),
        httponly=True, secure=not settings.DEBUG, samesite='Strict', path=COOKIE_PATH,
    )


class LoginView(TokenObtainPairView):
    """Returns the access token in the body and sets the refresh token as an httpOnly cookie."""
    throttle_scope = 'login'

    @extend_schema(responses=AccessOnly)
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        _set_refresh_cookie(response, response.data.pop('refresh'))
        return response


class RefreshView(APIView):
    """New access token from the refresh cookie (no body). 401 when the cookie is missing, expired or revoked."""
    # JWT only: gives errors a WWW-Authenticate header (so a real 401, not 403) and no session/CSRF coupling.
    authentication_classes = [JWTAuthentication]
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'refresh'

    @extend_schema(request=None, responses=AccessOnly)
    def post(self, request):
        token = request.COOKIES.get(REFRESH_COOKIE)
        if not token:
            raise InvalidToken('Aucune session.')
        serializer = TokenRefreshSerializer(data={'refresh': token})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError as error:
            raise InvalidToken(error.args[0])
        return Response({'access': serializer.validated_data['access']})


class LogoutView(APIView):
    """Revokes the refresh token (blacklist) and deletes the cookie."""
    authentication_classes = [JWTAuthentication]
    permission_classes = [permissions.AllowAny]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        token = request.COOKIES.get(REFRESH_COOKIE)
        if token:
            try:
                RefreshToken(token).blacklist()
            except TokenError:
                pass  # already expired or revoked
        response = Response(status=204)
        response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH, samesite='Strict')
        return response


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'register'


RESET_EMAIL = """Bonjour {name},

Vous avez demandé à réinitialiser votre mot de passe RESTO. Ce lien est valable une heure :

{link}

Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.

RESTO"""


class PasswordResetView(APIView):
    """Emails a reset link. Always 204, so the form never reveals which addresses have an account."""
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset'

    @extend_schema(request=inline_serializer('PasswordReset', {'email': serializers.EmailField()}), responses={204: None})
    def post(self, request):
        email = str(request.data.get('email', '')).strip()
        for user in User.objects.filter(email__iexact=email, is_active=True) if email else []:
            if not user.has_usable_password():
                continue
            uid, token = urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user)
            link = f'{settings.FRONTEND_URL}/mot-de-passe/nouveau?uid={uid}&token={token}'
            try:
                send_mail('RESTO : réinitialiser votre mot de passe',
                          RESET_EMAIL.format(name=user.first_name or user.username, link=link), None, [user.email])
            except Exception:  # an SMTP outage must not reveal anything or fail the request
                log.exception('Password reset email to user %s failed', user.pk)
        return Response(status=204)


class PasswordResetConfirmView(APIView):
    """Sets the new password from the emailed link, then signs out every session of that account."""
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_scope = 'password_reset_confirm'

    @extend_schema(request=PasswordResetConfirmSerializer, responses={204: None})
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.set_password(serializer.validated_data['password'])
        user.save(update_fields=['password'])  # also invalidates the link: the token hashes the password
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)
        return Response(status=204)


class RealtimeTicketView(APIView):
    """Single-use ticket (30 s) to open the WebSocket: `wss://<api>/ws/?ticket=<ticket>`."""

    @extend_schema(request=None, responses=inline_serializer('RealtimeTicket', {'ticket': serializers.CharField()}))
    def post(self, request):
        return Response({'ticket': issue_ticket(request.user)})


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class AvailabilityView(APIView):
    """A deliverer starts or ends their shift (AVAILABLE ⇄ OFFLINE). BUSY is only set by deliveries."""

    @extend_schema(request=inline_serializer('Availability', {
        'availability': serializers.ChoiceField([User.Availability.AVAILABLE, User.Availability.OFFLINE])}),
        responses=UserSerializer)
    @transaction.atomic
    def post(self, request):
        if request.user.role != User.Role.DELIVERER:
            raise PermissionDenied('Réservé aux livreurs.')
        wanted = request.data.get('availability')
        if wanted not in (User.Availability.AVAILABLE, User.Availability.OFFLINE):
            raise ValidationError({'availability': 'Choisir AVAILABLE ou OFFLINE.'})
        user = User.objects.select_for_update().get(pk=request.user.pk)  # same lock as assign_deliverer
        if user.availability == User.Availability.BUSY:
            raise ValidationError('Terminez d’abord votre livraison en cours.')
        user.availability = wanted
        user.save(update_fields=['availability'])
        data = UserSerializer(user).data
        broadcast('deliveries', 'driver_availability', data)
        return Response(data)


class UserViewSet(ScopedListMixin, RoleViewSet):
    """`?staff=1`: the team only (clients excluded). With `role` or `staff` the list is short and not paginated."""
    serializer_class = UserSerializer
    read_roles = (User.Role.RESERVATION_MANAGER,)
    bounded_params = ('role', 'staff')

    def get_queryset(self):
        qs = User.objects.order_by('username')
        for field in ('role', 'availability'):
            if value := self.request.query_params.get(field):
                qs = qs.filter(**{field: value})
        if self.request.query_params.get('staff'):
            qs = qs.exclude(role=User.Role.CLIENT)
        return qs

    def active_filter(self):
        return Q(is_active=True)


class JobApplicationViewSet(ScopedListMixin, RoleViewSet):
    queryset = JobApplication.objects.order_by('-created_at')
    serializer_class = JobApplicationSerializer
    http_method_names = ['get', 'post', 'delete']
    action_roles = {'create': PUBLIC}

    def active_filter(self):
        return Q(status=JobApplication.Status.PENDING)

    @property
    def throttle_scope(self):  # only the public form is limited, not the manager's reviewing
        return 'job_application' if self.action == 'create' else None

    def _pending(self):
        application = self.get_object()
        if application.status != JobApplication.Status.PENDING:
            raise ValidationError('Candidature déjà traitée.')
        return application

    @extend_schema(request=None, responses=UserSerializer)
    @action(detail=True, methods=['post'])
    @transaction.atomic
    def accept(self, request, pk=None):
        application = self._pending()
        if User.objects.filter(username=application.username).exists():
            raise ValidationError('Nom d’utilisateur déjà pris entre-temps.')
        first, _, last = application.full_name.partition(' ')
        user = User.objects.create(
            username=application.username, password=application.password,  # already hashed
            role=application.requested_role, phone=application.phone, first_name=first, last_name=last,
        )
        application.status = JobApplication.Status.ACCEPTED
        application.save()
        return Response(UserSerializer(user).data)

    @extend_schema(request=None)
    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        application = self._pending()
        application.status = JobApplication.Status.REJECTED
        application.save()
        return Response(self.get_serializer(application).data)
