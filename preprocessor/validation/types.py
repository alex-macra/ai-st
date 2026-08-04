# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
from typing import TypedDict


class GroundTruthEvent(TypedDict):
    event_id: str
    type: str
    start_sec: float
    duration_sec: float
    metric: float | None


class GroundTruth(TypedDict):
    record_id: str
    events: list[GroundTruthEvent]
    signal_channels: list[str]
    total_recording_seconds: float


class EventTypeMetrics(TypedDict):
    sensitivity: float
    fp_per_hour: float
    mean_onset_error_sec: float
    p50_onset_error_sec: float
    p90_onset_error_sec: float
    mean_duration_error_sec: float
    near_miss_count: int
    missed_event_ids: list[str]
    false_positive_ids: list[str]
    tp_count: int
    fn_count: int
    fp_count: int


class ScoreResult(TypedDict):
    record_id: str
    per_event_type: dict[str, EventTypeMetrics]
    overall: EventTypeMetrics
    per_quality_bucket: dict[str, EventTypeMetrics]
    estimated_ahi: float
    reference_ahi: float | None
