from candidate_windows import CandidateSet, CandidateWindow
from validation.scorer import score
from validation.types import GroundTruth


def candidate(
    start: float,
    end: float,
    label: str = "provisional_flow_reduction",
    quality: float = 0.9,
) -> CandidateWindow:
    return CandidateWindow(
        start_sec=start,
        end_sec=end,
        label=label,
        channel="synthetic-flow",
        magnitude=0.5,
        signal_quality=quality,
    )


def candidate_set(*windows: CandidateWindow) -> CandidateSet:
    return CandidateSet(
        windows=list(windows),
        channels_used=["synthetic-flow"],
        channels_missing=[],
    )


def ground_truth(*events: tuple[str, str, float, float]) -> GroundTruth:
    return GroundTruth(
        record_id="synthetic-record",
        events=[
            {
                "event_id": event_id,
                "type": event_type,
                "start_sec": start,
                "duration_sec": duration,
                "metric": None,
            }
            for event_id, event_type, start, duration in events
        ],
        signal_channels=["synthetic-flow"],
        total_recording_seconds=3600.0,
    )


def test_scores_deterministic_matches_and_false_positives() -> None:
    result = score(
        candidate_set(candidate(10.0, 20.0), candidate(100.0, 110.0)),
        ground_truth(("event-1", "hypopnea", 10.0, 10.0)),
    )

    metrics = result["per_event_type"]["hypopnea"]
    assert metrics["tp_count"] == 1
    assert metrics["fn_count"] == 0
    assert metrics["fp_count"] == 1
    assert metrics["sensitivity"] == 1.0
    assert metrics["fp_per_hour"] == 1.0


def test_reports_near_misses_without_matching_them() -> None:
    result = score(
        candidate_set(candidate(17.0, 27.0)),
        ground_truth(("event-1", "obstructive_apnea", 10.0, 10.0)),
    )

    metrics = result["per_event_type"]["obstructive_apnea"]
    assert metrics["tp_count"] == 0
    assert metrics["fn_count"] == 1
    assert metrics["near_miss_count"] == 1


def test_stratifies_synthetic_events_by_signal_quality() -> None:
    result = score(
        candidate_set(
            candidate(10.0, 20.0, quality=0.9),
            candidate(30.0, 40.0, quality=0.5),
            candidate(50.0, 60.0, quality=0.1),
        ),
        ground_truth(
            ("high", "hypopnea", 10.0, 10.0),
            ("medium", "hypopnea", 30.0, 10.0),
            ("low", "hypopnea", 50.0, 10.0),
        ),
    )

    assert result["per_quality_bucket"]["high"]["tp_count"] == 1
    assert result["per_quality_bucket"]["medium"]["tp_count"] == 1
    assert result["per_quality_bucket"]["low"]["tp_count"] == 1


def test_estimated_index_uses_only_flow_reduction_candidates() -> None:
    result = score(
        candidate_set(
            candidate(10.0, 20.0),
            candidate(30.0, 40.0),
            candidate(50.0, 60.0, label="provisional_desaturation"),
        ),
        ground_truth(
            ("flow-1", "hypopnea", 10.0, 10.0),
            ("flow-2", "hypopnea", 30.0, 10.0),
            ("oxygen-1", "desaturation", 50.0, 10.0),
        ),
    )

    assert result["estimated_ahi"] == 2.0
