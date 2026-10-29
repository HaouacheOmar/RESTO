"""all the worker settings, read from environment variables (the usual way to configure a container)."""
import os
from dataclasses import dataclass


def _env(name, default):
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    # where the video comes from: a file path (demo) or a camera url like rtsp://user:pass@10.0.0.5/stream
    source: str = _env('VIDEO_SOURCE', 'samples/restaurant.mp4')
    loop: bool = _env('VIDEO_LOOP', '1') == '1'  # replay a file forever (demo); ignored for a camera

    # the resto api, and this camera's secret token (from "manage.py monitoring_camera")
    api_url: str = _env('RESTO_API_URL', 'http://backend:8000').rstrip('/')
    device_token: str = _env('RESTO_DEVICE_TOKEN', '')

    # the model: yolo26 nano pose is small and fast enough for a cpu; "cuda:0" uses an nvidia gpu
    model: str = _env('MODEL', 'yolo26n-pose.pt')
    device: str = _env('DEVICE', 'cpu')
    image_size: int = int(_env('IMAGE_SIZE', '640'))  # 960 finds smaller, far people but is slower; masks cover the far end
    count_confidence: float = float(_env('COUNT_CONFIDENCE', '0.40'))  # sure enough to count someone
    blur_confidence: float = float(_env('BLUR_CONFIDENCE', '0.10'))  # much lower: when in doubt, blur
    target_fps: float = float(_env('TARGET_FPS', '25'))  # most frames shown per second (smooth video)
    analysis_fps: float = float(_env('ANALYSIS_FPS', '5'))  # table counting per second (deepsort is slower)

    # smoothing: how long a table must look occupied (or empty) before we believe it
    occupied_after: float = float(_env('OCCUPIED_AFTER', '4'))  # seconds
    empty_after: float = float(_env('EMPTY_AFTER', '20'))  # longer: someone may step away for a moment
    count_window: float = float(_env('COUNT_WINDOW', '3'))  # seconds of counts averaged together

    # how often we send the counts (also when nothing changed, so the api knows we are alive)
    report_every: float = float(_env('REPORT_EVERY', '3'))
    # how often we read the camera's zones and masks again (the manager may redraw them in the app)
    config_every: float = float(_env('CONFIG_EVERY', '60'))

    # the blurred video stream
    stream_port: int = int(_env('STREAM_PORT', '8090'))
    stream_secret: str = _env('MONITORING_STREAM_SECRET', '')  # same secret as the api, to check tickets
    jpeg_quality: int = int(_env('JPEG_QUALITY', '70'))
