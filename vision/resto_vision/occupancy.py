"""turns noisy per-frame counts into a calm table state.

a single frame can be wrong (someone hidden, a false detection). so for each table we:
1. smooth the count: we take the median of the counts of the last few seconds;
2. wait before changing state ("hysteresis"): a table must look occupied for a few seconds before it
   becomes occupied, and look empty for longer before it becomes empty (a guest may step away).
time is passed in (`now`, in seconds) instead of read from the clock, so the tests can control it.
"""
from collections import deque
from dataclasses import dataclass

import numpy as np


@dataclass
class TableState:
    table_number: int
    people: int  # smoothed number of seated people (0 when the table is empty)
    occupied: bool
    since: float  # time (seconds) when the current occupied/empty state began


class _Table:
    def __init__(self, number, now):
        self.state = TableState(number, 0, False, now)
        self.counts = deque()  # (time, count) for the last `window` seconds
        self.pending_since = None  # when the other state started to look true


class OccupancyTracker:
    def __init__(self, table_numbers, now, occupied_after=4.0, empty_after=20.0, window=3.0):
        self.tables = {n: _Table(n, now) for n in table_numbers}
        self.occupied_after, self.empty_after, self.window = occupied_after, empty_after, window

    def update(self, counts, now):
        """counts: {table number: seated people seen in this frame}. returns the state of every table."""
        for number, table in self.tables.items():
            table.counts.append((now, counts.get(number, 0)))
            while table.counts and table.counts[0][0] < now - self.window:
                table.counts.popleft()  # forget counts older than the window
            smoothed = int(round(float(np.median([c for _, c in table.counts]))))

            looks_occupied = smoothed > 0
            if looks_occupied == table.state.occupied:
                table.pending_since = None  # nothing to change
            else:
                if table.pending_since is None:
                    table.pending_since = now  # the change starts to look true now
                wait = self.occupied_after if looks_occupied else self.empty_after
                if now - table.pending_since >= wait:  # it stayed true long enough: we believe it
                    table.state.occupied, table.state.since, table.pending_since = looks_occupied, now, None

            # an empty table always counts 0; an occupied one shows the smoothed count
            table.state.people = smoothed if table.state.occupied else 0
        return {n: TableState(**vars(t.state)) for n, t in self.tables.items()}
