from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterator


@dataclass(frozen=True)
class PropagationSamplingPolicy:
    """Tiered trajectory storage cadence around a propagation generation time.

    History and the near future retain the configured base cadence because those
    samples drive the interactive UI. Farther predictions are stored more
    sparsely; position queries interpolate between samples and track queries
    decimate server-side, so a uniform 60-second grid across two weeks is wasted
    storage for normal monitoring use.
    """

    base_step_seconds: int
    near_horizon_hours: int = 24
    mid_horizon_hours: int = 72
    mid_step_seconds: int = 300
    far_step_seconds: int = 900

    def __post_init__(self) -> None:
        if self.base_step_seconds <= 0:
            raise ValueError("base_step_seconds must be positive")
        if self.near_horizon_hours <= 0:
            raise ValueError("near_horizon_hours must be positive")
        if self.mid_horizon_hours <= self.near_horizon_hours:
            raise ValueError("mid_horizon_hours must be greater than near_horizon_hours")
        if self.mid_step_seconds <= 0 or self.far_step_seconds <= 0:
            raise ValueError("tier step sizes must be positive")

    @property
    def effective_mid_step_seconds(self) -> int:
        return max(self.base_step_seconds, self.mid_step_seconds)

    @property
    def effective_far_step_seconds(self) -> int:
        return max(self.effective_mid_step_seconds, self.far_step_seconds)

    def step_seconds_at(self, sample_time: datetime, generated_at: datetime) -> int:
        if sample_time <= generated_at + timedelta(hours=self.near_horizon_hours):
            return self.base_step_seconds
        if sample_time <= generated_at + timedelta(hours=self.mid_horizon_hours):
            return self.effective_mid_step_seconds
        return self.effective_far_step_seconds

    def iter_sample_times(
        self,
        start: datetime,
        end: datetime,
        generated_at: datetime,
    ) -> Iterator[datetime]:
        if end < start:
            return
        cursor = start
        while cursor <= end:
            yield cursor
            cursor += timedelta(seconds=self.step_seconds_at(cursor, generated_at))

    def sample_count(self, start: datetime, end: datetime, generated_at: datetime) -> int:
        return sum(1 for _ in self.iter_sample_times(start, end, generated_at))

    def payload(self) -> dict[str, int | str]:
        return {
            "kind": "tiered-v1",
            "base_step_seconds": self.base_step_seconds,
            "near_horizon_hours": self.near_horizon_hours,
            "mid_horizon_hours": self.mid_horizon_hours,
            "mid_step_seconds": self.effective_mid_step_seconds,
            "far_step_seconds": self.effective_far_step_seconds,
        }
