import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from candidate_windows import CandidateSet, CandidateWindow
from validation.targets import EVENT_COMPAT
from validation.types import EventTypeMetrics, GroundTruth, GroundTruthEvent, ScoreResult


def _iou(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    inter_start = max(a_start, b_start)
    inter_end = min(a_end, b_end)
    inter = max(0.0, inter_end - inter_start)
    if inter == 0.0:
        return 0.0
    union = (a_end - a_start) + (b_end - b_start) - inter
    return inter / union if union > 0.0 else 0.0


def _quality_bucket(signal_quality: float) -> str:
    if signal_quality >= 0.7:
        return "high"
    if signal_quality >= 0.3:
        return "medium"
    return "low"


def _fn_quality_bucket(gt_event: GroundTruthEvent, candidates: CandidateSet) -> str:
    gt_type = gt_event["type"]
    gt_start = gt_event["start_sec"]
    gt_end = gt_start + gt_event["duration_sec"]
    compatible_labels = {label for label, types in EVENT_COMPAT.items() if gt_type in types}
    best_quality = -1.0
    fallback_quality = -1.0
    for cand in candidates.windows:
        if cand.label not in compatible_labels:
            continue
        fallback_quality = max(fallback_quality, cand.signal_quality)
        if min(cand.end_sec, gt_end) > max(cand.start_sec, gt_start):
            best_quality = max(best_quality, cand.signal_quality)
    quality = best_quality if best_quality >= 0.0 else fallback_quality
    return _quality_bucket(quality) if quality >= 0.0 else "unknown"


def _build_gt_compat_types(candidate_label: str) -> list[str]:
    return EVENT_COMPAT.get(candidate_label, [])


def _scorable_labels() -> set[str]:
    return {label for label, types in EVENT_COMPAT.items() if types}


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    sv = sorted(values)
    idx = pct / 100.0 * (len(sv) - 1)
    lo, hi = int(idx), min(int(idx) + 1, len(sv) - 1)
    return sv[lo] + (idx - lo) * (sv[hi] - sv[lo])


def _empty_metrics() -> EventTypeMetrics:
    return EventTypeMetrics(
        sensitivity=0.0,
        fp_per_hour=0.0,
        mean_onset_error_sec=0.0,
        p50_onset_error_sec=0.0,
        p90_onset_error_sec=0.0,
        mean_duration_error_sec=0.0,
        near_miss_count=0,
        missed_event_ids=[],
        false_positive_ids=[],
        tp_count=0,
        fn_count=0,
        fp_count=0,
    )


def _compute_metrics(
    tp_pairs: list[tuple[CandidateWindow, GroundTruthEvent]],
    fn_events: list[GroundTruthEvent],
    fp_candidates: list[tuple[int, CandidateWindow]],
    total_recording_sec: float,
    gt_event_count: int,
    near_miss_count: int = 0,
) -> EventTypeMetrics:
    tp_count = len(tp_pairs)
    fn_count = len(fn_events)
    fp_count = len(fp_candidates)

    sensitivity = tp_count / gt_event_count if gt_event_count > 0 else 0.0
    fp_per_hour = fp_count / (total_recording_sec / 3600.0) if total_recording_sec > 0.0 else 0.0

    onset_errors: list[float] = []
    duration_errors: list[float] = []
    for cand, gt in tp_pairs:
        onset_errors.append(abs(cand.start_sec - gt["start_sec"]))
        duration_errors.append(abs((cand.end_sec - cand.start_sec) - gt["duration_sec"]))

    mean_onset_error_sec = sum(onset_errors) / len(onset_errors) if onset_errors else 0.0
    mean_duration_error_sec = sum(duration_errors) / len(duration_errors) if duration_errors else 0.0

    return EventTypeMetrics(
        sensitivity=sensitivity,
        fp_per_hour=fp_per_hour,
        mean_onset_error_sec=mean_onset_error_sec,
        p50_onset_error_sec=_percentile(onset_errors, 50),
        p90_onset_error_sec=_percentile(onset_errors, 90),
        mean_duration_error_sec=mean_duration_error_sec,
        near_miss_count=near_miss_count,
        missed_event_ids=[gt["event_id"] for gt in fn_events],
        false_positive_ids=[str(idx) for idx, _ in fp_candidates],
        tp_count=tp_count,
        fn_count=fn_count,
        fp_count=fp_count,
    )


def score(
    candidates: CandidateSet,
    ground_truth: GroundTruth,
    iou_threshold: float = 0.3,
    reference_ahi: float | None = None,
) -> ScoreResult:
    total_sec = ground_truth["total_recording_seconds"]
    scorable = _scorable_labels()

    gt_by_type: dict[str, list[GroundTruthEvent]] = {}
    for event in ground_truth["events"]:
        gt_by_type.setdefault(event["type"], []).append(event)

    candidate_compat: dict[int, list[str]] = {}
    for i, cand in enumerate(candidates.windows):
        if cand.label in scorable:
            candidate_compat[i] = _build_gt_compat_types(cand.label)

    matched_candidate_indices: set[int] = set()
    tp_pairs_by_type: dict[str, list[tuple[CandidateWindow, GroundTruthEvent]]] = {}
    fn_by_type: dict[str, list[GroundTruthEvent]] = {}
    fp_by_candidate: dict[int, CandidateWindow] = {}
    near_miss_by_type: dict[str, int] = {}

    all_gt_types = set(gt_by_type.keys())

    for gt_type, gt_events in gt_by_type.items():
        sorted_events = sorted(gt_events, key=lambda e: e["start_sec"])
        tp_pairs_by_type[gt_type] = []
        fn_by_type[gt_type] = []
        near_miss_by_type[gt_type] = 0

        for gt_event in sorted_events:
            gt_start = gt_event["start_sec"]
            gt_end = gt_start + gt_event["duration_sec"]

            best_iou = -1.0
            best_idx = -1
            best_near_iou = -1.0

            for i, cand in enumerate(candidates.windows):
                if i in matched_candidate_indices:
                    continue
                if gt_type not in candidate_compat.get(i, []):
                    continue
                iou_val = _iou(cand.start_sec, cand.end_sec, gt_start, gt_end)
                if iou_val >= iou_threshold and iou_val > best_iou:
                    best_iou = iou_val
                    best_idx = i
                elif 0.1 <= iou_val < iou_threshold and iou_val > best_near_iou:
                    best_near_iou = iou_val

            if best_idx >= 0:
                matched_candidate_indices.add(best_idx)
                tp_pairs_by_type[gt_type].append((candidates.windows[best_idx], gt_event))
            else:
                fn_by_type[gt_type].append(gt_event)
                if best_near_iou >= 0.1:
                    near_miss_by_type[gt_type] += 1

    for i, cand in enumerate(candidates.windows):
        if i not in candidate_compat:
            continue
        if i not in matched_candidate_indices:
            fp_by_candidate[i] = cand

    fp_by_type: dict[str, list[tuple[int, CandidateWindow]]] = {t: [] for t in all_gt_types}
    for i, cand in fp_by_candidate.items():
        compat_types = candidate_compat[i]
        for gt_type in compat_types:
            if gt_type in fp_by_type:
                fp_by_type[gt_type].append((i, cand))
                break

    per_event_type: dict[str, EventTypeMetrics] = {}
    for gt_type in all_gt_types:
        per_event_type[gt_type] = _compute_metrics(
            tp_pairs=tp_pairs_by_type.get(gt_type, []),
            fn_events=fn_by_type.get(gt_type, []),
            fp_candidates=fp_by_type.get(gt_type, []),
            total_recording_sec=total_sec,
            gt_event_count=len(gt_by_type[gt_type]),
            near_miss_count=near_miss_by_type.get(gt_type, 0),
        )

    for gt_type in all_gt_types:
        if gt_type not in per_event_type:
            per_event_type[gt_type] = _empty_metrics()

    # Compute overall directly from raw pairs so p50/p90 are correct
    all_tp_pairs = [pair for pairs in tp_pairs_by_type.values() for pair in pairs]
    all_fn_events = [e for events in fn_by_type.values() for e in events]
    overall = _compute_metrics(
        tp_pairs=all_tp_pairs,
        fn_events=all_fn_events,
        fp_candidates=list(fp_by_candidate.items()),
        total_recording_sec=total_sec,
        gt_event_count=sum(len(v) for v in gt_by_type.values()),
        near_miss_count=sum(near_miss_by_type.values()),
    )

    bucket_tp: dict[str, list[tuple[CandidateWindow, GroundTruthEvent]]] = {
        "high": [], "medium": [], "low": [], "unknown": []
    }
    bucket_fp: dict[str, list[tuple[int, CandidateWindow]]] = {
        "high": [], "medium": [], "low": [], "unknown": []
    }
    bucket_fn: dict[str, list[GroundTruthEvent]] = {
        "high": [], "medium": [], "low": [], "unknown": []
    }

    for _gt_type, tp_pairs in tp_pairs_by_type.items():
        for cand, gt_event in tp_pairs:
            bucket = _quality_bucket(cand.signal_quality)
            bucket_tp[bucket].append((cand, gt_event))

    for i, cand in fp_by_candidate.items():
        bucket = _quality_bucket(cand.signal_quality)
        bucket_fp[bucket].append((i, cand))

    for _gt_type, fn_events in fn_by_type.items():
        for gt_event in fn_events:
            bucket = _fn_quality_bucket(gt_event, candidates)
            bucket_fn[bucket].append(gt_event)

    per_quality_bucket: dict[str, EventTypeMetrics] = {}
    for bucket in ("high", "medium", "low", "unknown"):
        tp_pairs_b = bucket_tp[bucket]
        fp_b = bucket_fp[bucket]
        fn_b = bucket_fn[bucket]

        tp_count = len(tp_pairs_b)
        fp_count = len(fp_b)
        fn_count = len(fn_b)

        gt_for_bucket = tp_count + fn_count
        sensitivity = tp_count / gt_for_bucket if gt_for_bucket > 0 else 0.0
        fp_per_hour = fp_count / (total_sec / 3600.0) if total_sec > 0.0 else 0.0

        onset_errors = [abs(c.start_sec - g["start_sec"]) for c, g in tp_pairs_b]
        dur_errors = [abs((c.end_sec - c.start_sec) - g["duration_sec"]) for c, g in tp_pairs_b]

        per_quality_bucket[bucket] = EventTypeMetrics(
            sensitivity=sensitivity,
            fp_per_hour=fp_per_hour,
            mean_onset_error_sec=sum(onset_errors) / len(onset_errors) if onset_errors else 0.0,
            p50_onset_error_sec=_percentile(onset_errors, 50),
            p90_onset_error_sec=_percentile(onset_errors, 90),
            mean_duration_error_sec=sum(dur_errors) / len(dur_errors) if dur_errors else 0.0,
            near_miss_count=0,
            missed_event_ids=[e["event_id"] for e in fn_b],
            false_positive_ids=[str(i) for i, _ in fp_b],
            tp_count=tp_count,
            fn_count=fn_count,
            fp_count=fp_count,
        )

    flow_reduction_count = sum(
        1 for cand in candidates.windows if cand.label == "provisional_flow_reduction"
    )
    estimated_ahi = flow_reduction_count / (total_sec / 3600.0) if total_sec > 0.0 else 0.0

    return ScoreResult(
        record_id=ground_truth["record_id"],
        per_event_type=per_event_type,
        overall=overall,
        per_quality_bucket=per_quality_bucket,
        estimated_ahi=estimated_ahi,
        reference_ahi=reference_ahi,
    )
