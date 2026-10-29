"""unit tests of the worker's logic. they run without the model (fakes replace yolo and deepsort)."""
import hashlib
import hmac
import time

import numpy as np

from resto_vision.config import Settings
from resto_vision.occupancy import OccupancyTracker
from resto_vision.pipeline import Pipeline
from resto_vision.posture import Posture, anchor, posture
from resto_vision.privacy import blur_masks, blur_people
from resto_vision.stream import check_ticket
from resto_vision.tracker import TrackedPerson
from resto_vision.zones import Zone, table_of


def keypoints(shoulder_y, hip_y, knee_y, x=100.0, knees_visible=True):
    """a fake pose: 17 coco keypoints, only shoulders, hips and knees filled in."""
    k = np.zeros((17, 3), dtype=np.float32)
    for i in (5, 6):
        k[i] = (x, shoulder_y, 0.9)
    for i in (11, 12):
        k[i] = (x, hip_y, 0.9)
    for i in (13, 14):
        k[i] = (x, knee_y, 0.9 if knees_visible else 0.0)
    return k


BOX = np.array([50, 0, 150, 300], dtype=np.float32)


# ---------------------------------------------------------------- posture
def test_seated_when_the_knees_are_at_hip_height():
    assert posture(keypoints(shoulder_y=100, hip_y=200, knee_y=215), BOX) is Posture.SEATED


def test_standing_when_the_knees_are_far_below_the_hips():
    assert posture(keypoints(shoulder_y=100, hip_y=200, knee_y=290), BOX) is Posture.STANDING


def test_hidden_legs_fall_back_on_the_box_shape():
    hidden = keypoints(100, 200, 0, knees_visible=False)
    assert posture(hidden, np.array([0, 0, 100, 150])) is Posture.SEATED  # 1.5x taller than wide
    assert posture(hidden, np.array([0, 0, 100, 320])) is Posture.STANDING  # 3.2x: a standing shape


def test_anchor_is_between_the_hips():
    assert anchor(keypoints(100, 200, 215, x=120), BOX) == (120.0, 200.0)


# ---------------------------------------------------------------- zones
SQUARE = Zone(1, 3, ((0.0, 0.0), (0.5, 0.0), (0.5, 0.5), (0.0, 0.5)))


def test_a_point_belongs_to_the_zone_it_is_in():
    assert table_of((100, 100), [SQUARE], 1000, 1000) == 1
    assert table_of((800, 800), [SQUARE], 1000, 1000) is None


# ---------------------------------------------------------------- occupancy (smoothing + waiting)
def test_a_table_becomes_occupied_only_after_a_few_seconds():
    tracker = OccupancyTracker([1], now=0, occupied_after=4, empty_after=20, window=1)
    assert not tracker.update({1: 2}, now=1)[1].occupied  # just sat down: not yet
    assert not tracker.update({1: 2}, now=3)[1].occupied
    state = tracker.update({1: 2}, now=5.5)[1]
    assert (state.occupied, state.people, state.since) == (True, 2, 5.5)


def test_one_bad_frame_does_not_change_anything():
    tracker = OccupancyTracker([1], now=0, occupied_after=1, empty_after=5, window=3)
    for t in range(0, 5):
        tracker.update({1: 2}, now=t)
    assert tracker.update({1: 0}, now=5)[1].people == 2  # the median of the last 3 s is still 2


def test_a_table_becomes_empty_only_after_a_longer_wait():
    tracker = OccupancyTracker([1], now=0, occupied_after=1, empty_after=10, window=1)
    for t in range(0, 4):
        tracker.update({1: 2}, now=t)
    assert tracker.update({1: 0}, now=8)[1].occupied  # stepped away for 4 s: still occupied
    state = tracker.update({1: 0}, now=20)[1]
    assert (state.occupied, state.people) == (False, 0)


# ---------------------------------------------------------------- privacy
def test_blur_changes_the_person_and_nothing_else():
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (200, 200, 3), dtype=np.uint8)
    original = frame.copy()
    out = blur_people(frame, [(50, 50, 100, 150)])
    assert not np.array_equal(out[60:140, 60:90], frame[60:140, 60:90])  # the person is changed
    assert np.array_equal(out[180:, 180:], frame[180:, 180:])  # far away pixels are untouched
    assert np.array_equal(frame, original)  # the input frame itself is never modified


def test_privacy_masks_are_always_pixelated():
    rng = np.random.default_rng(2)
    frame = rng.integers(0, 255, (100, 100, 3), dtype=np.uint8)
    original = frame.copy()
    blur_masks(frame, [[[0.0, 0.0], [0.5, 0.0], [0.5, 0.5], [0.0, 0.5]]])  # the top-left quarter
    assert not np.array_equal(frame[:45, :45], original[:45, :45])
    assert np.array_equal(frame[60:, 60:], original[60:, 60:])


# ---------------------------------------------------------------- stream ticket
def test_ticket_must_be_signed_for_this_camera_and_not_expired():
    secret, expires = 's3cret', int(time.time()) + 60
    signature = hmac.new(secret.encode(), f'salle.{expires}'.encode(), hashlib.sha256).hexdigest()
    ticket = f'salle.{expires}.{signature}'
    assert check_ticket(ticket, 'salle', secret)
    assert not check_ticket(ticket, 'terrasse', secret)  # another camera
    assert not check_ticket(ticket, 'salle', 'other-secret')  # forged
    assert not check_ticket(ticket, 'salle', secret, now=expires + 1)  # expired
    assert not check_ticket('garbage', 'salle', secret)
    assert not check_ticket(ticket, 'salle', '')  # no secret configured: nothing is accepted


# ---------------------------------------------------------------- the whole pipeline, with fakes
class FakeDetector:
    def __init__(self, detections=None, fail=False):
        self.detections, self.fail = detections or [], fail

    def detect(self, frame):
        if self.fail:
            raise RuntimeError('model crashed')
        return self.detections


class FakeTracker:
    def __init__(self, people):
        self.people = people

    def update(self, detections, frame):
        return self.people


def guest(x, standing=False, confidence=0.9, confirmed=True):
    knee = 290 if standing else 215
    return TrackedPerson(track_id=str(x), box=np.array([x - 50, 0, x + 50, 300], dtype=np.float32),
                         keypoints=keypoints(100, 200, knee, x=x), confirmed=confirmed, confidence=confidence)


def test_pipeline_counts_only_confident_seated_people_in_the_zone():
    settings = Settings(occupied_after=0, count_window=1)
    zone = Zone(1, 3, ((0.0, 0.0), (0.5, 0.0), (0.5, 1.0), (0.0, 1.0)))  # the left half of the image
    people = [guest(100), guest(200),  # two seated guests at table 1
              guest(300, standing=True),  # a waiter standing at the table
              guest(150, confidence=0.2),  # a doubtful detection
              guest(800)]  # someone seated at another place, outside the zone
    pipeline = Pipeline(settings, [zone], detector=FakeDetector(), tracker=FakeTracker(people))
    frame = np.full((300, 1000, 3), 128, dtype=np.uint8)
    pipeline.process(frame, now=0)
    _, states, _ = pipeline.process(frame, now=1)
    assert (states[1].occupied, states[1].people) == (True, 2)


def test_pipeline_sends_a_black_frame_if_the_model_fails():
    settings = Settings()
    pipeline = Pipeline(settings, [], detector=FakeDetector(fail=True), tracker=FakeTracker([]))
    frame = np.full((50, 50, 3), 200, dtype=np.uint8)
    output, _, _ = pipeline.process(frame, now=0)
    assert not output.any()  # all black: never the raw frame


def test_pipeline_blurs_people_even_when_they_are_only_predicted():
    settings = Settings()
    hidden = TrackedPerson('7', np.array([10, 10, 60, 90], dtype=np.float32), None, confirmed=False, confidence=0.0)
    pipeline = Pipeline(settings, [], detector=FakeDetector([]), tracker=FakeTracker([hidden]))
    rng = np.random.default_rng(1)
    frame = rng.integers(0, 255, (100, 100, 3), dtype=np.uint8)
    output, _, _ = pipeline.process(frame, now=0)
    assert not np.array_equal(output[20:80, 20:50], frame[20:80, 20:50])


def test_settings_are_read_from_the_environment(monkeypatch):
    monkeypatch.setenv('TARGET_FPS', '5')
    import importlib

    import resto_vision.config as config
    assert importlib.reload(config).Settings().target_fps == 5.0
