# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Heuristic detection of candidate respiratory event windows.
All outputs are labeled PROVISIONAL - never "confirmed" or "scored".
Clinical scoring is the clinician's responsibility.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Literal

import numpy as np
import pyedflib

from channels import (
    APNEA_MAGNITUDE_FLOOR,
    CO2_LABELS,
    CO2_PHYSIOLOGICAL_MAX,
    CO2_PHYSIOLOGICAL_MIN,
    FLOW_LABELS,
    POSITION_LABELS,
    QUALITY_FLOOR,
    SPO2_LABELS,
    SPO2_PHYSIOLOGICAL_MAX,
    SPO2_PHYSIOLOGICAL_MIN,
    find_channel,
    mask_outside,
    runs,
)
from edf_parser import ChannelInventory
from signal_qc import QCResults

# A detector takes (signal, sample_rate) and returns (start_sec, end_sec, magnitude).
_Detector = Callable[[np.ndarray, float], list[tuple[float, float, float]]]

# event_weight per label (used in priority_score formula)
_EVENT_WEIGHTS: dict[str, float] = {
    "provisional_desaturation": 1.0,
    "provisional_flow_reduction": 0.9,
    "provisional_hypoventilation": 0.95,
    "provisional_positional": 0.6,
}

# AASM 1B hypopnea coupling: a flow event qualifies only if a SpO2 desaturation
# ends within [event.end - 5s, event.end + 30s]. HSAT has no EEG, so the
# arousal arm of 1B is unavailable; the desat arm is the only filter we apply.
# Uncoupled events stay in the candidate set (tagged) so the clinician still
# sees them - only the headline AHI/REI uses the coupled subset.
_COUPLING_PRE_WINDOW_SEC = 5.0
_COUPLING_POST_WINDOW_SEC = 30.0
# Merge flow events separated by < this gap. Disabled (0.0) for now: merging is
# not safe per-event, because collapsing two genuinely adjacent apneas reports
# one event where there were two. Coupling and artifact tagging do the headline
# cleanup without that cost. Reintroduce only with evidence that the detector
# splits real events at a rate worth the trade.
_FLOW_MERGE_GAP_SEC = 0.0
# Amplitude floor: skip flow events whose local envelope is below this fraction
# of the global 95th-percentile |signal|. Disabled by default (0.0): real apneas
# also drive local envelope near zero, so any non-zero floor cuts true apneas.
# The artifact tag (P2, flat-interval overlap) handles the phantom-event case
# without the false-positive risk on real apneas.
_AMPLITUDE_FLOOR_FRAC = 0.0

# Tags written into CandidateWindow.notes to mark events excluded from headline
# metrics but retained as candidates for clinician review.
TAG_OVERLAPS_FLAT = "tag:overlaps_flat"
TAG_UNCOUPLED_HYPOPNEA = "tag:uncoupled_hypopnea"
TAG_POSITION_ARTIFACT = "tag:position_artifact"

# Body roll takes 2–5 s; allow another 5 s of post-arousal shallow breathing.
_POSITION_TRANSITION_PROXIMITY_SEC = 10.0


def _severity_bucket(label: str, magnitude: float) -> str:
    if label == "provisional_desaturation":
        if magnitude >= 8.0:
            return "severe"
        if magnitude >= 4.0:
            return "moderate"
        return "mild"
    if label == "provisional_hypoventilation":
        # magnitude = mean elevation above 50 mmHg CO2 threshold
        if magnitude >= 10.0:
            return "severe"
        if magnitude >= 5.0:
            return "moderate"
        return "mild"
    # flow_reduction: magnitude is fractional reduction (0–1)
    if magnitude >= 0.7:
        return "severe"
    if magnitude >= 0.5:
        return "moderate"
    return "mild"


@dataclass
class CandidateWindow:
    start_sec: float
    end_sec: float
    label: str  # e.g. "provisional_flow_reduction"
    channel: str
    magnitude: float  # fractional reduction or desaturation depth
    signal_quality: float = 1.0
    priority_score: float = 0.0
    dedupe_key: str = ""
    notes: list[str] = field(default_factory=list)
    event_id: str | None = None


@dataclass
class CandidateSet:
    windows: list[CandidateWindow]
    channels_used: list[str]
    channels_missing: list[str]  # truly absent from the EDF file
    channels_low_quality: list[str] = field(default_factory=list)  # present but below QUALITY_FLOOR
    cohort: Literal["adult", "pediatric"] = "adult"
    # Flow-event filter funnel - surfaced in study_metrics so the clinician can
    # see how many raw detections survived each rejection stage.
    flow_filter_stats: dict[str, int] = field(default_factory=dict)


def _detect_flow_reductions(
    signal: np.ndarray,
    sample_rate: float,
    min_duration_sec: float = 10.0,
    threshold_pct: float = 0.25,
    envelope_sec: float = 10.0,
    amplitude_floor_frac: float = _AMPLITUDE_FLOOR_FRAC,
) -> list[tuple[float, float, float]]:
    """
    Returns list of (start_sec, end_sec, magnitude) for flow reductions.
    magnitude = fractional reduction from local baseline.
    envelope_sec: smoothing window length - use ~4s for peds (shorter breath cycles).
    amplitude_floor_frac: skip events whose local envelope is below this fraction of the
        global 95th-percentile |signal|. Suppresses phantom events on near-flatlined regions.
    """
    if len(signal) < max(1, int(sample_rate * min_duration_sec)):
        return []

    abs_sig = np.abs(signal)

    # Rolling baseline: 2-minute window, or the whole recording when it is
    # shorter than that. Convolving in "same" mode returns max(signal, window)
    # samples, so a window longer than the recording produces a baseline that
    # cannot be compared against the envelope at all - a truncated study used to
    # fail here rather than report no events.
    baseline_samples = max(1, min(int(sample_rate * 120), len(abs_sig)))
    baseline = np.convolve(abs_sig, np.ones(baseline_samples) / baseline_samples, mode="same")
    baseline = np.maximum(baseline, 1e-6)

    # Smooth amplitude over one breathing cycle so per-breath peaks don't
    # break continuity during hypopneas (30-50% reduction events).
    envelope_samples = max(1, min(int(sample_rate * envelope_sec), len(abs_sig)))
    envelope = np.convolve(abs_sig, np.ones(envelope_samples) / envelope_samples, mode="same")
    reduced = envelope < baseline * (1 - threshold_pct)

    # P5 amplitude floor: a 30% reduction on a near-flatlined signal is meaningless.
    nonzero_amp = abs_sig[abs_sig > 0]
    amp_floor = float(np.percentile(nonzero_amp, 95)) * amplitude_floor_frac if nonzero_amp.size > 0 else 0.0

    windows: list[tuple[float, float, float]] = []
    for start, end in runs(reduced, int(sample_rate * min_duration_sec)):
        local_envelope = float(np.mean(abs_sig[start:end]))
        if local_envelope < amp_floor:
            continue
        reduction = float(1.0 - local_envelope / np.mean(baseline[start:end]))
        windows.append((start / sample_rate, end / sample_rate, reduction))

    return windows


def _detect_desaturations(
    signal: np.ndarray,
    sample_rate: float,
    drop_threshold: float = 4.0,
    min_duration_sec: float = 5.0,
) -> list[tuple[float, float, float]]:
    """
    Returns (start_sec, end_sec, drop_magnitude) for SpO2 drops ≥ drop_threshold %.

    Sensor dropouts are encoded by SOMNOtouch RESP as out-of-range values (negative,
    zero, or far above 100). Clamp the signal to the physiological window before
    running detection - otherwise a single dropout sample produces a phantom
    "99% desaturation".
    """
    windows: list[tuple[float, float, float]] = []
    if len(signal) == 0:
        return windows

    # Mask non-physiological values; treat as NaN so they neither inflate baseline
    # nor get reported as nadirs.
    sig = mask_outside(signal, SPO2_PHYSIOLOGICAL_MIN, SPO2_PHYSIOLOGICAL_MAX)

    valid = sig[~np.isnan(sig)]
    if valid.size == 0:
        return windows

    baseline = float(np.percentile(valid, 95))
    dropped = (sig < (baseline - drop_threshold)) & ~np.isnan(sig)

    for start, end in runs(dropped, int(sample_rate * min_duration_sec)):
        window_valid = sig[start:end][~np.isnan(sig[start:end])]
        if window_valid.size == 0:
            continue
        nadir = float(baseline - np.min(window_valid))
        windows.append((start / sample_rate, end / sample_rate, nadir))

    return windows


def _detect_position_changes(
    signal: np.ndarray,
    sample_rate: float,
    min_stable_sec: float = 30.0,
) -> list[tuple[float, float, float]]:
    """
    Returns (transition_sec, transition_sec + 1, magnitude) for position transitions.
    SOMNOtouch encodes Body Position as a discrete integer code (supine, left, right, prone, upright).
    A transition is reported when the value held stable for ≥ min_stable_sec, then changed
    to a new value that itself held stable for ≥ min_stable_sec.
    Magnitude is the absolute code delta - direction-agnostic, downstream only cares it changed.
    """
    out: list[tuple[float, float, float]] = []
    if len(signal) < int(sample_rate * min_stable_sec * 2):
        return out

    min_samples = max(int(sample_rate * min_stable_sec), 1)

    i = 0
    n = len(signal)
    while i < n:
        # Find end of run with constant value starting at i
        j = i + 1
        while j < n and signal[j] == signal[i]:
            j += 1
        run_len = j - i
        if run_len >= min_samples and j < n:
            # Look ahead: does the next run also reach min_samples?
            k = j + 1
            while k < n and signal[k] == signal[j]:
                k += 1
            if (k - j) >= min_samples and signal[j] != signal[i]:
                transition_sec = j / sample_rate
                magnitude = float(abs(signal[j] - signal[i]))
                out.append((transition_sec, transition_sec + 1.0, magnitude))
        i = j

    return out


def _detect_co2_elevation(
    signal: np.ndarray,
    sample_rate: float,
    threshold_mmhg: float = 50.0,
    min_duration_sec: float = 30.0,
) -> list[tuple[float, float, float]]:
    """
    Returns (start_sec, end_sec, mean_elevation_mmhg) for periods where CO2
    remains above threshold_mmhg for at least min_duration_sec.
    magnitude = mean(signal) − threshold during the window (mmHg above floor).

    Physiological ETCO2/TcCO2 range is roughly 20–80 mmHg. Values outside
    this window are masked as sensor dropout rather than real CO2 readings.
    """
    if len(signal) == 0:
        return []

    sig = mask_outside(signal, CO2_PHYSIOLOGICAL_MIN, CO2_PHYSIOLOGICAL_MAX)
    elevated = (sig > threshold_mmhg) & ~np.isnan(sig)

    windows: list[tuple[float, float, float]] = []
    for start, end in runs(elevated, int(sample_rate * min_duration_sec)):
        valid = sig[start:end][~np.isnan(sig[start:end])]
        if valid.size == 0:
            continue
        elevation = float(np.mean(valid) - threshold_mmhg)
        windows.append((start / sample_rate, end / sample_rate, elevation))

    return windows


def _overlaps_intervals(start: float, end: float, intervals: list[tuple[float, float]]) -> bool:
    return any(start < e and end > s for s, e in intervals)


def _filter_by_spo2_coupling(
    flow_events: list[CandidateWindow],
    desat_events: list[CandidateWindow],
    pre_window_sec: float = _COUPLING_PRE_WINDOW_SEC,
    post_window_sec: float = _COUPLING_POST_WINDOW_SEC,
) -> tuple[list[CandidateWindow], list[CandidateWindow]]:
    """
    AASM 1B hypopnea coupling. A flow event qualifies when at least one
    desaturation event ends within [event.end_sec - pre, event.end_sec + post].
    Returns (coupled, uncoupled). Caller decides which group survives.
    """
    if not desat_events:
        return [], list(flow_events)
    desat_ends = sorted(d.end_sec for d in desat_events)
    coupled: list[CandidateWindow] = []
    uncoupled: list[CandidateWindow] = []
    for e in flow_events:
        lo = e.end_sec - pre_window_sec
        hi = e.end_sec + post_window_sec
        if any(lo <= de <= hi for de in desat_ends):
            coupled.append(e)
        else:
            uncoupled.append(e)
    return coupled, uncoupled


def _merge_adjacent_events(
    events: list[CandidateWindow],
    max_gap_sec: float = _FLOW_MERGE_GAP_SEC,
) -> list[CandidateWindow]:
    """Merge events whose gap (start_sec − prev.end_sec) is < max_gap_sec."""
    if len(events) < 2:
        return list(events)
    sorted_evts = sorted(events, key=lambda e: e.start_sec)
    merged: list[CandidateWindow] = [sorted_evts[0]]
    for cur in sorted_evts[1:]:
        prev = merged[-1]
        if cur.start_sec - prev.end_sec < max_gap_sec:
            prev.end_sec = max(prev.end_sec, cur.end_sec)
            prev.magnitude = max(prev.magnitude, cur.magnitude)
        else:
            merged.append(cur)
    return merged


def _post_process_flow_events(
    flow_events: list[CandidateWindow],
    desat_events: list[CandidateWindow],
    flat_intervals: list[tuple[float, float]],
    position_transition_secs: list[float] | None = None,
) -> tuple[list[CandidateWindow], dict[str, int]]:
    """
    Merge split-event artifacts, then tag rejection reasons so the validation
    scorer and clinician still see every candidate while the headline AHI/REI
    uses only untagged events.
      P4 - merge events separated by < 3 s (one breath cycle).
      P2 - tag events overlapping flow-channel flat intervals (sensor artifact).
      P1 - tag uncoupled hypopneas (no SpO2 desat within ~30s of event end);
           apneas bypass coupling per AASM 4.A.
      P0 - informational tag for events within ±10 s of a body-position transition.
    """
    pre_count = len(flow_events)
    merged = _merge_adjacent_events(flow_events)
    merged_pairs = pre_count - len(merged)

    artifact_tagged = 0
    for e in merged:
        if _overlaps_intervals(e.start_sec, e.end_sec, flat_intervals):
            e.notes.append(TAG_OVERLAPS_FLAT)
            artifact_tagged += 1

    coupling_applied = bool(desat_events)
    uncoupled_tagged = 0
    if coupling_applied:
        # Apneas bypass coupling per AASM 4.A, and an event already tagged as a
        # sensor artifact must not be counted against the funnel twice.
        eligible = [
            e for e in merged if e.magnitude < APNEA_MAGNITUDE_FLOOR and TAG_OVERLAPS_FLAT not in e.notes
        ]
        _, uncoupled = _filter_by_spo2_coupling(eligible, desat_events)
        for e in uncoupled:
            e.notes.append(TAG_UNCOUPLED_HYPOPNEA)
        uncoupled_tagged = len(uncoupled)

    position_tagged = 0
    if position_transition_secs:
        for e in merged:
            lo = e.start_sec - _POSITION_TRANSITION_PROXIMITY_SEC
            hi = e.start_sec + _POSITION_TRANSITION_PROXIMITY_SEC
            if any(lo <= t <= hi for t in position_transition_secs):
                e.notes.append(TAG_POSITION_ARTIFACT)
                position_tagged += 1

    headline_count = len(merged) - artifact_tagged - uncoupled_tagged
    stats = {
        "pre_filter": pre_count,
        "merged_pairs": merged_pairs,
        "tagged_artifact": artifact_tagged,
        "tagged_uncoupled_hypopnea": uncoupled_tagged,
        "tagged_position_artifact": position_tagged,
        "headline_count": headline_count,
        "total_after_merge": len(merged),
        "coupling_applied": 1 if coupling_applied else 0,
    }
    return merged, stats


def headline_flow_events(events: list[CandidateWindow]) -> list[CandidateWindow]:
    """Subset of flow events with no rejection tags - feeds the headline AHI/REI."""
    return [e for e in events if TAG_OVERLAPS_FLAT not in e.notes and TAG_UNCOUPLED_HYPOPNEA not in e.notes]


def tagged_flow_events(events: list[CandidateWindow]) -> list[CandidateWindow]:
    """Complement of headline_flow_events — scored-out events still shown to clinician."""
    return [e for e in events if TAG_OVERLAPS_FLAT in e.notes or TAG_UNCOUPLED_HYPOPNEA in e.notes]


def _assign_scores(windows: list[CandidateWindow]) -> None:
    """Compute priority_score and dedupe_key in-place (two-pass)."""
    # Pass 1: base score = signal_quality × event_weight
    for w in windows:
        weight = _EVENT_WEIGHTS.get(w.label, 0.7)
        w.dedupe_key = f"{w.label}_{_severity_bucket(w.label, w.magnitude)}"
        w.priority_score = w.signal_quality * weight

    # Pass 2: overlap penalty - if a higher-base-scored window overlaps within 60s, apply 0.5 penalty
    sorted_by_base = sorted(windows, key=lambda x: x.priority_score, reverse=True)
    penalized: set[int] = set()

    for i, wi in enumerate(sorted_by_base):
        if id(wi) in penalized:
            continue
        for wj in sorted_by_base[i + 1 :]:
            if id(wj) in penalized:
                continue
            # Overlap: windows that start within 60s of each other
            if abs(wj.start_sec - wi.start_sec) < 60.0:
                wj.priority_score *= 0.5
                penalized.add(id(wj))


def assign_event_ids(windows: list[CandidateWindow]) -> None:
    """Assign event_id to flow/desat events in canonical order (in-place).

    Order: headline flow (untagged) → tagged flow → desaturations.
    This order is shared by evidence_packager and signal_slicer so waveform
    links stay consistent without either module reconstructing the ordering.
    """
    flow = [w for w in windows if w.label == "provisional_flow_reduction"]
    desat = [w for w in windows if w.label == "provisional_desaturation"]
    for idx, w in enumerate(headline_flow_events(flow) + tagged_flow_events(flow) + desat):
        w.event_id = f"ev_{idx:03d}"


def find_candidate_windows(
    edf_path: Path,
    inventory: ChannelInventory,
    qc: QCResults,
    cohort: Literal["adult", "pediatric"] = "adult",
) -> CandidateSet:
    # Cohort-specific detection parameters
    # Peds apnea floor: ≥2 breath cycles (~6s practical minimum across all pediatric ages).
    # Peds envelope: 4s matches shorter peds breath cycles and avoids smoothing over short apneas.
    flow_min_duration = 6.0 if cohort == "pediatric" else 10.0
    flow_envelope_sec = 4.0 if cohort == "pediatric" else 10.0

    flow_label = find_channel(inventory, FLOW_LABELS)
    spo2_label = find_channel(inventory, SPO2_LABELS)
    position_label = find_channel(inventory, POSITION_LABELS)
    co2_label = find_channel(inventory, CO2_LABELS) if cohort == "pediatric" else None

    # (name, resolved label, detector). Order fixes the order of `windows`, which
    # `_assign_scores` re-sorts anyway but the tests read before that.
    detectors: list[tuple[str, str | None, str, _Detector]] = [
        (
            "flow",
            flow_label,
            "provisional_flow_reduction",
            partial(
                _detect_flow_reductions,
                min_duration_sec=flow_min_duration,
                envelope_sec=flow_envelope_sec,
            ),
        ),
        ("spo2", spo2_label, "provisional_desaturation", _detect_desaturations),
        ("position", position_label, "provisional_positional", _detect_position_changes),
        ("co2", co2_label, "provisional_hypoventilation", _detect_co2_elevation),
    ]

    channels_used: list[str] = []
    channels_missing: list[str] = []
    channels_low_quality: list[str] = []
    windows: list[CandidateWindow] = []

    for name, label, _event_label, _detect in detectors:
        # CO2 is only sought for the pediatric cohort, so its absence is only
        # missing when it was looked for.
        if label is None and (name != "co2" or cohort == "pediatric"):
            channels_missing.append(name)

    def _channel_usable(label: str) -> tuple[bool, float]:
        qc_ch = qc.for_label(label)
        if qc_ch is None:
            return True, 1.0
        if qc_ch.quality_score < QUALITY_FLOOR:
            channels_low_quality.append(f"{label} (q={qc_ch.quality_score:.2f})")
            return False, qc_ch.quality_score
        return True, qc_ch.quality_score

    with pyedflib.EdfReader(str(edf_path)) as reader:
        for _name, label, event_label, detect in detectors:
            if label is None:
                continue
            ch = inventory.by_label(label)
            assert ch is not None
            usable, quality = _channel_usable(label)
            if not usable:
                continue
            signal = reader.readSignal(ch.index).astype(np.float64)
            for start, end, mag in detect(signal, ch.sample_rate):
                windows.append(
                    CandidateWindow(
                        start_sec=start,
                        end_sec=end,
                        label=event_label,
                        channel=label,
                        magnitude=mag,
                        signal_quality=quality,
                    )
                )
            channels_used.append(label)

    flow_events = [w for w in windows if w.label == "provisional_flow_reduction"]
    desat_events = [w for w in windows if w.label == "provisional_desaturation"]
    other_events = [w for w in windows if w.label not in ("provisional_flow_reduction",)]
    position_transition_secs = [w.start_sec for w in windows if w.label == "provisional_positional"]

    flat_intervals: list[tuple[float, float]] = []
    if flow_label is not None:
        qc_flow = qc.for_label(flow_label)
        if qc_flow is not None:
            flat_intervals = qc_flow.flat_intervals

    flow_events, flow_filter_stats = _post_process_flow_events(
        flow_events,
        desat_events,
        flat_intervals,
        position_transition_secs if position_transition_secs else None,
    )
    windows = other_events + flow_events

    _assign_scores(windows)
    windows.sort(key=lambda w: w.priority_score, reverse=True)
    assign_event_ids(windows)

    return CandidateSet(
        windows=windows,
        channels_used=channels_used,
        channels_missing=channels_missing,
        channels_low_quality=channels_low_quality,
        cohort=cohort,
        flow_filter_stats=flow_filter_stats,
    )
