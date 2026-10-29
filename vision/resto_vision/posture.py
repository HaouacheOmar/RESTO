"""decides if a person is seated or standing, from their body keypoints.

we only count seated people: a waiter standing next to a table is not a guest.

the idea, with coco keypoints (y grows downwards in an image):
- standing: the knees are far below the hips, about as far as the hips are below the shoulders.
- seated: the thighs are roughly horizontal, so the knees are almost at the same height as the hips.
we compare the hip-to-knee height with the shoulder-to-hip height (the torso), so it works at any distance.

seated guests often have their legs hidden under the table. then we fall back on the shape of the box:
a seated person's box is much less tall than a standing person's box.
"""
from enum import Enum

import numpy as np

# indexes of the 17 coco keypoints we need
LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP, LEFT_KNEE, RIGHT_KNEE = 5, 6, 11, 12, 13, 14
VISIBLE = 0.35  # a keypoint below this confidence is treated as hidden

SEATED_THIGH_RATIO = 0.45  # knee drop smaller than 45% of the torso: thighs are flat, seated
STANDING_THIGH_RATIO = 0.65  # knee drop larger than 65% of the torso: legs are straight, standing
SEATED_MAX_ASPECT = 2.0  # fallback: a box less than 2x taller than wide is a seated shape


class Posture(Enum):
    SEATED = 'seated'
    STANDING = 'standing'
    UNKNOWN = 'unknown'


def _mean_y(keypoints, indexes):
    """average height of the visible keypoints among `indexes`, or None if none is visible."""
    ys = [keypoints[i][1] for i in indexes if keypoints[i][2] >= VISIBLE]
    return float(np.mean(ys)) if ys else None


def posture(keypoints, box):
    shoulders = None if keypoints is None else _mean_y(keypoints, (LEFT_SHOULDER, RIGHT_SHOULDER))
    hips = None if keypoints is None else _mean_y(keypoints, (LEFT_HIP, RIGHT_HIP))
    knees = None if keypoints is None else _mean_y(keypoints, (LEFT_KNEE, RIGHT_KNEE))

    if shoulders is not None and hips is not None and knees is not None and hips > shoulders:
        torso = hips - shoulders
        thigh_drop = knees - hips
        if thigh_drop < SEATED_THIGH_RATIO * torso:
            return Posture.SEATED
        if thigh_drop > STANDING_THIGH_RATIO * torso:
            return Posture.STANDING
        return Posture.UNKNOWN  # in between: we do not guess

    # the knees are hidden (often under the table): use the shape of the box instead
    width, height = float(box[2] - box[0]), float(box[3] - box[1])
    if width <= 0:
        return Posture.UNKNOWN
    return Posture.SEATED if height / width < SEATED_MAX_ASPECT else Posture.STANDING


def anchor(keypoints, box):
    """the point that says where a person sits: between the hips, or the lower middle of the box."""
    hips = None if keypoints is None else [keypoints[i] for i in (LEFT_HIP, RIGHT_HIP) if keypoints[i][2] >= VISIBLE]
    if hips:
        return float(np.mean([h[0] for h in hips])), float(np.mean([h[1] for h in hips]))
    return float((box[0] + box[2]) / 2), float(box[1] + 0.75 * (box[3] - box[1]))
