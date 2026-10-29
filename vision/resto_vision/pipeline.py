"""one frame in, one blurred frame and the table states out. used by the live worker and the offline renderer."""
import logging
import time

from .occupancy import OccupancyTracker
from .overlay import draw_zones
from .posture import Posture, anchor, posture
from .privacy import blur_masks, blur_people, safe_frame
from .zones import table_of

log = logging.getLogger(__name__)


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
        self.masks = [tuple(map(tuple, m)) for m in masks]  # areas always pixelated
        self.occupancy, self.states = None, {}

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

    def process(self, frame, now):
        """returns (blurred frame with the zones drawn, table states, stats)."""
        if self.occupancy is None:
            self.occupancy = OccupancyTracker(
                [z.table_number for z in self.zones], now, occupied_after=self.settings.occupied_after,
                empty_after=self.settings.empty_after, window=self.settings.count_window)
        started = time.perf_counter()
        try:
            detections = self.detector.detect(frame)
            people = self.tracker.update(detections, frame)
            height, width = frame.shape[:2]
            self.states = self.occupancy.update(self.seated_counts(people, width, height), now)
            # blur every detection AND every tracked person (even the ones only predicted this frame)
            output = blur_people(frame, [d.box for d in detections] + [p.box for p in people])
            blur_masks(output, self.masks)
            draw_zones(output, self.zones, self.states)
            people_detected = len(detections)
        except Exception:
            # never let a raw frame out because of a bug: send a black frame and keep the last states
            log.exception('frame processing failed')
            output, people_detected = safe_frame(frame), 0
        stats = {'inference_seconds': round(time.perf_counter() - started, 4), 'people_detected': people_detected,
                 'tables_occupied': sum(1 for s in self.states.values() if s.occupied)}
        return output, self.states, stats
