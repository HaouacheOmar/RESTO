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
| `resto_vision/privacy.py` | soft see-through blur on each person, stronger on the head, feathered edges; privacy masks; black frame on error |
| `resto_vision/stream.py` | `/healthz`, `/metrics`, the blurred MJPEG stream and a blurred still image (HMAC ticket) |
| `resto_vision/reporter.py` | camera config from the API, readings to the API (retries, heartbeat) |
| `resto_vision/overlay.py` | draws each tabletop's outline in its status colour, a light fill and a rounded "T3  2/4" label; four rounded corner marks around each confident person (none inside privacy masks) |
| `resto_vision/source.py` | reads the camera in its own thread, always keeps the newest frame (no growing delay) |
| `resto_vision/pipeline.py` | display part (detect + blur, every frame) and analysis part (DeepSORT + counts, 5 per second) |

## Run

With the whole stack: `docker compose --profile vision up --build` (the worker reads the demo clip in a loop; open *Surveillance* as `manager` or `reservations`).

On an NVIDIA GPU (smooth video, about 25 images per second instead of about 8 on a CPU):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile vision up --build
```

The video and the counting run in separate threads: the display (YOLO + blur) shows the newest camera frame as fast as the hardware allows, while DeepSORT and the table counts run a few times per second (`ANALYSIS_FPS`). Privacy never depends on the slow part: every frame is blurred with detections made on that same frame.

For a real camera: the manager adds it in the app (*Gérance → Caméras*: name, id, and the zone it covers, like "Salle VIP"), copies the token shown
once, then draws the tables and privacy masks on a still image of the camera. The worker reads its zones again every
minute (`CONFIG_EVERY`), so redrawing never needs a restart. Scripted setup also works:
`python manage.py monitoring_camera salle "Salle principale" --zones zones.json` (in `server/`).

Several cameras (several zones, a big room): one worker per camera, each with its own token. Behind nginx, name each worker
`vision-<camera id>`: `/stream/<camera id>/…` is sent to `http://vision-<camera id>:8090`. A table is watched by one
camera only, so nobody is counted twice where two views overlap.

```bash
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
