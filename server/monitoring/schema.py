from drf_spectacular.extensions import OpenApiAuthenticationExtension


class DeviceTokenScheme(OpenApiAuthenticationExtension):
    """tells the api documentation (swagger) how the vision worker signs in."""
    target_class = 'monitoring.auth.DeviceTokenAuthentication'
    name = 'deviceToken'

    def get_security_definition(self, auto_schema):
        return {'type': 'apiKey', 'in': 'header', 'name': 'Authorization',
                'description': 'Vision worker: "Device <token>" (from manage.py monitoring_camera).'}
