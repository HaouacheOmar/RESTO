from django.conf import settings
from django.db import transaction
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
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from service.events import broadcast

from .models import JobApplication, User
from .permissions import PUBLIC, RoleViewSet
from .serializers import JobApplicationSerializer, RegisterSerializer, UserSerializer


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


class UserViewSet(RoleViewSet):
    serializer_class = UserSerializer
    read_roles = (User.Role.RESERVATION_MANAGER,)

    def get_queryset(self):
        qs = User.objects.order_by('username')
        for field in ('role', 'availability'):
            if value := self.request.query_params.get(field):
                qs = qs.filter(**{field: value})
        return qs


class JobApplicationViewSet(RoleViewSet):
    queryset = JobApplication.objects.order_by('-created_at')
    serializer_class = JobApplicationSerializer
    http_method_names = ['get', 'post', 'delete']
    action_roles = {'create': PUBLIC}

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
