from channels.generic.websocket import AsyncJsonWebsocketConsumer

from accounts.models import User

R = User.Role

GROUPS = {
    R.ADMIN_MANAGER: ['manager', 'kitchen_pos', 'reservations', 'parking', 'deliveries'],
    R.RESERVATION_MANAGER: ['reservations', 'deliveries'],
    R.CHEF: [],
    R.SERVER: ['kitchen_pos'],
    R.CASHIER: ['kitchen_pos'],
    R.DELIVERER: ['deliveries'],
    R.PARKING_ATTENDANT: ['parking'],
    R.STOCK_MANAGER: [],
    R.CLIENT: [],
}


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    """One socket per user: joins the groups of its role plus its personal `user_<id>` group. Push-only.

    Channels leaves every group in `self.groups` on disconnect.
    """

    async def connect(self):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.close(code=4401)
            return
        self.groups = GROUPS.get(user.role, []) + [f'user_{user.pk}']
        for group in self.groups:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def notify(self, message):
        await self.send_json({'event': message['event'], 'payload': message['payload']})
