# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Tests for signal_slicer.py.

Pure-function units (_decimate) are fast and parameter-driven.
The integration tests write a real minimal EDF via pyedflib to exercise
the full build_signal_slices path — same approach as the production code.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pyedflib
import pytest

import signal_slicer
from candidate_windows import TAG_UNCOUPLED_HYPOPNEA, CandidateSet, CandidateWindow, assign_event_ids
from edf_parser import ChannelInfo, ChannelInventory
from signal_slicer import _decimate, build_signal_slices

# ---------------------------------------------------------------------------
# Helpers shared across integration tests
# ---------------------------------------------------------------------------


def _write_edf(path: Path, channels: list[dict], signals: list[np.ndarray]) -> None:
    """Write a minimal valid EDF. Each entry in channels must have the keys
    expected by pyedflib.setSignalHeaders."""
    with pyedflib.EdfWriter(str(path), n_channels=len(channels)) as w:
        w.setSignalHeaders(channels)
        w.writeSamples(signals)


def _airflow_header(*, sample_frequency: int = 10) -> dict:
    return {
        "label": "Airflow",
        "dimension": "mV",
        "sample_frequency": sample_frequency,
        "physical_min": -2.0,
        "physical_max": 2.0,
        "digital_min": -32768,
        "digital_max": 32767,
        "prefilter": "",
        "transducer": "",
    }


def _spo2_header(*, sample_frequency: int = 1, physical_min: float = 50.0) -> dict:
    return {
        "label": "SpO2",
        "dimension": "%",
        "sample_frequency": sample_frequency,
        "physical_min": physical_min,
        "physical_max": 100.0,
        "digital_min": -32768,
        "digital_max": 32767,
        "prefilter": "",
        "transducer": "",
    }


def _inventory(dur: float, *, flow_sr: float = 10.0, spo2_sr: float = 1.0) -> ChannelInventory:
    return ChannelInventory(
        duration_sec=dur,
        channels=[
            ChannelInfo(
                index=0,
                label="Airflow",
                sample_rate=flow_sr,
                physical_min=-2.0,
                physical_max=2.0,
                unit="mV",
                duration_sec=dur,
                n_samples=int(flow_sr * dur),
            ),
            ChannelInfo(
                index=1,
                label="SpO2",
                sample_rate=spo2_sr,
                physical_min=50.0,
                physical_max=100.0,
                unit="%",
                duration_sec=dur,
                n_samples=int(spo2_sr * dur),
            ),
        ],
    )


def _flow_candidate(start: float = 40.0, end: float = 55.0) -> CandidateSet:
    windows = [
        CandidateWindow(
            start_sec=start,
            end_sec=end,
            label="provisional_flow_reduction",
            channel="Airflow",
            magnitude=0.65,
            priority_score=1.0,
        )
    ]
    assign_event_ids(windows)
    return CandidateSet(windows=windows, channels_used=["Airflow"], channels_missing=[])


# ---------------------------------------------------------------------------
# _decimate — pure function
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("n_in,n_out", [(1000, 100), (500, 400), (1200, 1)])
def test_decimate_caps_to_n_out(n_in: int, n_out: int) -> None:
    result = _decimate(np.arange(n_in, dtype=np.float32), sample_rate=10.0, n_out=n_out)
    assert len(result) == n_out


def test_decimate_noop_when_signal_shorter_than_n_out() -> None:
    sig = np.array([1.0, 2.0, 3.0], dtype=np.float32)
    result = _decimate(sig, sample_rate=1.0, n_out=10)
    assert len(result) == 3
    assert result[0] == pytest.approx(1.0)
    assert result[-1] == pytest.approx(3.0)


def test_decimate_preserves_first_sample() -> None:
    sig = np.ones(500, dtype=np.float32) * 99.0
    sig[0] = 0.0
    result = _decimate(sig, sample_rate=10.0, n_out=50)
    assert result[0] == pytest.approx(0.0)


def test_decimate_empty_signal_returns_empty_list() -> None:
    result = _decimate(np.array([], dtype=np.float32), sample_rate=1.0, n_out=100)
    assert result == []


def test_decimate_single_sample() -> None:
    result = _decimate(np.array([42.5], dtype=np.float32), sample_rate=1.0, n_out=100)
    assert result == [pytest.approx(42.5)]


def test_decimate_rounds_to_4_dp() -> None:
    result = _decimate(np.array([1.23456789], dtype=np.float64), sample_rate=1.0, n_out=1)
    assert result[0] == pytest.approx(1.2346, abs=1e-4)


# ---------------------------------------------------------------------------
# build_signal_slices — integration
# ---------------------------------------------------------------------------


def test_build_signal_slices_writes_valid_json(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 120.0
    edf = tmp_path / "study.edf"
    t = np.linspace(0, dur, int(10 * dur))
    _write_edf(
        edf, [_airflow_header(), _spo2_header()], [np.sin(2 * np.pi * 0.2 * t), np.full(int(dur), 95.5)]
    )

    out = build_signal_slices(edf, _inventory(dur), _flow_candidate(), "a" * 64)

    assert out == tmp_path / ("a" * 64 + ".json")
    slices = json.loads(out.read_text())
    assert len(slices) == 1
    ev = slices[0]
    assert ev["type"] == "provisional_flow_reduction"
    assert ev["start_sec"] == pytest.approx(40.0, abs=0.01)
    assert ev["end_sec"] == pytest.approx(55.0, abs=0.01)
    assert len(ev["signal_slices"]) >= 1
    channels = [s["channel"] for s in ev["signal_slices"]]
    assert "Airflow" in channels


def test_build_signal_slices_includes_spo2_for_flow_event(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 120.0
    edf = tmp_path / "study.edf"
    t = np.linspace(0, dur, int(10 * dur))
    _write_edf(
        edf, [_airflow_header(), _spo2_header()], [np.sin(2 * np.pi * 0.2 * t), np.full(int(dur), 96.0)]
    )

    out = build_signal_slices(edf, _inventory(dur), _flow_candidate(), "b" * 64)
    slices = json.loads(out.read_text())
    channels = [s["channel"] for s in slices[0]["signal_slices"]]
    assert "SpO2" in channels


def test_build_signal_slices_empty_candidates_writes_empty_array(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 120.0
    edf = tmp_path / "study.edf"
    t = np.linspace(0, dur, int(10 * dur))
    _write_edf(
        edf, [_airflow_header(), _spo2_header()], [np.sin(2 * np.pi * 0.2 * t), np.full(int(dur), 95.0)]
    )

    empty = CandidateSet(windows=[], channels_used=[], channels_missing=[])
    out = build_signal_slices(edf, _inventory(dur), empty, "c" * 64)
    assert json.loads(out.read_text()) == []


def test_build_signal_slices_spo2_dropout_serialises_as_null(tmp_path: Path, monkeypatch) -> None:
    """SpO2 values outside [50, 100] must appear as null in the JSON output."""
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 120.0
    edf = tmp_path / "study.edf"
    n_flow = int(10 * dur)
    n_spo2 = int(dur)
    # physical_min=-10 lets us actually write 0 (out-of-range for SpO2 masking)
    _write_edf(
        edf,
        [_airflow_header(), _spo2_header(physical_min=-10.0)],
        [np.zeros(n_flow, dtype=np.float64), np.zeros(n_spo2, dtype=np.float64)],
    )

    inv = ChannelInventory(
        duration_sec=dur,
        channels=[
            ChannelInfo(
                index=0,
                label="Airflow",
                sample_rate=10.0,
                physical_min=-2.0,
                physical_max=2.0,
                unit="mV",
                duration_sec=dur,
                n_samples=n_flow,
            ),
            ChannelInfo(
                index=1,
                label="SpO2",
                sample_rate=1.0,
                physical_min=-10.0,
                physical_max=100.0,
                unit="%",
                duration_sec=dur,
                n_samples=n_spo2,
            ),
        ],
    )
    out = build_signal_slices(edf, inv, _flow_candidate(), "d" * 64)
    slices = json.loads(out.read_text())

    spo2_slice = next(
        (s for ev in slices for s in ev["signal_slices"] if s["channel"].lower() == "spo2"),
        None,
    )
    assert spo2_slice is not None, "SpO2 slice missing from output"
    assert all(v is None for v in spo2_slice["samples"]), "Expected all out-of-range SpO2 values to be null"


def test_build_signal_slices_window_clamped_at_recording_end(tmp_path: Path, monkeypatch) -> None:
    """Event near end of recording — window must not exceed recording duration."""
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 120.0
    edf = tmp_path / "study.edf"
    t = np.linspace(0, dur, int(10 * dur))
    _write_edf(
        edf, [_airflow_header(), _spo2_header()], [np.sin(2 * np.pi * 0.2 * t), np.full(int(dur), 95.0)]
    )

    # Event at 110–118 s — post-pad would exceed 120 s
    late_candidate = CandidateSet(
        windows=[
            CandidateWindow(
                start_sec=110.0,
                end_sec=118.0,
                label="provisional_flow_reduction",
                channel="Airflow",
                magnitude=0.5,
                priority_score=1.0,
            )
        ],
        channels_used=["Airflow"],
        channels_missing=[],
    )
    out = build_signal_slices(edf, _inventory(dur), late_candidate, "e" * 64)
    slices = json.loads(out.read_text())
    assert len(slices) == 1
    for sl in slices[0]["signal_slices"]:
        assert sl["window_end_sec"] <= dur + 0.001


def test_build_signal_slices_headline_before_tagged_before_desat(tmp_path: Path, monkeypatch) -> None:
    """Headline flow → tagged flow → desaturations, regardless of priority_score order."""
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 300.0
    edf = tmp_path / "study.edf"
    t = np.linspace(0, dur, int(10 * dur))
    _write_edf(
        edf, [_airflow_header(), _spo2_header()], [np.sin(2 * np.pi * 0.1 * t), np.full(int(dur), 96.0)]
    )

    tagged_event = CandidateWindow(
        start_sec=60.0,
        end_sec=75.0,
        label="provisional_flow_reduction",
        channel="Airflow",
        magnitude=0.4,
        priority_score=0.9,
        notes=[TAG_UNCOUPLED_HYPOPNEA],
    )
    headline_event = CandidateWindow(
        start_sec=110.0,
        end_sec=125.0,
        label="provisional_flow_reduction",
        channel="Airflow",
        magnitude=0.6,
        priority_score=0.5,  # lower priority than tagged, but still headline → ev_000
    )
    desat_event = CandidateWindow(
        start_sec=200.0,
        end_sec=210.0,
        label="provisional_desaturation",
        channel="SpO2",
        magnitude=5.0,
        priority_score=0.8,
    )
    windows = [tagged_event, headline_event, desat_event]
    assign_event_ids(windows)
    candidates = CandidateSet(windows=windows, channels_used=["Airflow", "SpO2"], channels_missing=[])
    out = build_signal_slices(edf, _inventory(dur), candidates, "f" * 64)
    slices = json.loads(out.read_text())

    id_by_start = {round(ev["start_sec"], 0): ev["event_id"] for ev in slices}
    assert id_by_start[110.0] == "ev_000", "headline event must have lowest ID"
    assert id_by_start[60.0] == "ev_001", "tagged event must follow all headline events"
    assert id_by_start[200.0] == "ev_002", "desat event must come last"


def test_build_signal_slices_missing_channel_emits_empty_slices_with_dense_ids(
    tmp_path: Path,
    monkeypatch,
) -> None:
    """Events with no matching EDF channel emit signal_slices=[] and still get a dense ev_NNN ID."""
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    dur = 120.0
    edf = tmp_path / "study.edf"
    # EDF contains only a position channel — matches no flow/SpO2/effort label set
    pos_header = {
        "label": "Position",
        "dimension": "code",
        "sample_frequency": 1,
        "physical_min": 0.0,
        "physical_max": 8.0,
        "digital_min": -32768,
        "digital_max": 32767,
        "prefilter": "",
        "transducer": "",
    }
    _write_edf(edf, [pos_header], [np.full(int(dur), 1.0)])
    inv = ChannelInventory(
        duration_sec=dur,
        channels=[
            ChannelInfo(
                index=0,
                label="Position",
                sample_rate=1.0,
                physical_min=0.0,
                physical_max=8.0,
                unit="code",
                duration_sec=dur,
                n_samples=int(dur),
            ),
        ],
    )
    windows = [
        CandidateWindow(
            start_sec=20.0,
            end_sec=35.0,
            label="provisional_flow_reduction",
            channel="Airflow",
            magnitude=0.5,
            priority_score=1.0,
        ),
        CandidateWindow(
            start_sec=60.0,
            end_sec=75.0,
            label="provisional_flow_reduction",
            channel="Airflow",
            magnitude=0.6,
            priority_score=0.8,
        ),
    ]
    assign_event_ids(windows)
    candidates = CandidateSet(windows=windows, channels_used=[], channels_missing=["Airflow", "SpO2"])
    out = build_signal_slices(edf, inv, candidates, "g" * 64)
    slices = json.loads(out.read_text())

    assert len(slices) == 2, "both events must appear even when channel data is absent"
    assert slices[0]["event_id"] == "ev_000"
    assert slices[0]["signal_slices"] == []
    assert slices[1]["event_id"] == "ev_001"
    assert slices[1]["signal_slices"] == []


def test_build_signal_slices_no_cap_on_event_count(tmp_path: Path, monkeypatch) -> None:
    """All events are sliced — the old _MAX_EVENTS=20 cap was removed."""
    monkeypatch.setattr(signal_slicer, "SLICES_DIR", tmp_path)
    n_events = 25
    dur = float(n_events * 100 + 100)
    edf = tmp_path / "study.edf"
    t = np.linspace(0, dur, int(10 * dur))
    _write_edf(
        edf, [_airflow_header(), _spo2_header()], [np.sin(2 * np.pi * 0.05 * t), np.full(int(dur), 94.0)]
    )

    windows = [
        CandidateWindow(
            start_sec=float(i * 100 + 20),
            end_sec=float(i * 100 + 35),
            label="provisional_flow_reduction",
            channel="Airflow",
            magnitude=0.5,
            priority_score=float(n_events - i) / n_events,
        )
        for i in range(n_events)
    ]
    assign_event_ids(windows)
    candidates = CandidateSet(windows=windows, channels_used=["Airflow", "SpO2"], channels_missing=[])
    out = build_signal_slices(edf, _inventory(dur), candidates, "h" * 64)
    slices = json.loads(out.read_text())
    assert len(slices) == n_events
