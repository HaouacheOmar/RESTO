"""a small web server inside the worker.

- GET /healthz            is the worker alive and reading video?
- GET /metrics            numbers for monitoring tools (prometheus text format)
- GET /<camera>/mjpeg     the blurred video, as mjpeg (a stream of jpeg images that an <img> tag can show)

the video needs a ticket made by the resto api (signed with a secret both sides know), so only the
manager and the reservation desk can open it. the frames here are always the blurred ones.
"""
import asyncio
import hashlib
import hmac
import threading
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import PlainTextResponse, StreamingResponse


def check_ticket(ticket, slug, secret, now=None):
    """true when the ticket is for this camera, not expired, and signed with our secret."""
    try:
        ticket_slug, expires, signature = ticket.split('.')
    except (AttributeError, ValueError):
        return False
    expected = hmac.new(secret.encode(), f'{ticket_slug}.{expires}'.encode(), hashlib.sha256).hexdigest()
    return (bool(secret) and hmac.compare_digest(signature, expected)  # compare_digest: safe against timing attacks
            and ticket_slug == slug and expires.isdigit() and int(expires) >= (now or time.time()))


class FrameBuffer:
    """holds the latest blurred jpeg, shared between the video loop (writer) and the viewers (readers)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.jpeg, self.updated_at = None, 0.0
        self.metrics = {'frames_total': 0, 'inference_seconds': 0.0, 'people_detected': 0, 'tables_occupied': 0}

    def publish(self, jpeg, **metrics):
        with self.lock:
            self.jpeg, self.updated_at = jpeg, time.time()
            self.metrics['frames_total'] += 1
            self.metrics.update(metrics)

    def latest(self):
        with self.lock:
            return self.jpeg, self.updated_at


def create_app(buffer, camera_slug, secret):
    app = FastAPI(title='RESTO vision worker', docs_url=None, redoc_url=None)

    @app.get('/healthz')
    def healthz():
        _, updated_at = buffer.latest()
        alive = time.time() - updated_at < 10  # a new frame in the last 10 seconds
        if not alive:
            raise HTTPException(status_code=503, detail='no recent frame')
        return {'status': 'ok', 'camera': camera_slug}

    @app.get('/metrics', response_class=PlainTextResponse)
    def metrics():
        with buffer.lock:
            values = dict(buffer.metrics)
        return ''.join(f'resto_vision_{name} {value}\n' for name, value in values.items())

    @app.get('/{slug}/mjpeg')
    async def mjpeg(slug: str, ticket: str = Query(...)):
        if slug != camera_slug or not check_ticket(ticket, slug, secret):
            raise HTTPException(status_code=403, detail='invalid or expired ticket')

        async def frames():
            last = 0.0
            while True:
                jpeg, updated_at = buffer.latest()
                if jpeg is not None and updated_at != last:
                    last = updated_at
                    yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n'
                await asyncio.sleep(0.05)

        return StreamingResponse(frames(), media_type='multipart/x-mixed-replace; boundary=frame')

    return app
