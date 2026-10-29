"""the worker's command line.

    python -m resto_vision run
        live: reads the camera (or a looping file), sends the counts to the api, serves the blurred stream.

    python -m resto_vision render --input clip.mp4 --zones zones.json --out demo.mp4 --timeline timeline.json
        offline: makes the public demo assets. a blurred copy of the clip, and the table readings over time,
        so the demo website can replay them in sync with the video (no worker runs on the demo hosting).
"""
import argparse
import json
import logging
import threading
import time

import cv2

from .config import Settings
from .pipeline import Pipeline
from .reporter import Reporter
from .stream import FrameBuffer, create_app
from .zones import zones_from_config

log = logging.getLogger('resto_vision')


def run(settings):
    if not settings.device_token:
        raise SystemExit('RESTO_DEVICE_TOKEN is missing (create one with: manage.py monitoring_camera)')
    reporter = Reporter(settings.api_url, settings.device_token, settings.report_every)
    config = reporter.config()
    zones = zones_from_config(config['zones'])
    log.info('camera %s: watching %d table(s) on %s', config['camera'], len(zones), settings.source)

    # the web server (stream + health + metrics) runs in a background thread
    buffer = FrameBuffer()
    import uvicorn
    server = uvicorn.Server(uvicorn.Config(create_app(buffer, config['camera'], settings.stream_secret),
                                           host='0.0.0.0', port=settings.stream_port, log_level='warning'))
    threading.Thread(target=server.run, daemon=True).start()

    pipeline = Pipeline(settings, zones, masks=config.get('privacy_masks', []))
    capture = cv2.VideoCapture(settings.source)
    is_file = not settings.source.lower().startswith(('rtsp://', 'http://', 'https://'))
    file_fps = capture.get(cv2.CAP_PROP_FPS) or 25
    step = 1.0 / settings.target_fps
    next_frame_at = time.monotonic()

    while True:
        ok, frame = capture.read()
        if not ok:
            if is_file and settings.loop:  # demo file: start again from the beginning
                capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            log.warning('video source lost, reconnecting in 2s')
            time.sleep(2)
            capture.release()
            capture = cv2.VideoCapture(settings.source)
            continue
        if is_file:
            time.sleep(1.0 / file_fps)  # play a file at its real speed, like a camera would
        if time.monotonic() < next_frame_at:
            continue  # skip frames to stay at target_fps (saves cpu, plenty for table occupancy)
        next_frame_at = time.monotonic() + step

        output, states, stats = pipeline.process(frame, time.time())
        ok, jpeg = cv2.imencode('.jpg', output, [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality])
        if ok:
            buffer.publish(jpeg.tobytes(), **stats)
        reporter.maybe_send(states, time.time())


def render(settings, input_path, zones_path, out_path, timeline_path):
    with open(zones_path, encoding='utf-8') as f:
        config = json.load(f)  # same shape as the api's camera config: {"zones": [...], "privacy_masks": [...]}
    zones = zones_from_config(config['zones'])
    pipeline = Pipeline(settings, zones, masks=config.get('privacy_masks', []))
    capture = cv2.VideoCapture(input_path)
    fps = capture.get(cv2.CAP_PROP_FPS) or 25
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*'mp4v'), fps, (width, height))
    timeline, last, index = [], None, 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        t = index / fps  # video time, so the replay stays in sync with the clip
        output, states, _ = pipeline.process(frame, t)  # every frame is analysed: every frame is blurred
        writer.write(output)
        snapshot = [{'table_number': s.table_number, 'people': s.people, 'occupied': s.occupied}
                    for s in sorted(states.values(), key=lambda s: s.table_number)]
        if snapshot != last:  # only the moments where something changes
            timeline.append({'t': round(t, 2), 'tables': snapshot})
            last = snapshot
        index += 1
    writer.release()
    with open(timeline_path, 'w', encoding='utf-8') as f:
        json.dump({'fps': fps, 'duration': round(index / fps, 2), 'events': timeline}, f)
    log.info('rendered %d frames, %d timeline events', index, len(timeline))


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s: %(message)s')
    logging.getLogger('httpx').setLevel(logging.WARNING)  # one line per api call would flood the logs
    parser = argparse.ArgumentParser(prog='resto_vision')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('run', help='live worker')
    offline = commands.add_parser('render', help='blurred demo clip + timeline')
    offline.add_argument('--input', required=True)
    offline.add_argument('--zones', required=True)
    offline.add_argument('--out', required=True)
    offline.add_argument('--timeline', required=True)
    args = parser.parse_args()
    settings = Settings()
    if args.command == 'run':
        run(settings)
    else:
        render(settings, args.input, args.zones, args.out, args.timeline)


if __name__ == '__main__':
    main()
