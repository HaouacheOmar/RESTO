"""the work done on frames, in two parts that can run at different speeds.

- display (fast, every frame): detect people with yolo, blur them, draw the zones. this is what you see,
  so it must be smooth; it never waits for the slower part.
- analysis (slower, a few times per second): deepsort tracking, seated or standing, table counts.
  occupancy changes over seconds, so it does not need every frame.

the live worker runs them in two threads; the offline renderer runs both on every frame (`process`).
privacy never depends on the slow part: every frame is blurred with detections made on that same frame,
plus the recent tracker positions for anyone yolo briefly misses.
"""
import logging
import threading
import time

from .occupancy import OccupancyTracker
from .overlay import draw_zones
from .posture import Posture, anchor, posture
from .privacy import blur_masks, blur_people, safe_frame
from .zones import table_of

log = logging.getLogger(__name__)
TRACK_HOLD = 1.0  # seconds: tracker boxes older than this are not used for blurring any more


class Pipeline:
    def __init__(self, settings, zones, detector=None, tracker=None, masks=()):
        # detector and tracker can be injected (the tests pass fakes instead of the real models)
        if detector is None:
            from .detector import PoseDetector
            detector = PoseDetector(settings.model, settings.device, settings.image_size, settings.blur_confidence)
        if tracker is None:
            from .tracker import PersonTracker
            tracker = PersonTracker(use_gpu=settings.device.startswith('cuda'))
        self.settings, self.zones, self.detector, self.tracker = settings, zones, detector, tracker
        self.masks = [tuple(map(tuple, m)) for m in masks]  # areas always blurred
        self.occupancy, self.states = None, {}
        # shared between the two threads, protected by a lock
        self.lock = threading.Lock()
        self.tracked, self.tracked_at = [], 0.0  # the tracker's latest boxes, and when

    def configure(self, zones, masks):
        """new zones or masks drawn by the manager, applied without restarting the worker."""
        masks = [tuple(map(tuple, m)) for m in masks]
        with self.lock:
            if [z.table_number for z in zones] != [z.table_number for z in self.zones]:
                self.occupancy, self.states = None, {}  # other tables: start counting again from zero
            self.zones, self.masks = zones, masks

    # ------------------------------------------------------------------ analysis (slow part)
    def seated_counts(self, people, width, height):
        """how many confident, seated people are inside each table zone in this frame."""
        counts = {}
        for person in people:
            if not person.confirmed or person.confidence < self.settings.count_confidence:
                continue
            if posture(person.keypoints, person.box) is not Posture.SEATED:
                continue  # standing (a waiter, someone walking by) or not sure: not counted
            table = table_of(anchor(person.keypoints, person.box), self.zones, width, height)
            if table is not None:
                counts[table] = counts.get(table, 0) + 1
        return counts

    def analyse(self, frame, detections, now):
        """track the people found in a frame, count the seated ones per table, update the table states."""
        if self.occupancy is None:
            self.occupancy = OccupancyTracker(
                [z.table_number for z in self.zones], now, occupied_after=self.settings.occupied_after,
                empty_after=self.settings.empty_after, window=self.settings.count_window)
        people = self.tracker.update(detections, frame)
        height, width = frame.shape[:2]
        states = self.occupancy.update(self.seated_counts(people, width, height), now)
        with self.lock:
            self.states = states
            self.tracked, self.tracked_at = [(p.box, p.keypoints) for p in people], time.monotonic()
        return states

    # ------------------------------------------------------------------ display (fast part)
    def blur(self, frame, detections):
        """the frame as it may leave the worker: everyone blurred, masks blurred, zones drawn."""
        with self.lock:
            recent = self.tracked if time.monotonic() - self.tracked_at <= TRACK_HOLD else []
            states, zones, masks = dict(self.states), self.zones, self.masks
        output = blur_people(frame, [(d.box, d.keypoints) for d in detections] + recent)
        blur_masks(output, masks)
        return draw_zones(output, zones, states)

    def display(self, frame):
        """returns (blurred frame, this frame's detections, stats). safe: a black frame if anything fails."""
        started = time.perf_counter()
        try:
            detections = self.detector.detect(frame)
            output = self.blur(frame, detections)
        except Exception:
            log.exception('frame processing failed')  # never let a raw frame out because of a bug
            return safe_frame(frame), [], {'inference_seconds': 0.0, 'people_detected': 0}
        return output, detections, {'inference_seconds': round(time.perf_counter() - started, 4),
                                    'people_detected': len(detections)}

    # ------------------------------------------------------------------ both, one frame (offline render, tests)
    def process(self, frame, now):
        """returns (blurred frame with the zones drawn, table states, stats)."""
        started = time.perf_counter()
        try:
            detections = self.detector.detect(frame)
            states = self.analyse(frame, detections, now)
            output = self.blur(frame, detections)
            people_detected = len(detections)
        except Exception:
            log.exception('frame processing failed')
            output, states, people_detected = safe_frame(frame), dict(self.states), 0
        stats = {'inference_seconds': round(time.perf_counter() - started, 4), 'people_detected': people_detected,
                 'tables_occupied': sum(1 for s in states.values() if s.occupied)}
        return output, states, stats
