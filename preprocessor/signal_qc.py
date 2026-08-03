"""
Per-channel quality scoring. Returns artifact flags and coverage percentages.
No clinical interpretation - only signal-level metrics.
"""
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyedflib

from edf_parser import ChannelInfo, ChannelInventory


@dataclass
class ChannelQC:
    label: str
    quality_score: float          # 0.0 – 1.0
    coverage_pct: float           # fraction of recording with valid samples
    artifact_flag: bool
    flat_segments_pct: float      # fraction of signal that is flat (stuck sensor)
    clipping_pct: float           # fraction of samples at physical min/max
    notes: list[str]
    flat_intervals: list[tuple[float, float]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.flat_intervals is None:
            self.flat_intervals = []


@dataclass
class QCResults:
    channel_qc: dict[str, ChannelQC]   # keyed by channel label

    def for_label(self, label: str) -> ChannelQC | None:
        return self.channel_qc.get(label)


_CLIP_MARGIN = 0.01      # within 1% of physical range → clipping

# Channels whose physiological baseline is flat (constant SpO2, steady HR,
# discrete position state, motionless during sleep). For these, flat samples
# are normal - flat_pct must NOT trigger artifact_flag or penalize quality.
_STABLE_BASELINE_TOKENS = (
    "spo2", "saturation", "oximetry", "o2 sat",
    "pulse", "hr", "heart rate",
    "position", "lage", "body position",
    "activity", "accel",
    "accu", "akku", "battery",
)

# Channels whose physical_max/min in the EDF header is unreliable for clipping
# detection (e.g. accelerometer with a wide declared range but a near-zero
# sleep-time signal - every sample looks "near min"). Skip clipping check.
_NO_CLIPPING_CHECK_TOKENS = ("activity", "accel", "position", "lage", "accu", "akku", "battery")


def _is_stable_baseline(label: str) -> bool:
    label_lower = label.lower()
    return any(tok in label_lower for tok in _STABLE_BASELINE_TOKENS)


def _skip_clipping_check(label: str) -> bool:
    label_lower = label.lower()
    return any(tok in label_lower for tok in _NO_CLIPPING_CHECK_TOKENS)


def _score_channel(ch: ChannelInfo, signal: np.ndarray) -> ChannelQC:
    notes: list[str] = []
    n = len(signal)

    if n == 0:
        return ChannelQC(
            label=ch.label,
            quality_score=0.0,
            coverage_pct=0.0,
            artifact_flag=True,
            flat_segments_pct=0.0,
            clipping_pct=0.0,
            notes=["empty signal"],
        )

    valid_mask = ~np.isnan(signal)
    coverage = float(valid_mask.mean())

    sig = signal[valid_mask]
    if len(sig) == 0:
        return ChannelQC(
            label=ch.label,
            quality_score=0.0,
            coverage_pct=0.0,
            artifact_flag=True,
            flat_segments_pct=0.0,
            clipping_pct=0.0,
            notes=["all NaN"],
        )

    stable = _is_stable_baseline(ch.label)

    diffs = np.abs(np.diff(sig))
    flat_pct = float((diffs == 0).mean()) if len(diffs) > 0 else 0.0
    if not stable and flat_pct > 0.3:
        notes.append(f"high flat segment fraction: {flat_pct:.1%}")

    flat_intervals: list[tuple[float, float]] = []
    if not stable and ch.sample_rate > 0 and len(signal) > 1:
        # Detect runs of identical consecutive samples on the original (pre-NaN-filter)
        # signal. NaN comparisons are always False so NaN→NaN transitions are ignored.
        min_flat_samples = max(1, int(ch.sample_rate * 10.0))  # ≥10 s runs only
        raw_diffs = np.diff(signal.astype(np.float64))
        is_flat_diff = (raw_diffs == 0.0)  # NaN diffs → False (correct)
        in_flat = False
        flat_start = 0
        for i, f in enumerate(is_flat_diff):
            if f and not in_flat:
                in_flat = True
                flat_start = i
            elif not f and in_flat:
                in_flat = False
                if (i - flat_start) >= min_flat_samples:
                    flat_intervals.append((
                        round(flat_start / ch.sample_rate, 2),
                        round((i + 1) / ch.sample_rate, 2),
                    ))
        if in_flat:
            span = len(signal) - 1 - flat_start
            if span >= min_flat_samples:
                flat_intervals.append((
                    round(flat_start / ch.sample_rate, 2),
                    round(len(signal) / ch.sample_rate, 2),
                ))

    if _skip_clipping_check(ch.label):
        clip_pct = 0.0
    else:
        phy_range = ch.physical_max - ch.physical_min
        margin = phy_range * _CLIP_MARGIN if phy_range > 0 else 0.0
        clipped = np.sum((sig <= ch.physical_min + margin) | (sig >= ch.physical_max - margin))
        clip_pct = float(clipped) / len(sig)
        if clip_pct > 0.05:
            notes.append(f"possible clipping: {clip_pct:.1%}")

    if stable:
        artifact_flag = coverage < 0.5
        quality = coverage
    else:
        artifact_flag = flat_pct > 0.5 or clip_pct > 0.2 or coverage < 0.5
        quality = coverage * (1 - flat_pct * 0.5) * (1 - clip_pct * 0.3)
    quality = float(np.clip(quality, 0.0, 1.0))

    return ChannelQC(
        label=ch.label,
        quality_score=quality,
        coverage_pct=coverage,
        artifact_flag=artifact_flag,
        flat_segments_pct=flat_pct,
        clipping_pct=clip_pct,
        notes=notes,
        flat_intervals=flat_intervals,
    )


def run_signal_qc(edf_path: Path, inventory: ChannelInventory) -> QCResults:
    results: dict[str, ChannelQC] = {}

    with pyedflib.EdfReader(str(edf_path)) as reader:
        for ch in inventory.channels:
            signal = reader.readSignal(ch.index).astype(np.float64)
            results[ch.label] = _score_channel(ch, signal)

    return QCResults(channel_qc=results)
