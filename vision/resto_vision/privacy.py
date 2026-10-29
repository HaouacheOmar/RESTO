"""blurs every person before a frame leaves the worker.

rules (privacy by design):
- we blur the whole person, not only the face: the model can miss a face, it rarely misses a body;
- we blur with a low confidence threshold, and also where the tracker expects a person who was not
  detected this frame: when in doubt, we blur ("fail closed");
- we pixelate (big squares) and then smooth: the original details cannot be recovered;
- some areas are always pixelated, whatever the model sees ("privacy masks"): doors and windows onto
  the street, where passers-by never agreed to be filmed;
- if something goes wrong, we send a black frame rather than an unblurred one.
"""
import cv2
import numpy as np

PADDING = 0.12  # grow each box by 12% so hair, arms and edges are covered too
BLOCKS = 10  # each person is reduced to about 10x10 squares


def blur_people(frame, boxes):
    """returns a copy of the frame where every box (x1, y1, x2, y2) is pixelated."""
    out = frame.copy()
    height, width = out.shape[:2]
    for x1, y1, x2, y2 in boxes:
        pad_x, pad_y = (x2 - x1) * PADDING, (y2 - y1) * PADDING
        left, top = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
        right, bottom = min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y))
        if right - left < 2 or bottom - top < 2:
            continue
        region = out[top:bottom, left:right]
        small = cv2.resize(region, (BLOCKS, max(1, BLOCKS * (bottom - top) // max(1, right - left))),
                           interpolation=cv2.INTER_LINEAR)
        blocky = cv2.resize(small, (right - left, bottom - top), interpolation=cv2.INTER_NEAREST)
        out[top:bottom, left:right] = cv2.GaussianBlur(blocky, (0, 0), sigmaX=3)
    return out


def blur_masks(frame, masks):
    """pixelates every privacy mask (polygons in fractions of the image) in place."""
    height, width = frame.shape[:2]
    for polygon in masks:
        points = np.array([[x * width, y * height] for x, y in polygon], dtype=np.int32)
        inside = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(inside, [points], 255)  # a black and white stencil of the mask
        small = cv2.resize(frame, (max(1, width // 24), max(1, height // 24)), interpolation=cv2.INTER_LINEAR)
        blocky = cv2.resize(small, (width, height), interpolation=cv2.INTER_NEAREST)
        frame[inside > 0] = blocky[inside > 0]  # copy the pixelated pixels only where the stencil is white
    return frame


def safe_frame(frame):
    """what we send when the pipeline fails: a black image of the same size, never the raw frame."""
    return np.zeros_like(frame)
