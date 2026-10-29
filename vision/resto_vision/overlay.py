"""draws the table zones on the (already blurred) video: outline colour + "people / capacity"."""
import cv2

# colours are in opencv's bgr order (blue, green, red)
FREE = (94, 197, 34)  # green
OCCUPIED = (68, 68, 239)  # red
WHITE, INK = (255, 255, 255), (23, 25, 28)


def draw_zones(frame, zones, states):
    height, width = frame.shape[:2]
    for zone in zones:
        state = states.get(zone.table_number)
        occupied = bool(state and state.occupied)
        color = OCCUPIED if occupied else FREE
        points = zone.in_pixels(width, height).astype('int32')
        cv2.polylines(frame, [points], isClosed=True, color=color, thickness=2)
        label = f'T{zone.table_number}  {state.people if state else 0}/{zone.capacity}'
        x, y = int(points[:, 0].min()), int(points[:, 1].min())
        (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(frame, (x, max(0, y - h - 10)), (x + w + 10, y), color, thickness=-1)
        cv2.putText(frame, label, (x + 5, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 1, cv2.LINE_AA)
    return frame
