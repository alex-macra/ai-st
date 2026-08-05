# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Tests for evidence_packager.py.

Focus: event_id consistency with signal_slicer.py ordering
(headline flow → tagged flow → all desats), and the 8 KB truncation loop.
"""

from __future__ import annotations

import json

from candidate_windows import (
    TAG_OVERLAPS_FLAT,
    TAG_UNCOUPLED_HYPOPNEA,
    CandidateSet,
    CandidateWindow,
    assign_event_ids,
)
from edf_parser import ChannelInfo, ChannelInventory
from evidence_packager import package_evidence
from signal_qc import QCResults

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _minimal_inventory(dur: float = 300.0) -> ChannelInventory:
    return ChannelInventory(
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
                n_samples=int(10.0 * dur),
            ),
            ChannelInfo(
                index=1,
                label="SpO2",
                sample_rate=1.0,
                physical_min=50.0,
                physical_max=100.0,
                unit="%",
                duration_sec=dur,
                n_samples=int(dur),
            ),
        ],
    )


def _empty_qc() -> QCResults:
    return QCResults(channel_qc={})


def _flow(
    start: float, end: float, *, mag: float = 0.5, score: float = 1.0, notes: list[str] | None = None
) -> CandidateWindow:
    return CandidateWindow(
        start_sec=start,
        end_sec=end,
        label="provisional_flow_reduction",
        channel="Airflow",
        magnitude=mag,
        priority_score=score,
        notes=notes or [],
    )


def _desat(start: float, end: float, *, score: float = 0.8) -> CandidateWindow:
    return CandidateWindow(
        start_sec=start,
        end_sec=end,
        label="provisional_desaturation",
        channel="SpO2",
        magnitude=4.5,
        priority_score=score,
    )


def _package(candidates: CandidateSet) -> dict:
    return package_evidence(
        channel_inventory=_minimal_inventory(),
        qc_results=_empty_qc(),
        candidates=candidates,
        pdf_path=None,
        cohort="adult",
        preprocessor_version="test",
        edf_path=None,
    )


# ---------------------------------------------------------------------------
# event_id ordering — must mirror signal_slicer.py
# ---------------------------------------------------------------------------


def test_event_id_headline_before_tagged_before_desat() -> None:
    """ev_NNN IDs reflect slicer order: headline → tagged → desat,
    regardless of the priority_score ordering in candidates.windows."""
    tagged = _flow(60.0, 75.0, score=0.95, notes=[TAG_UNCOUPLED_HYPOPNEA])
    headline = _flow(110.0, 125.0, score=0.5)  # lower priority but headline → ev_000
    desat = _desat(200.0, 210.0, score=0.8)

    # candidates.windows is priority-sorted: tagged (0.95), desat (0.8), headline (0.5)
    windows = [tagged, desat, headline]
    assign_event_ids(windows)  # normally called by find_candidate_windows()
    cset = CandidateSet(windows=windows, channels_used=["Airflow", "SpO2"], channels_missing=[])
    pkg = _package(cset)
    cw = {round(c["start_sec"], 0): c for c in pkg["candidate_windows"]}

    assert cw[110.0].get("event_id") == "ev_000", "headline must be ev_000"
    assert cw[60.0].get("event_id") == "ev_001", "tagged must be ev_001"
    assert cw[200.0].get("event_id") == "ev_002", "desat must be ev_002"


def test_event_id_overlaps_flat_tagged_excluded_from_headline() -> None:
    """Events tagged with TAG_OVERLAPS_FLAT are scored out and get an ID after untagged events."""
    artifact = _flow(30.0, 45.0, score=0.99, notes=[TAG_OVERLAPS_FLAT])
    clean = _flow(80.0, 95.0, score=0.3)

    windows = [artifact, clean]
    assign_event_ids(windows)
    cset = CandidateSet(windows=windows, channels_used=["Airflow"], channels_missing=["SpO2"])
    pkg = _package(cset)
    cw = {round(c["start_sec"], 0): c for c in pkg["candidate_windows"]}

    assert cw[80.0].get("event_id") == "ev_000", "clean headline must be ev_000"
    assert cw[30.0].get("event_id") == "ev_001", "artifact-tagged must be ev_001"


def test_event_id_absent_when_event_not_in_slicer_set() -> None:
    """Position-change events are not in the slicer ID map; event_id must be absent."""
    position_event = CandidateWindow(
        start_sec=120.0,
        end_sec=125.0,
        label="provisional_position_change",
        channel="Position",
        magnitude=1.0,
        priority_score=0.7,
    )
    cset = CandidateSet(
        windows=[position_event],
        channels_used=["Position"],
        channels_missing=[],
    )
    pkg = _package(cset)
    assert len(pkg["candidate_windows"]) == 1
    assert "event_id" not in pkg["candidate_windows"][0]


def test_all_flow_events_get_ids() -> None:
    """Every flow event (headline or tagged) receives an event_id."""
    events = [
        _flow(10.0, 25.0),
        _flow(40.0, 55.0, notes=[TAG_UNCOUPLED_HYPOPNEA]),
        _flow(70.0, 85.0, notes=[TAG_OVERLAPS_FLAT]),
        _flow(100.0, 115.0),
    ]
    assign_event_ids(events)
    cset = CandidateSet(windows=events, channels_used=["Airflow"], channels_missing=["SpO2"])
    pkg = _package(cset)
    for cw in pkg["candidate_windows"]:
        assert "event_id" in cw, f"missing event_id for {cw['start_sec']}"


# ---------------------------------------------------------------------------
# 8 KB truncation loop
# ---------------------------------------------------------------------------


def test_package_fits_within_8kb_with_many_candidates() -> None:
    """Even with many candidates, the returned package must be ≤ 8 KB."""
    events = [_flow(float(i * 30 + 10), float(i * 30 + 25), score=1.0 - i * 0.01) for i in range(100)]
    cset = CandidateSet(windows=events, channels_used=["Airflow"], channels_missing=["SpO2"])
    pkg = _package(cset)
    size = len(json.dumps(pkg).encode())
    assert size <= 8 * 1024, f"package is {size} bytes — exceeds 8 KB"


def test_candidate_count_trimmed_from_llm_package_reflects_truncation() -> None:
    """candidate_count_trimmed_from_llm_package must equal total minus what's in candidate_windows."""
    events = [_flow(float(i * 30 + 10), float(i * 30 + 25)) for i in range(100)]
    cset = CandidateSet(windows=events, channels_used=["Airflow"], channels_missing=["SpO2"])
    pkg = _package(cset)
    expected_trimmed = pkg["candidate_count_total"] - len(pkg["candidate_windows"])
    assert pkg["candidate_count_trimmed_from_llm_package"] == expected_trimmed
