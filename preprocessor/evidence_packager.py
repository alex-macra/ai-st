# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Assemble a compact case package for LLM consumption.
Target size: ≤ 8 KB JSON.  Raw signal arrays are never included.
Candidates are pre-sorted by priority_score (descending) from candidate_windows.py.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import pyedflib

from candidate_windows import (
    _FLOW_LABELS,
    _POSITION_LABELS,
    _SPO2_LABELS,
    CandidateSet,
    CandidateWindow,
    _find_channel,
    headline_flow_events,
)
from const import SCHEMA_VERSION
from edf_parser import ChannelInventory
from signal_qc import QCResults

_MAX_CANDIDATES = 20
_SPO2_PHYSIOLOGICAL_MIN = 50.0
_SPO2_PHYSIOLOGICAL_MAX = 100.0
_T90_THRESHOLD = 90.0
_T80_THRESHOLD = 80.0

# SOMNOtouch RESP channel label tokens for HR and snore
_HR_LABELS = {"pulse", "hr", "heart rate", "pulse rate", "herzfrequenz"}
_SNORE_LABELS = {"snore", "snoring", "schnarch", "schnarchen", "snore mic"}

# Flow-reduction magnitude thresholds for apnea vs hypopnea classification
_APNEA_MAGNITUDE_THRESHOLD = 0.9  # ≥90% reduction
_HYPOPNEA_MAGNITUDE_THRESHOLD = 0.3  # 30–90% reduction


def _spo2_summary(
    edf_path: Path,
    inventory: ChannelInventory,
    qc: QCResults,
    desat_candidates: list[CandidateWindow],
) -> dict[str, Any] | None:
    spo2_label = _find_channel(inventory, _SPO2_LABELS)
    if spo2_label is None:
        return None
    qc_ch = qc.for_label(spo2_label)
    if qc_ch is None or qc_ch.quality_score < 0.3:
        return None
    ch = inventory.by_label(spo2_label)
    assert ch is not None

    with pyedflib.EdfReader(str(edf_path)) as reader:
        sig = reader.readSignal(ch.index).astype(np.float64)

    sig[(sig < _SPO2_PHYSIOLOGICAL_MIN) | (sig > _SPO2_PHYSIOLOGICAL_MAX)] = np.nan
    valid = sig[~np.isnan(sig)]
    if valid.size == 0:
        return None

    valid_sec = float(valid.size / ch.sample_rate)
    below_t90 = float(np.sum(valid < _T90_THRESHOLD) / ch.sample_rate)
    below_t80 = float(np.sum(valid < _T80_THRESHOLD) / ch.sample_rate)
    baseline = float(np.percentile(valid, 95))

    result: dict[str, Any] = {
        "channel": spo2_label,
        "valid_seconds": round(valid_sec, 1),
        "baseline_pct": round(baseline, 1),
        "mean_pct": round(float(np.mean(valid)), 1),
        "nadir_pct": round(float(np.min(valid)), 1),
        "t90_pct": round(below_t90 / valid_sec * 100.0, 2) if valid_sec > 0 else None,
        "t90_minutes": round(below_t90 / 60.0, 2) if valid_sec > 0 else None,
        "t80_pct": round(below_t80 / valid_sec * 100.0, 2) if valid_sec > 0 else None,
        "t80_minutes": round(below_t80 / 60.0, 2) if valid_sec > 0 else None,
    }

    # Candidate-level desaturation detail
    if desat_candidates:
        durations = [w.end_sec - w.start_sec for w in desat_candidates]
        magnitudes = [w.magnitude for w in desat_candidates]
        severity_counts = Counter(w.dedupe_key for w in desat_candidates if w.dedupe_key)
        result["desat_count"] = len(desat_candidates)
        result["avg_desat_depth_pct"] = round(float(np.mean(magnitudes)), 1)
        result["deepest_desat_pct"] = round(float(np.max(magnitudes)), 1)
        result["avg_desat_duration_sec"] = round(float(np.mean(durations)), 1)
        result["longest_desat_sec"] = round(float(np.max(durations)), 1)
        result["sum_desat_sec"] = round(float(sum(durations)), 1)
        result["severity_breakdown"] = dict(severity_counts)
    else:
        result["desat_count"] = 0

    return result


def _hr_summary(edf_path: Path, inventory: ChannelInventory, qc: QCResults) -> dict[str, Any] | None:
    hr_label = _find_channel(inventory, _HR_LABELS)
    if hr_label is None:
        return None
    qc_ch = qc.for_label(hr_label)
    if qc_ch is None or qc_ch.quality_score < 0.3:
        return None
    ch = inventory.by_label(hr_label)
    assert ch is not None

    with pyedflib.EdfReader(str(edf_path)) as reader:
        sig = reader.readSignal(ch.index).astype(np.float64)

    # Physiological HR range 20–220 bpm
    sig[(sig < 20.0) | (sig > 220.0)] = np.nan
    valid = sig[~np.isnan(sig)]
    if valid.size < 10:
        return None

    return {
        "channel": hr_label,
        "mean_bpm": round(float(np.mean(valid)), 1),
        "min_bpm": round(float(np.min(valid)), 1),
        "max_bpm": round(float(np.max(valid)), 1),
    }


def _snore_summary(
    edf_path: Path, inventory: ChannelInventory, qc: QCResults, duration_hours: float
) -> dict[str, Any] | None:
    snore_label = _find_channel(inventory, _SNORE_LABELS)
    if snore_label is None:
        return None
    qc_ch = qc.for_label(snore_label)
    if qc_ch is None or qc_ch.quality_score < 0.3:
        return None
    ch = inventory.by_label(snore_label)
    assert ch is not None

    with pyedflib.EdfReader(str(edf_path)) as reader:
        sig = reader.readSignal(ch.index).astype(np.float64)

    # Detect binary (firmware-scored 0/1) vs. continuous amplitude channel.
    # For amplitude channels, SomnoTouch stores the raw microphone envelope; any
    # positive sample exceeds zero due to background noise, so a noise-floor
    # threshold is required. Use 3× RMS of the full signal as the floor: this
    # separates the noise distribution from genuine snoring bursts without
    # requiring a fixed unit-dependent constant.
    max_val = float(np.nanmax(sig)) if sig.size > 0 else 0.0
    if max_val <= 1.0:
        snore_threshold = 0.0
    else:
        rms = float(np.sqrt(np.mean(sig**2)))
        snore_threshold = rms * 3.0
    snore_samples = float(np.sum(sig > snore_threshold))
    snore_minutes = round(snore_samples / ch.sample_rate / 60.0, 2)
    snore_pct = round(snore_minutes / (duration_hours * 60.0) * 100.0, 2) if duration_hours > 0 else 0.0

    return {
        "channel": snore_label,
        "snore_minutes": snore_minutes,
        "snore_time_pct": snore_pct,
        "snore_index_per_hour": round(snore_minutes / duration_hours, 2) if duration_hours > 0 else 0.0,
    }


def _positional_rei(
    edf_path: Path,
    inventory: ChannelInventory,
    qc: QCResults,
    flow_candidates: list[CandidateWindow],
    duration_hours: float,
) -> dict[str, Any] | None:
    pos_label = _find_channel(inventory, _POSITION_LABELS)
    if pos_label is None or not flow_candidates:
        return None
    qc_ch = qc.for_label(pos_label)
    if qc_ch is None or qc_ch.quality_score < 0.3:
        return None
    ch = inventory.by_label(pos_label)
    assert ch is not None

    with pyedflib.EdfReader(str(edf_path)) as reader:
        sig = reader.readSignal(ch.index).astype(np.float64)

    # SOMNOtouch RESP position codes (verified against DOMINO output):
    # 0=supine, 1=upright, 2=left, 3=right, 4=prone
    # Note: firmware versions prior to ~2022 documented 0=upright which was incorrect;
    # empirical comparison with DOMINO scoring confirms code 0 corresponds to supine.
    total_samples = len(sig)
    if total_samples == 0:
        return None

    def _pos_at(sec: float) -> int:
        idx = min(int(sec * ch.sample_rate), total_samples - 1)
        v = sig[idx]
        return int(v) if not np.isnan(v) else -1

    supine_events = [w for w in flow_candidates if _pos_at((w.start_sec + w.end_sec) / 2) == 0]
    nonsupine_events = [w for w in flow_candidates if _pos_at((w.start_sec + w.end_sec) / 2) in (1, 2, 3, 4)]

    # Time fractions
    pos_counts: Counter[int] = Counter(int(v) for v in sig if not np.isnan(v))
    total_valid = sum(pos_counts.values())

    def _frac(code: int) -> float:
        return round(pos_counts.get(code, 0) / total_valid * 100.0, 1) if total_valid > 0 else 0.0

    supine_hours = pos_counts.get(0, 0) / ch.sample_rate / 3600.0
    nonsupine_hours = sum(pos_counts.get(c, 0) for c in (1, 2, 3, 4)) / ch.sample_rate / 3600.0

    supine_pct = _frac(0)
    return {
        "supine_time_pct": supine_pct,
        "not_supine_time_pct": round(100.0 - supine_pct, 1),
        "left_time_pct": _frac(2),
        "right_time_pct": _frac(3),
        "prone_time_pct": _frac(4),
        "upright_time_pct": _frac(1),
        "supine_flow_event_count": len(supine_events),
        "nonsupine_flow_event_count": len(nonsupine_events),
        "supine_rei_per_hour": round(len(supine_events) / supine_hours, 2) if supine_hours > 0 else None,
        "nonsupine_rei_per_hour": round(len(nonsupine_events) / nonsupine_hours, 2)
        if nonsupine_hours > 0
        else None,
    }


def _candidate_counts_by_dedupe_key(candidates: CandidateSet) -> dict[str, int]:
    counts = Counter(w.dedupe_key for w in candidates.windows if w.dedupe_key)
    return dict(sorted(counts.items()))


def _compute_study_metrics(
    edf_path: Path,
    inventory: ChannelInventory,
    qc: QCResults,
    candidates: CandidateSet,
) -> dict[str, Any]:
    duration_sec = float(inventory.duration_sec)
    duration_hours = duration_sec / 3600.0 if duration_sec > 0 else 0.0

    flow_candidates = [w for w in candidates.windows if w.label == "provisional_flow_reduction"]
    desat_candidates = [w for w in candidates.windows if w.label == "provisional_desaturation"]
    positional_count = sum(1 for w in candidates.windows if w.label == "provisional_positional")
    hypoventilation_count = sum(1 for w in candidates.windows if w.label == "provisional_hypoventilation")

    # Flow events carry rejection tags from candidate_windows post-processing
    # (P1 SpO2 coupling, P2 flat-interval gating, P4 merge, P5 amplitude floor).
    # Headline AHI/REI uses only untagged events; the full set stays in the
    # candidate list so the validation scorer and clinician see everything.
    flow_label = _find_channel(inventory, _FLOW_LABELS)
    flow_flat_pct: float | None = None
    if flow_label:
        qc_flow = qc.for_label(flow_label)
        if qc_flow:
            flow_flat_pct = round(qc_flow.flat_segments_pct, 3)

    funnel = candidates.flow_filter_stats or {}
    headline_candidates = headline_flow_events(flow_candidates)

    # Flow-reduction sub-classification by magnitude (headline subset)
    apnea_candidates = [w for w in headline_candidates if w.magnitude >= _APNEA_MAGNITUDE_THRESHOLD]
    hypopnea_candidates = [
        w
        for w in headline_candidates
        if _HYPOPNEA_MAGNITUDE_THRESHOLD <= w.magnitude < _APNEA_MAGNITUDE_THRESHOLD
    ]

    # Exclude flat-signal artifact from the REI/ODI denominator, matching DOMINO's
    # convention of computing indices over analysable (non-artifact) recording time.
    # flat_segments_pct from the flow channel QC is the best available approximation
    # of artifact duration without access to the device's internal artifact annotations.
    effective_duration_sec = duration_sec
    if flow_flat_pct is not None and flow_flat_pct > 0:
        effective_duration_sec = duration_sec * (1.0 - flow_flat_pct)
    effective_duration_hours = effective_duration_sec / 3600.0 if effective_duration_sec > 0 else 0.0

    provisional_rei_per_hour = (
        round(len(headline_candidates) / effective_duration_hours, 2) if effective_duration_hours > 0 else 0.0
    )
    provisional_rei_adjusted_per_hour = provisional_rei_per_hour
    provisional_rei_raw_per_hour = (
        round(len(flow_candidates) / effective_duration_hours, 2) if effective_duration_hours > 0 else 0.0
    )
    provisional_odi_per_hour = (
        round(len(desat_candidates) / effective_duration_hours, 2) if effective_duration_hours > 0 else 0.0
    )

    artifact_excluded = funnel.get("tagged_artifact", 0)

    flow_stats: dict[str, Any] = {
        "count": len(headline_candidates),
        "artifact_adjusted_count": len(headline_candidates),
        "artifact_excluded_count": artifact_excluded,
        "apnea_count": len(apnea_candidates),
        "hypopnea_count": len(hypopnea_candidates),
        # Pediatric criterion-4 split: coupled = desat-confirmed (only valid when SpO2
        # coupling was actually applied); uncoupled = tagged-out events that lacked a
        # concurrent SpO2 drop. None when coupling was not applied (no SpO2 channel).
        "coupled_hypopnea_count": len(hypopnea_candidates)
        if bool(funnel.get("coupling_applied", 0))
        else None,
        "uncoupled_hypopnea_count": funnel.get("tagged_uncoupled_hypopnea", 0),
        "raw_count_pre_filter": len(flow_candidates),
        "severity_breakdown": dict(Counter(w.dedupe_key for w in headline_candidates if w.dedupe_key)),
    }
    if headline_candidates:
        durations = [w.end_sec - w.start_sec for w in headline_candidates]
        flow_stats["avg_duration_sec"] = round(float(np.mean(durations)), 1)
        flow_stats["max_duration_sec"] = round(float(np.max(durations)), 1)

    metrics: dict[str, Any] = {
        "total_recording_sec": round(duration_sec, 1),
        "total_recording_hours": round(duration_hours, 2),
        "candidate_count_total": len(candidates.windows),
        "candidate_count_by_type": {
            "provisional_desaturation": len(desat_candidates),
            "provisional_flow_reduction": len(flow_candidates),
            "provisional_positional": positional_count,
            **({"provisional_hypoventilation": hypoventilation_count} if hypoventilation_count > 0 else {}),
        },
        # REI = flow-reduction only / recording hours (HSAT recording-time index)
        "provisional_rei_per_hour": provisional_rei_per_hour,
        # Artifact-adjusted: excludes events overlapping flat-signal periods
        "provisional_rei_artifact_adjusted_per_hour": provisional_rei_adjusted_per_hour,
        "provisional_odi_per_hour": provisional_odi_per_hour,
        "rei_calculation_detail": {
            "flow_event_count": len(headline_candidates),
            "artifact_adjusted_count": len(headline_candidates),
            "artifact_excluded_count": artifact_excluded,
            "recording_hours": round(duration_hours, 3),
            "effective_recording_hours": round(effective_duration_hours, 3),
            **({"flow_channel_flat_pct": flow_flat_pct} if flow_flat_pct is not None else {}),
        },
        "flow_filter_funnel": {
            "raw_detected": funnel.get("pre_filter", len(flow_candidates)),
            "merged_pairs": funnel.get("merged_pairs", 0),
            "tagged_artifact": funnel.get("tagged_artifact", 0),
            "tagged_uncoupled_hypopnea": funnel.get("tagged_uncoupled_hypopnea", 0),
            "tagged_position_artifact": funnel.get("tagged_position_artifact", 0),
            "headline_count": funnel.get("headline_count", len(headline_candidates)),
            "spo2_coupling_applied": bool(funnel.get("coupling_applied", 0)),
            "provisional_rei_raw_per_hour": provisional_rei_raw_per_hour,
        },
        "flow_stats": flow_stats,
    }

    spo2_summary = _spo2_summary(edf_path, inventory, qc, desat_candidates)
    if spo2_summary is not None:
        metrics["spo2"] = spo2_summary

    hr_summary = _hr_summary(edf_path, inventory, qc)
    if hr_summary is not None:
        metrics["hr"] = hr_summary

    snore_summary = _snore_summary(edf_path, inventory, qc, duration_hours)
    if snore_summary is not None:
        metrics["snore"] = snore_summary

    positional = _positional_rei(edf_path, inventory, qc, headline_candidates, duration_hours)
    if positional is not None:
        metrics["positional"] = positional

    return metrics


def package_evidence(
    channel_inventory: ChannelInventory,
    qc_results: QCResults,
    candidates: CandidateSet,
    pdf_path: Path | None,
    cohort: str,
    preprocessor_version: str,
    chart_renderer_version: str | None = None,
    screenshot_filenames: list[str] | None = None,
    edf_path: Path | None = None,
    pdf_metrics: dict[str, Any] | None = None,
    demographics: Any = None,
) -> dict[str, Any]:
    channels_out = []
    for ch in channel_inventory.channels:
        qc = qc_results.for_label(ch.label)
        channels_out.append(
            {
                "label": ch.label,
                "sample_rate": ch.sample_rate,
                "unit": ch.unit,
                "duration_sec": ch.duration_sec,
                "present": True,
                "quality_score": round(qc.quality_score, 3) if qc else None,
                "artifact_flag": qc.artifact_flag if qc else None,
                "coverage_pct": round(qc.coverage_pct, 3) if qc else None,
                "flat_segments_pct": round(qc.flat_segments_pct, 3) if qc else None,
                "qc_notes": qc.notes if qc else [],
            }
        )

    missing_channels = [
        {"label": label, "present": False, "reason": "not_in_file"} for label in candidates.channels_missing
    ]
    low_quality_channels = [
        {"label": label, "reason": "below_quality_floor"} for label in candidates.channels_low_quality
    ]

    trimmed_candidates = candidates.windows[:_MAX_CANDIDATES]

    candidates_out = [
        {
            "label": w.label,
            "channel": w.channel,
            "start_sec": round(w.start_sec, 2),
            "end_sec": round(w.end_sec, 2),
            "duration_sec": round(w.end_sec - w.start_sec, 2),
            "magnitude": round(w.magnitude, 3),
            "priority_score": round(w.priority_score, 4),
            "dedupe_key": w.dedupe_key,
            "chart_path": w.notes[0] if w.notes and w.notes[0].startswith("chart:") else None,
            "notes": [n for n in w.notes if not n.startswith("chart:")],
            **({"event_id": w.event_id} if w.event_id is not None else {}),
        }
        for w in trimmed_candidates
    ]

    study_metrics = (
        _compute_study_metrics(edf_path, channel_inventory, qc_results, candidates)
        if edf_path is not None
        else None
    )

    demographics_out: dict[str, Any] | None = None
    if demographics is not None:
        age = getattr(demographics, "age_years", None)
        sex = getattr(demographics, "sex", None)
        if age is not None or sex is not None:
            demographics_out = {}
            if age is not None:
                demographics_out["age_years"] = age
            if sex is not None:
                demographics_out["sex"] = sex

    package: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "preprocessor_version": preprocessor_version,
        **({"chart_renderer_version": chart_renderer_version} if chart_renderer_version else {}),
        "cohort": cohort,
        **({"demographics": demographics_out} if demographics_out else {}),
        "recording": {
            "duration_sec": channel_inventory.duration_sec,
            "n_channels": len(channel_inventory.channels),
        },
        "channels": channels_out,
        "missing_channels": missing_channels,
        "low_quality_channels": low_quality_channels,
        **({"study_metrics": study_metrics} if study_metrics is not None else {}),
        "candidate_windows": candidates_out,
        "candidate_count_total": len(candidates.windows),
        "candidate_count_trimmed_from_llm_package": len(candidates.windows) - len(trimmed_candidates),
        "pdf_available": pdf_path is not None,
        "pdf_metrics": pdf_metrics,
        "screenshot_filenames": list(screenshot_filenames or []),
        "screenshot_count": len(screenshot_filenames or []),
    }

    # Enforce 8 KB limit - truncate candidates further if needed
    while len(json.dumps(package).encode()) > 8 * 1024 and package["candidate_windows"]:
        package["candidate_windows"].pop()
        package["candidate_count_trimmed_from_llm_package"] = package["candidate_count_total"] - len(
            package["candidate_windows"]
        )

    return package
