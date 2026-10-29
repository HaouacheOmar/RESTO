"""blurs every person before a frame leaves the worker.

how it looks: a soft, transparent blur shaped like the person (an ellipse whose edges fade into the
background), not rectangles or pixel squares. the body gets a light blur, so you still see a silhouette and
understand the room; the head gets a much stronger blur, so a face can never be recognised.

how it works (and why it is fast):
1. we make two blurred copies of the whole frame, on a small copy of the image (blurring a small image is
   much cheaper, and once enlarged again it looks the same): one light, one strong;
2. we draw a "stencil" (an alpha mask: 0 = keep the original, 1 = use the blurred copy) with an ellipse
   per person, and an ellipse per head;
3. we soften the stencil's edges (feathering), so the blur fades in instead of stopping at a hard line;
4. we mix: pixel = original x (1 - alpha) + blurred x alpha.

privacy rules:
- we blur with a low confidence threshold, and also where the tracker expects a person who was not
  detected this frame: when in doubt, we blur ("fail closed");
- some areas are always blurred, whatever the model sees ("privacy masks"): the far end of the room,
  doors and windows onto the street, where passers-by never agreed to be filmed;
- if something goes wrong, we send a black frame rather than an unblurred one.
"""
from functools import lru_cache

import cv2
import numpy as np

PADDING = 0.15  # grow each person by 15% so hair, arms and edges are covered too
SCALE = 4  # the blurred copies are computed on an image 4 times smaller (fast)
LIGHT, STRONG = 1.0, 3.0  # blur strength on the small image (x4 once enlarged): body (light), head and masks (strong)
FEATHER = 0.25  # how soft the edges are, as a fraction of each ellipse's size
HEAD_KEYPOINTS = (0, 1, 2, 3, 4)  # nose, left eye, right eye, left ear, right ear (coco order)
VISIBLE = 0.30


def _blurred_copy(frame, sigma):
    """the whole frame blurred: shrink, blur, enlarge back."""
    height, width = frame.shape[:2]
    small = cv2.resize(frame, (max(1, width // SCALE), max(1, height // SCALE)), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), sigmaX=sigma)
    return cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)


def head_box(box, keypoints):
    """the head of a person: around the visible face keypoints, or the top quarter of the box."""
    x1, y1, x2, y2 = box
    height, width = y2 - y1, x2 - x1
    points = [] if keypoints is None else [k for i, k in enumerate(keypoints) if i in HEAD_KEYPOINTS and k[2] >= VISIBLE]
    if points:
        cx, cy = float(np.mean([p[0] for p in points])), float(np.mean([p[1] for p in points]))
        size = max(width * 0.6, height * 0.24)  # a head is about this big compared with the body
        return cx - size / 2, cy - size * 0.6, cx + size / 2, cy + size * 0.5
    return x1, y1, x2, y1 + height * 0.3  # no face keypoints (seen from behind): the top of the box


def _ellipse(alpha, box, scale=1.0):
    """adds a filled ellipse that fits the box (made `scale` times bigger) to the stencil."""
    x1, y1, x2, y2 = box
    center = (int((x1 + x2) / 2), int((y1 + y2) / 2))
    axes = (max(1, int((x2 - x1) / 2 * scale)), max(1, int((y2 - y1) / 2 * scale)))
    cv2.ellipse(alpha, center, axes, 0, 0, 360, 1.0, thickness=-1, lineType=cv2.LINE_AA)


def _feather(alpha, size):
    """softens the stencil's edges so the blur fades in (computed small, it is fast)."""
    if size < 2:
        return alpha
    height, width = alpha.shape
    small = cv2.resize(alpha, (max(1, width // SCALE), max(1, height // SCALE)), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), sigmaX=max(0.5, size / SCALE / 2))
    soft = cv2.resize(small, (width, height), interpolation=cv2.INTER_LINEAR)
    return np.maximum(soft, alpha * 0.85)  # keep the inside fully covered even after softening


def _mix(frame, blurred, alpha):
    """pixel = blurred x alpha + original x (1 - alpha), done by opencv in c++ (much faster than numpy)."""
    return cv2.blendLinear(blurred, frame, alpha, 1.0 - alpha)


def blur_people(frame, people):
    """returns a blurred copy of the frame.

    people: a list of (box, keypoints) where box is (x1, y1, x2, y2) and keypoints may be None.
    """
    if not people:
        return frame.copy()
    height, width = frame.shape[:2]
    body, head = np.zeros((height, width), np.float32), np.zeros((height, width), np.float32)
    sizes = []
    for box, keypoints in people:
        x1, y1, x2, y2 = (float(v) for v in box)
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        _ellipse(body, (x1, y1, x2, y2), scale=1 + PADDING * 2)
        _ellipse(head, head_box((x1, y1, x2, y2), keypoints), scale=1.3)
        sizes.append(y2 - y1)
    if not sizes:
        return frame.copy()
    soft = float(np.median(sizes)) * FEATHER
    out = _mix(frame, _blurred_copy(frame, LIGHT), _feather(body, soft))  # the body: light, see-through blur
    return _mix(out, _blurred_copy(frame, STRONG), _feather(head, soft * 0.6))  # the head: strong blur


@lru_cache(maxsize=8)
def _mask_stencil(masks, width, height):
    """the soft stencil of the privacy masks. a fixed camera's masks never move: we build it once."""
    alpha = np.zeros((height, width), np.float32)
    for polygon in masks:
        points = np.array([[x * width, y * height] for x, y in polygon], dtype=np.int32)
        cv2.fillPoly(alpha, [points], 1.0, lineType=cv2.LINE_AA)
    return _feather(alpha, min(width, height) * 0.04)


def blur_masks(frame, masks):
    """strongly blurs every privacy mask (polygons in fractions of the image), with soft edges, in place."""
    if not masks:
        return frame
    height, width = frame.shape[:2]
    key = tuple(tuple((float(x), float(y)) for x, y in polygon) for polygon in masks)  # hashable, for the cache
    frame[:] = _mix(frame, _blurred_copy(frame, STRONG), _mask_stencil(key, width, height))
    return frame


def safe_frame(frame):
    """what we send when the pipeline fails: a black image of the same size, never the raw frame."""
    return np.zeros_like(frame)
