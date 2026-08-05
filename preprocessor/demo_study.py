# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
A synthetic overnight recording, generated on demand so the application can be
exercised end to end without a real study.

Nothing here is clinical. The signals are drawn from a fixed seed and the
respiratory events are placed by the schedule below, so the same bytes come out
of every call on every machine — which is what makes it safe to hand round and
useless as anything but a demonstration.

The shape is chosen to make the pipeline show its work rather than to imitate a
patient: events cluster in the supine segment so the positional breakdown has
something to report, roughly a third are full apneas so both event classes
appear, and most events carry a desaturation so the coupling logic engages.
"""

from __future__ import annotations

import tempfile
from datetime import datetime
from pathlib import Path

import numpy as np
import pyedflib

# Two hours rather than a full night. Long enough for indices to mean something,
# short enough that ingest and chart rendering finish while someone is watching.
DURATION_SEC = 7_200
FLOW_SR = 25
EFFORT_SR = 25
SLOW_SR = 1

# Supine first, then left lateral. The boundary is what the positional summary
# splits on.
POSITION_CHANGE_SEC = 4_200
SUPINE_CODE = 0.0
LEFT_LATERAL_CODE = 2.0

BREATH_HZ = 0.25  # 15 breaths per minute
BASELINE_SPO2 = 96.0
BASELINE_PULSE = 58.0

_SEED = 20_260_804

# (start second, duration, residual flow fraction, desaturation depth in points).
#
# The residuals are set from the detector's own arithmetic rather than by eye.
# Reduction is measured against a two-minute rolling baseline that the event
# itself drags down, and the ten-second envelope smears each edge, so a 26 s
# event at 1.5% residual lands around 0.93 — clear of the 0.9 apnea floor with
# room to spare. A 4.6-point desaturation clears the 4.0-point detection
# threshold; the zero-depth events are deliberate, and exercise the uncoupled
# path that drops a hypopnea from the headline count.
_APNEA_RESIDUAL = 0.015
_HYPOPNEA_RESIDUAL = 0.42

_EVENT_SCHEDULE: list[tuple[int, int, float, float]] = []
for _index, _start in enumerate(range(300, POSITION_CHANGE_SEC, 200)):
    _apnea = _index % 3 == 0
    _EVENT_SCHEDULE.append(
        (
            _start,
            26 if _apnea else 18,
            _APNEA_RESIDUAL if _apnea else _HYPOPNEA_RESIDUAL,
            0.0 if _index % 7 == 6 else (5.5 if _apnea else 4.6),
        )
    )
for _index, _start in enumerate(range(4_500, DURATION_SEC - 200, 600)):
    _apnea = _index % 3 == 0
    _EVENT_SCHEDULE.append(
        (
            _start,
            26 if _apnea else 16,
            _APNEA_RESIDUAL if _apnea else _HYPOPNEA_RESIDUAL,
            5.0 if _apnea else 4.6,
        )
    )


def _flow_and_effort(rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Tidal breathing with the scheduled events cut into it."""
    samples = DURATION_SEC * FLOW_SR
    t = np.arange(samples) / FLOW_SR

    # Amplitude wanders slowly so the envelope is not a flat line, which would
    # make every event trivially detectable.
    drift = 1.0 + 0.08 * np.sin(2 * np.pi * t / 900.0)
    flow = np.sin(2 * np.pi * BREATH_HZ * t) * drift
    flow += rng.normal(0.0, 0.02, samples)

    # Effort continues through obstructive events, which is what distinguishes
    # them from central ones.
    effort = np.sin(2 * np.pi * BREATH_HZ * t - 0.3) * drift * 0.8
    effort += rng.normal(0.0, 0.02, samples)

    for start_sec, duration_sec, residual, _ in _EVENT_SCHEDULE:
        start, end = start_sec * FLOW_SR, (start_sec + duration_sec) * FLOW_SR
        flow[start:end] *= residual
        # Effort is preserved, and rises slightly as the drive increases.
        effort[start:end] *= 1.15

    return flow, effort


def _spo2_and_pulse(rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Saturation and pulse, each responding to the scheduled events."""
    spo2 = BASELINE_SPO2 + rng.normal(0.0, 0.25, DURATION_SEC)
    pulse = BASELINE_PULSE + 3.0 * np.sin(2 * np.pi * np.arange(DURATION_SEC) / 240.0)
    pulse += rng.normal(0.0, 0.8, DURATION_SEC)

    for start_sec, duration_sec, _, depth in _EVENT_SCHEDULE:
        if depth <= 0.0:
            continue
        # Saturation lags the event: it falls after the airway closes and
        # recovers once breathing resumes.
        nadir = min(start_sec + duration_sec + 8, DURATION_SEC - 1)
        fall_start = min(start_sec + duration_sec // 2, nadir - 1)
        recovery_end = min(nadir + 25, DURATION_SEC)

        fall = np.linspace(0.0, depth, nadir - fall_start)
        spo2[fall_start:nadir] -= fall
        recovery = np.linspace(depth, 0.0, recovery_end - nadir)
        spo2[nadir:recovery_end] -= recovery

        # Post-event tachycardia over the same span.
        surge_end = min(nadir + 12, DURATION_SEC)
        pulse[nadir:surge_end] += depth * 1.8

    return np.clip(spo2, 60.0, 100.0), np.clip(pulse, 40.0, 140.0)


def _position() -> np.ndarray:
    position = np.full(DURATION_SEC, SUPINE_CODE)
    position[POSITION_CHANGE_SEC:] = LEFT_LATERAL_CODE
    return position


def _header(
    label: str,
    dimension: str,
    sample_frequency: int,
    physical_min: float,
    physical_max: float,
) -> dict:
    return {
        "label": label,
        "dimension": dimension,
        "sample_frequency": sample_frequency,
        "physical_min": physical_min,
        "physical_max": physical_max,
        "digital_min": -32768,
        "digital_max": 32767,
        "prefilter": "",
        "transducer": "",
    }


def write_demo_edf(path: Path) -> Path:
    """Write the demo recording to `path` and return it."""
    rng = np.random.default_rng(_SEED)
    flow, effort = _flow_and_effort(rng)
    spo2, pulse = _spo2_and_pulse(rng)

    headers = [
        _header("Flow", "mV", FLOW_SR, -2.5, 2.5),
        _header("Thorax", "mV", EFFORT_SR, -2.5, 2.5),
        _header("SpO2", "%", SLOW_SR, 50.0, 100.0),
        _header("Pulse", "bpm", SLOW_SR, 30.0, 200.0),
        _header("Position", "code", SLOW_SR, 0.0, 5.0),
    ]

    with pyedflib.EdfWriter(str(path), n_channels=len(headers)) as writer:
        # Fixed, plainly non-real header fields. The ingest path de-identifies
        # the header regardless; these are set so the bytes stay reproducible.
        # EDF header fields reject spaces, so these are joined with
        # underscores, and equipment plus recording_additional must fit in 80
        # characters between them. The start time is fixed because it is written
        # into the header, and a clock reading there would make consecutive
        # calls differ.
        writer.setStartdatetime(datetime(2026, 1, 1, 22, 30, 0))
        writer.setPatientCode("DEMO-0001")
        writer.setPatientName("Somnoscribe_Demo")
        writer.setEquipment("Somnoscribe_generator")
        writer.setRecordingAdditional("Synthetic_demo")
        writer.setSignalHeaders(headers)
        writer.writeSamples([flow, effort, spo2, pulse, _position()])

    return path


_cached: bytes | None = None


def demo_edf_bytes() -> bytes:
    """The demo recording as EDF bytes, generated once per process."""
    global _cached
    if _cached is None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = write_demo_edf(Path(tmpdir) / "somnoscribe-demo-study.edf")
            _cached = path.read_bytes()
    return _cached


def demo_study_summary() -> dict:
    """What the generator put in the file, for the demo panel to explain."""
    apneas = sum(1 for _, _, residual, _ in _EVENT_SCHEDULE if residual <= 0.1)
    supine = sum(1 for start, _, _, _ in _EVENT_SCHEDULE if start < POSITION_CHANGE_SEC)
    hours = DURATION_SEC / 3600.0
    return {
        "durationSec": DURATION_SEC,
        "channels": ["Flow", "Thorax", "SpO2", "Pulse", "Position"],
        "respiratoryEvents": len(_EVENT_SCHEDULE),
        "apneas": apneas,
        "hypopneas": len(_EVENT_SCHEDULE) - apneas,
        "supineEvents": supine,
        "nonSupineEvents": len(_EVENT_SCHEDULE) - supine,
        "expectedEventIndexPerHour": round(len(_EVENT_SCHEDULE) / hours, 1),
    }
