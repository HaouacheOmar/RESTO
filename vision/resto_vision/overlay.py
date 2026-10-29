"""draws on the (already blurred) video:
- each table: its tabletop outlined in its status colour, a light see-through fill, and a small rounded label
  "T3  2/4" (table number, seated people / places);
- each person: four soft rounded corners around them (lighter than a full rectangle, like a camera's focus marks).
"""
import cv2

# the design system's colours, in opencv's bgr order (blue, green, red)
FREE = (61, 128, 21)  # success green #15803d
OCCUPIED = (74, 166, 212)  # champagne gold #d4a64a
INK, IVORY = (23, 25, 28), (249, 250, 250)
FILL = 0.18  # how visible the fill is (0 = invisible, 1 = solid)
FONT = cv2.FONT_HERSHEY_DUPLEX


def _pill(frame, text, center_x, bottom_y, color, text_color):
    """a rounded label: a rectangle with a half circle at each end."""
    (w, h), _ = cv2.getTextSize(text, FONT, 0.5, 1)
    radius = h // 2 + 6
    left, right = int(center_x - w / 2), int(center_x + w / 2)
    top, bottom = int(bottom_y - 2 * radius), int(bottom_y)
    cv2.rectangle(frame, (left, top), (right, bottom), color, -1, cv2.LINE_AA)
    cv2.circle(frame, (left, top + radius), radius, color, -1, cv2.LINE_AA)
    cv2.circle(frame, (right, top + radius), radius, color, -1, cv2.LINE_AA)
    cv2.putText(frame, text, (left, top + radius + h // 2), FONT, 0.5, text_color, 1, cv2.LINE_AA)


# corner (x, y) of the box, which way the marks go (dx, dy), and the quarter of circle that rounds it
CORNERS = ((0, 1, 1, 1, 180), (2, 1, -1, 1, 270), (0, 3, 1, -1, 90), (2, 3, -1, -1, 0))


def _corners(frame, box, color, thickness):
    length = max(6, int(min(box[2] - box[0], box[3] - box[1]) * 0.22))  # each mark: 22% of the box's short side
    radius = max(2, length // 3)  # the rounded part
    for xi, yi, dx, dy, angle in CORNERS:
        x, y = int(box[xi]), int(box[yi])
        cx, cy = x + dx * radius, y + dy * radius  # centre of the rounded part
        cv2.ellipse(frame, (cx, cy), (radius, radius), 0, angle, angle + 90, color, thickness, cv2.LINE_AA)
        cv2.line(frame, (cx, y), (x + dx * length, y), color, thickness, cv2.LINE_AA)  # along the top or bottom
        cv2.line(frame, (x, cy), (x, y + dy * length), color, thickness, cv2.LINE_AA)  # along the side


def draw_people(frame, boxes):
    """four rounded corner marks around each person: a thin dark shadow, then ivory on top (readable on light
    and dark backgrounds)."""
    for box in boxes:
        _corners(frame, box, INK, 4)
    for box in boxes:
        _corners(frame, box, IVORY, 2)
    return frame


def draw_zones(frame, zones, states):
    height, width = frame.shape[:2]
    shapes = []
    for zone in zones:
        state = states.get(zone.table_number)
        color = OCCUPIED if state and state.occupied else FREE
        shapes.append((zone, state, color, zone.outline_in_pixels(width, height).astype('int32')))

    # 1. a light see-through fill on every tabletop (drawn on a copy, then mixed in)
    layer = frame.copy()
    for _, _, color, points in shapes:
        cv2.fillPoly(layer, [points], color, cv2.LINE_AA)
    cv2.addWeighted(layer, FILL, frame, 1 - FILL, 0, dst=frame)

    # 2. the outline of each tabletop, smooth (anti-aliased), and its label just above it
    for zone, state, color, points in shapes:
        cv2.polylines(frame, [points], True, color, 2, cv2.LINE_AA)
        people = state.people if state else 0
        label = f'T{zone.table_number}  {people}/{zone.capacity}'
        _pill(frame, label, points[:, 0].mean(), points[:, 1].min() - 6, color,
              INK if color == OCCUPIED else IVORY)
    return frame
