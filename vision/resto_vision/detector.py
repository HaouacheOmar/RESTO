"""finds people in a frame with yolo pose."""
from dataclasses import dataclass

import numpy as np

PERSON = 0  # in the coco dataset the model learned from, class 0 is "person"


@dataclass
class Detection:
    box: np.ndarray  # [x1, y1, x2, y2] in pixels: the rectangle around the person
    confidence: float  # how sure the model is (0 to 1)
    keypoints: np.ndarray  # 17 rows of [x, y, confidence]: nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles


class PoseDetector:
    """wraps the ultralytics yolo pose model.

    we ask for every person above the low "blur" confidence: the privacy step must blur even people the
    model is unsure about. the counting step later keeps only the confident ones.
    """

    def __init__(self, model_path, device='cpu', image_size=640, min_confidence=0.15):
        from ultralytics import YOLO  # imported here so the unit tests do not need the model

        self.model = YOLO(model_path)
        self.device, self.image_size, self.min_confidence = device, image_size, min_confidence

    def detect(self, frame):
        result = self.model.predict(frame, classes=[PERSON], conf=self.min_confidence, imgsz=self.image_size,
                                    device=self.device, verbose=False)[0]
        if result.boxes is None or len(result.boxes) == 0:
            return []
        boxes = result.boxes.xyxy.cpu().numpy()
        scores = result.boxes.conf.cpu().numpy()
        keypoints = result.keypoints.data.cpu().numpy() if result.keypoints is not None else \
            np.zeros((len(boxes), 17, 3), dtype=np.float32)
        return [Detection(box=b, confidence=float(s), keypoints=k) for b, s, k in zip(boxes, scores, keypoints)]
