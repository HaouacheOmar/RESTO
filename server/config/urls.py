from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from accounts import views as accounts
from catalog import views as catalog
from service import views as service

router = DefaultRouter()
router.register('users', accounts.UserViewSet, basename='user')
router.register('job-applications', accounts.JobApplicationViewSet)
router.register('suppliers', catalog.SupplierViewSet)
router.register('tables', catalog.RestaurantTableViewSet, basename='table')
router.register('dishes', catalog.DishViewSet, basename='dish')
router.register('daily-specials', catalog.DailySpecialViewSet)
router.register('ingredients', catalog.IngredientViewSet)
router.register('stock-requests', catalog.StockRequestViewSet)
router.register('reservations', service.ReservationViewSet, basename='reservation')
router.register('orders', service.OrderViewSet, basename='order')
router.register('seances', service.SeanceViewSet, basename='seance')
router.register('additions', service.AdditionViewSet, basename='addition')
router.register('reviews', service.ReviewViewSet, basename='review')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/auth/token/', TokenObtainPairView.as_view()),
    path('api/auth/token/refresh/', TokenRefreshView.as_view()),
    path('api/auth/register/', accounts.RegisterView.as_view()),
    path('api/auth/me/', accounts.MeView.as_view()),
    path('api/menu/', catalog.MenuView.as_view()),
    path('api/dashboard/', service.DashboardView.as_view()),
    path('api/', include(router.urls)),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
