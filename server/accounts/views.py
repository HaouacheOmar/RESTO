from django.db import transaction
from rest_framework import generics, permissions
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import JobApplication, User
from .permissions import PUBLIC, RoleViewSet
from .serializers import JobApplicationSerializer, RegisterSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class UserViewSet(RoleViewSet):
    """Manager creates staff accounts. The reservation manager may read (to pick an available deliverer)."""
    serializer_class = UserSerializer
    read_roles = (User.Role.RESERVATION_MANAGER,)

    def get_queryset(self):
        qs = User.objects.order_by('username')
        for field in ('role', 'availability'):
            if value := self.request.query_params.get(field):
                qs = qs.filter(**{field: value})
        return qs


class JobApplicationViewSet(RoleViewSet):
    """Deliverer / parking attendant candidates apply publicly; the manager accepts or rejects."""
    queryset = JobApplication.objects.order_by('-created_at')
    serializer_class = JobApplicationSerializer
    http_method_names = ['get', 'post', 'delete']
    action_roles = {'create': PUBLIC}

    def _pending(self):
        application = self.get_object()
        if application.status != JobApplication.Status.PENDING:
            raise ValidationError('Candidature déjà traitée.')
        return application

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

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        application = self._pending()
        application.status = JobApplication.Status.REJECTED
        application.save()
        return Response(self.get_serializer(application).data)
