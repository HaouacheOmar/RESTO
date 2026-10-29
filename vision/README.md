# RESTO vision worker

Counts the guests seated at each table and blurs everyone in the video. It runs next to the camera, sends only numbers to the RESTO API (`server/monitoring/`), and serves a blurred stream to the manager and the reservation desk.

```
frame → YOLO26 pose (people + keypoints) → DeepSORT (same id frame to frame) → seated or standing?
      → which table zone? → smoothing (median + delays) → blur everyone + privacy masks
      → blurred MJPEG stream (/<camera>/mjpeg, signed ticket)  +  counts → RESTO API
```

| File | Role |
| :--- | :--- |
| `resto_vision/detector.py` | YOLO26 pose (`yolo26n-pose.pt`) |
| `resto_vision/tracker.py` | DeepSORT (Kalman filter + MobileNet appearance) |
| `resto_vision/posture.py` | seated vs standing from hips/knees, box shape when the legs are hidden |
| `resto_vision/zones.py` | table polygons (fractions of the image) |
| `resto_vision/occupancy.py` | median smoothing + hysteresis (occupied after 4 s, empty after 20 s) |
| `resto_vision/privacy.py` | pixelates every person and the privacy masks; black frame on error |
| `resto_vision/stream.py` | `/healthz`, `/metrics`, the blurred MJPEG stream (HMAC ticket) |
| `resto_vision/reporter.py` | camera config from the API, readings to the API (retries, heartbeat) |
| `resto_vision/pipeline.py` | one frame in, blurred frame + table states out |

## Run

With the whole stack: `docker compose --profile vision up --build` (the worker reads the demo clip in a loop; open *Surveillance* as `manager` or `reservations`).

For a real camera:

```bash
python manage.py monitoring_camera salle "Salle principale" --zones zones.json   # in server/, prints the device token
# then run the worker with:
VIDEO_SOURCE=rtsp://user:pass@10.0.0.5/stream RESTO_API_URL=https://api… RESTO_DEVICE_TOKEN=… \
MONITORING_STREAM_SECRET=… DEVICE=cuda:0 python -m resto_vision run
```

Settings (environment): see `resto_vision/config.py`. The model and the demo clip are downloaded at image build time and checked against their SHA-256.

## Develop

```bash
python -m venv .venv && .venv/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest tests        # no model needed: yolo and deepsort are replaced by fakes
```

Demo assets for the public site: see `samples/README.md`.
