"""follows each person from frame to frame with deepsort.

why track at all? a detector alone sees each frame on its own, so a person hidden for one frame
(a waiter walks in front) would make the count drop and come back. deepsort keeps a person's id
across frames: it predicts where each person moves (a kalman filter) and compares how they look
(an "appearance embedding" from a small neural network, mobilenet), so the same guest keeps the same id.
"""
from dataclasses import dataclass

import numpy as np


@dataclass
class TrackedPerson:
    track_id: str
    box: np.ndarray  # [x1, y1, x2, y2]
    keypoints: np.ndarray | None  # the pose of the detection matched this frame (None if only predicted)
    confirmed: bool  # seen in a few frames in a row: a real person, not a one-frame false alarm
    confidence: float  # the detector's confidence for this frame's match (0 when only predicted)


class PersonTracker:
    def __init__(self, use_gpu=False, max_age=30, n_init=3):
        from deep_sort_realtime.deepsort_tracker import DeepSort  # heavy import, kept out of the unit tests

        # max_age: how many frames a person can stay hidden before we forget them
        # n_init: how many frames in a row before a new person counts as "confirmed"
        self.tracker = DeepSort(max_age=max_age, n_init=n_init, embedder='mobilenet',
                                half=use_gpu, embedder_gpu=use_gpu, bgr=True)

    def update(self, detections, frame):
        """feed this frame's detections, get back everyone currently tracked."""
        raw = [([float(d.box[0]), float(d.box[1]), float(d.box[2] - d.box[0]), float(d.box[3] - d.box[1])],
                d.confidence, 'person') for d in detections]
        tracks = self.tracker.update_tracks(raw, frame=frame, others=[d.keypoints for d in detections])
        people = []
        for track in tracks:
            if track.is_deleted():
                continue
            matched = track.time_since_update == 0  # seen in this very frame
            people.append(TrackedPerson(
                track_id=str(track.track_id),
                box=np.asarray(track.to_ltrb(), dtype=np.float32),
                keypoints=track.get_det_supplementary() if matched else None,
                confirmed=track.is_confirmed() and matched,
                confidence=float(track.det_conf or 0) if matched else 0.0,
            ))
        return people
