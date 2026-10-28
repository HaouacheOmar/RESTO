from django.contrib.admin.apps import AdminConfig


class RestoAdminConfig(AdminConfig):
    default_site = 'config.admin.RestoAdminSite'
