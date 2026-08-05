# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Channel identification and the physiological limits shared by detection and
packaging.

These lived in candidate_windows.py and were reached into by evidence_packager
through their private names, which meant two modules could disagree about what
counts as an apnea or where SpO2 stops being plausible. One home instead.
"""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np

from edf_parser import ChannelInventory

# Labels used in DOMINO / SOMNOtouch exports (may vary by firmware)
FLOW_LABELS = {"flow", "nasal flow", "airflow", "oronasal", "ptaf", "nasal pressure"}
SPO2_LABELS = {"spo2", "saturation", "oximetry", "o2 sat"}
EFFORT_LABELS = {"thorax", "abdomen", "chest", "resp effort", "thoracic", "abdominal"}
POSITION_LABELS = {"position", "body position", "lage"}
HR_LABELS = {"pulse", "hr", "heart rate", "pulse rate", "herzfrequenz"}
SNORE_LABELS = {"snore", "snoring", "schnarch", "schnarchen", "snore mic"}
# End-tidal and transcutaneous CO2 - critical for pediatric hypoventilation detection
CO2_LABELS = {
    "etco2",
    "end tidal co2",
    "co2",
    "tco2",
    "transcutaneous co2",
    "capnography",
    "petco2",
    "end-tidal co2",
}

# Channels below this quality floor are skipped for candidate detection; the LLM
# must never claim a finding from a low-quality channel. At/above the floor they're
# included, with quality_score downweighting priority_score — not hard-excluded on
# artifact_flag alone.
QUALITY_FLOOR = 0.3

# Flow reduction at or above this fraction is an apnea rather than a hypopnea.
# Apneas are scored on flow alone and bypass SpO2 coupling per AASM 4.A.
APNEA_MAGNITUDE_FLOOR = 0.9
# 30-90% reduction is a hypopnea candidate.
HYPOPNEA_MAGNITUDE_FLOOR = 0.3

# SOMNOtouch RESP encodes sensor dropout as out-of-range values. Anything outside
# these windows is masked as artifact rather than read as a real measurement.
SPO2_PHYSIOLOGICAL_MIN = 50.0
SPO2_PHYSIOLOGICAL_MAX = 100.0
CO2_PHYSIOLOGICAL_MIN = 20.0
CO2_PHYSIOLOGICAL_MAX = 80.0


def find_channel(inventory: ChannelInventory, label_set: set[str]) -> str | None:
    """First channel whose label matches the set, case-insensitively."""
    for ch in inventory.channels:
        if ch.label.lower() in label_set:
            return ch.label
    return None


def mask_outside(signal: np.ndarray, low: float, high: float) -> np.ndarray:
    """Copy of `signal` as float64 with out-of-range samples replaced by NaN."""
    sig = signal.astype(np.float64).copy()
    sig[(sig < low) | (sig > high)] = np.nan
    return sig


def runs(mask: np.ndarray, min_samples: int) -> Iterator[tuple[int, int]]:
    """
    Yield (start, end) index pairs for each stretch of consecutive True values
    at least `min_samples` long. `end` is exclusive.

    Three detectors used to carry their own copy of this loop, each with its own
    separately written block for a run still open at the end of the signal. That
    tail is handled once here.
    """
    in_run = False
    start = 0
    for i, flag in enumerate(mask):
        if flag and not in_run:
            in_run = True
            start = i
        elif not flag and in_run:
            in_run = False
            if i - start >= min_samples:
                yield start, i
    if in_run and len(mask) - start >= min_samples:
        yield start, len(mask)
