"""draws each table on the (already blurred) video: its tabletop outlined in its status colour, a light
see-through fill, and a small rounded label "T3  2/4" (table number, seated people / places)."""
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
