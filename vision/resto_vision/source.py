"""reads the camera in its own thread and always keeps only the newest frame.

why? if the display is slower than the camera, reading frame after frame would fall further and further
behind (a growing delay). here the reader runs at the camera's own pace and simply overwrites the last
frame: the display always gets the most recent picture, so the feed stays live.
"""
import logging
import threading
import time

import cv2

log = logging.getLogger(__name__)


class FrameSource:
    def __init__(self, source, loop=True):
        self.source, self.loop = source, loop
        self.is_file = not source.lower().startswith(('rtsp://', 'http://', 'https://'))
        self.lock = threading.Lock()
        self.frame, self.number = None, 0  # the newest frame and its count (to know if it is new)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        capture = cv2.VideoCapture(self.source)
        fps = capture.get(cv2.CAP_PROP_FPS) or 25
        started, played = time.monotonic(), 0
        while True:
            ok, frame = capture.read()
            if not ok:
                if self.is_file and self.loop:  # demo file: start again from the beginning
                    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    started, played = time.monotonic(), 0
                    continue
                log.warning('video source lost, reconnecting in 2s')
                time.sleep(2)
                capture.release()
                capture = cv2.VideoCapture(self.source)
                continue
            with self.lock:
                self.frame, self.number = frame, self.number + 1
            if self.is_file:
                # a file is read much faster than real time: wait until this frame's moment, like a camera
                played += 1
                time.sleep(max(0.0, started + played / fps - time.monotonic()))

    def latest(self, after=0):
        """the newest frame, waiting until there is one newer than frame number `after`."""
        while True:
            with self.lock:
                if self.frame is not None and self.number > after:
                    return self.frame, self.number
            time.sleep(0.002)
