"""table zones: which table is a person sitting at?

each zone is a polygon around a table and its chairs, in fractions of the image (0 to 1), so the same
zones work whatever the video size. a person belongs to a table when their anchor point (between the
hips) is inside the polygon. the optional "outline" is the shape of the tabletop itself: it is only used
to draw the table nicely on the video (the zone, larger, is used for counting).
"""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Zone:
    table_number: int
    capacity: int
    polygon: tuple  # ((x, y), ...) with 0 <= x, y <= 1
    outline: tuple = ()  # the tabletop, for drawing (empty: draw the zone itself)

    def in_pixels(self, width, height, shape=None):
        return np.array([[x * width, y * height] for x, y in (shape or self.polygon)], dtype=np.float32)

    def outline_in_pixels(self, width, height):
        return self.in_pixels(width, height, self.outline or self.polygon)

    def contains(self, point, width, height):
        # pointPolygonTest returns > 0 inside, 0 on the edge, < 0 outside
        return cv2.pointPolygonTest(self.in_pixels(width, height), (float(point[0]), float(point[1])), False) >= 0


def zones_from_config(rows):
    """the zones as the resto api (or a demo json file) gives them."""
    def points(rows_of_points):
        return tuple((float(x), float(y)) for x, y in rows_of_points or ())
    return [Zone(int(r['table_number']), int(r['capacity']), points(r['polygon']), points(r.get('outline')))
            for r in rows]


def table_of(point, zones, width, height):
    """the table whose zone contains the point, or None. zones should not overlap; if they do, the first wins."""
    for zone in zones:
        if zone.contains(point, width, height):
            return zone.table_number
    return None
