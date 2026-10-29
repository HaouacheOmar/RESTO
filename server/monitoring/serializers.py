from rest_framework import serializers

from .models import Camera

# a "serializer" checks the json that comes in (and shapes the json that goes out).


class ObservedTableSerializer(serializers.Serializer):
    """what the worker saw at one table."""
    table_number = serializers.IntegerField(min_value=1)
    people = serializers.IntegerField(min_value=0, max_value=50)
    occupied = serializers.BooleanField()
    since = serializers.DateTimeField()

    def validate(self, data):
        # an empty table cannot have people in it: refuse readings that make no sense
        if not data['occupied'] and data['people']:
            raise serializers.ValidationError('Une table vide ne peut pas compter de personnes.')
        return data


class ObservationBatchSerializer(serializers.Serializer):
    """what the worker sends every few seconds: the state of every table its camera can see."""
    observed_at = serializers.DateTimeField()
    tables = ObservedTableSerializer(many=True, max_length=200)


class CameraSerializer(serializers.ModelSerializer):
    online = serializers.BooleanField(read_only=True)  # the worker talked to us recently
    live = serializers.BooleanField(read_only=True)  # a live video stream can be opened

    class Meta:
        model = Camera
        fields = ['slug', 'name', 'online', 'live', 'replay_video', 'replay_timeline']
