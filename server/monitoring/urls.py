from django.urls import path

from . import views

# all these urls live under /api/monitoring/ (see config/urls.py)
urlpatterns = [
    # for the screens of the manager and the reservation desk
    path('tables/', views.MonitoredTablesView.as_view()),
    path('cameras/', views.CameraListView.as_view()),
    path('cameras/<slug:slug>/stream/', views.StreamTicketView.as_view()),
    # for the manager: add cameras, draw their tables and privacy masks
    path('setup/cameras/', views.CameraSetupListView.as_view()),
    path('setup/cameras/<slug:slug>/', views.CameraSetupView.as_view()),
    path('setup/cameras/<slug:slug>/token/', views.CameraTokenView.as_view()),
    # for the vision worker (signed in with its device token)
    path('device/config/', views.DeviceConfigView.as_view()),
    path('device/observations/', views.DeviceObservationView.as_view()),
]
