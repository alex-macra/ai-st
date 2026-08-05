# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Pipeline integration tests: parse_edf → run_signal_qc → find_candidate_windows → package_evidence.

These verify that the four pipeline stages compose correctly with a real EDF file on disk.
Unit tests for each stage live in their respective test_*.py files.
Borrowed pattern from webscan/findings.test.ts: call the business-logic function directly
with a controlled synthetic input rather than going through HTTP.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pyedflib
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from candidate_windows import find_candidate_windows
from const import SCHEMA_VERSION
from edf_parser import parse_edf
from evidence_packager import package_evidence
from main import PREPROCESSOR_VERSION
from signal_qc import run_signal_qc

# ---------------------------------------------------------------------------
# Fixtures — helpers
# ---------------------------------------------------------------------------

DURATION_SEC = 900
FLOW_SR = 10  # Hz, kept low so tests finish fast
SPO2_SR = 1
POS_SR = 1


def _write_edf(path: Path, headers: list[dict], signals: list[np.ndarray]) -> None:
    with pyedflib.EdfWriter(str(path), n_channels=len(headers)) as w:
        w.setSignalHeaders(headers)
        w.writeSamples(signals)


def _hdr(
    label: str,
    *,
    dimension: str = "mV",
    sample_frequency: int = FLOW_SR,
    physical_min: float = -2.0,
    physical_max: float = 2.0,
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


# ---------------------------------------------------------------------------
# Fixtures — EDF files
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def happy_path_edf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """
    900-second EDF with:
      - Flow (10 Hz):  sinusoidal baseline, 3 near-zero apnea-level events at 300s, 500s, 700s
      - SpO2 (1 Hz):   baseline 96%, desaturations after event 1 and event 2
      - Position (1 Hz): supine (0) → left lateral (2) transition at 450s
    """
    path = tmp_path_factory.mktemp("edf") / "happy.edf"

    t = np.arange(DURATION_SEC * FLOW_SR) / FLOW_SR
    flow = np.abs(np.sin(2 * np.pi * 0.25 * t))  # breathing baseline, amplitude ~1.0
    for event_start in (300, 500, 700):  # three 20-second apnea-level events
        s, e = event_start * FLOW_SR, (event_start + 20) * FLOW_SR
        flow[s:e] = 0.05

    spo2 = np.full(DURATION_SEC, 96.0)
    # Desat 1 ends at 331s → inside flow-event-1 coupling window [315, 350]
    spo2[315:331] = 91.0
    # Desat 2 ends at 532s → inside flow-event-2 coupling window [515, 550]
    spo2[516:532] = 90.0
    # No desat for event 3 — coupling does not apply to apneas (magnitude ≥ 0.9),
    # so event 3 stays in headline regardless.

    position = np.zeros(DURATION_SEC)
    position[450:] = 2.0  # supine → left lateral; both runs ≥ 30s ✓

    headers = [
        _hdr("Flow", dimension="mV", sample_frequency=FLOW_SR, physical_min=-2.0, physical_max=2.0),
        _hdr("SpO2", dimension="%", sample_frequency=SPO2_SR, physical_min=50.0, physical_max=100.0),
        _hdr("Position", dimension="code", sample_frequency=POS_SR, physical_min=0.0, physical_max=5.0),
    ]
    _write_edf(path, headers, [flow, spo2, position])
    return path


@pytest.fixture(scope="module")
def flow_only_edf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """EDF with only a Flow channel — SpO2 and Position absent."""
    path = tmp_path_factory.mktemp("edf") / "flow_only.edf"

    t = np.arange(DURATION_SEC * FLOW_SR) / FLOW_SR
    flow = np.abs(np.sin(2 * np.pi * 0.25 * t))
    for event_start in (300, 500):
        s, e = event_start * FLOW_SR, (event_start + 20) * FLOW_SR
        flow[s:e] = 0.05

    headers = [
        _hdr("Flow", dimension="mV", sample_frequency=FLOW_SR, physical_min=-2.0, physical_max=2.0),
    ]
    _write_edf(path, headers, [flow])
    return path


@pytest.fixture(scope="module")
def flat_flow_edf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """EDF with a completely flat (zero) Flow channel — simulates a disconnected sensor."""
    path = tmp_path_factory.mktemp("edf") / "flat.edf"

    flow = np.zeros(DURATION_SEC * FLOW_SR)
    spo2 = np.full(DURATION_SEC, 96.0)

    headers = [
        _hdr("Flow", dimension="mV", sample_frequency=FLOW_SR, physical_min=-2.0, physical_max=2.0),
        _hdr("SpO2", dimension="%", sample_frequency=SPO2_SR, physical_min=50.0, physical_max=100.0),
    ]
    _write_edf(path, headers, [flow, spo2])
    return path


# ---------------------------------------------------------------------------
# Pipeline runner
# ---------------------------------------------------------------------------


def _run(edf_path: Path, cohort: str = "adult") -> dict:
    inventory = parse_edf(edf_path)
    qc = run_signal_qc(edf_path, inventory)
    candidates = find_candidate_windows(edf_path, inventory, qc, cohort=cohort)
    return package_evidence(
        channel_inventory=inventory,
        qc_results=qc,
        candidates=candidates,
        pdf_path=None,
        cohort=cohort,
        preprocessor_version=PREPROCESSOR_VERSION,
        edf_path=edf_path,
    )


# ---------------------------------------------------------------------------
# Tests — happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_required_top_level_keys_present(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        for key in (
            "schema_version",
            "preprocessor_version",
            "cohort",
            "recording",
            "channels",
            "missing_channels",
            "low_quality_channels",
            "candidate_windows",
            "candidate_count_total",
            "study_metrics",
            "pdf_available",
            "screenshot_count",
        ):
            assert key in pkg, f"missing top-level key: {key}"

    def test_schema_and_version_constants_match(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        assert pkg["schema_version"] == SCHEMA_VERSION
        assert pkg["preprocessor_version"] == PREPROCESSOR_VERSION
        assert pkg["cohort"] == "adult"

    def test_all_three_channels_in_inventory(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        labels = {ch["label"] for ch in pkg["channels"]}
        assert "Flow" in labels
        assert "SpO2" in labels
        assert "Position" in labels

    def test_recording_duration_matches_edf(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        assert abs(pkg["recording"]["duration_sec"] - DURATION_SEC) < 1.0

    def test_channel_qc_fields_populated(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        for ch in pkg["channels"]:
            assert ch["quality_score"] is not None
            assert ch["coverage_pct"] is not None
            assert ch["artifact_flag"] is not None

    def test_flow_candidates_detected(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        flow = [c for c in pkg["candidate_windows"] if c["label"] == "provisional_flow_reduction"]
        assert len(flow) >= 1, "expected at least one flow-reduction candidate"

    def test_desat_candidates_detected(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        desat = [c for c in pkg["candidate_windows"] if c["label"] == "provisional_desaturation"]
        assert len(desat) >= 1, "expected at least one desaturation candidate"

    def test_position_candidate_detected(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        pos = [c for c in pkg["candidate_windows"] if c["label"] == "provisional_positional"]
        assert len(pos) >= 1, "expected at least one positional candidate"

    def test_candidate_count_total_matches_candidate_windows_length(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        expected = len(pkg["candidate_windows"]) + pkg["candidate_count_trimmed_from_llm_package"]
        assert pkg["candidate_count_total"] == expected

    def test_study_metrics_present_with_nonnegative_rei(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        metrics = pkg["study_metrics"]
        assert "provisional_rei_per_hour" in metrics
        assert metrics["provisional_rei_per_hour"] >= 0.0
        assert "provisional_odi_per_hour" in metrics

    def test_package_under_8kb(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        size = len(json.dumps(pkg).encode())
        assert size <= 8 * 1024, f"case package is {size} bytes, exceeds 8 KB limit"

    def test_package_is_json_round_trippable(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        # Must not raise; no raw numpy types should leak through
        serialized = json.dumps(pkg)
        reloaded = json.loads(serialized)
        assert reloaded["schema_version"] == pkg["schema_version"]

    def test_candidate_fields_have_expected_shape(self, happy_path_edf: Path) -> None:
        pkg = _run(happy_path_edf)
        for cw in pkg["candidate_windows"]:
            assert "label" in cw
            assert "start_sec" in cw
            assert "end_sec" in cw
            assert cw["end_sec"] > cw["start_sec"]
            assert "magnitude" in cw
            assert "priority_score" in cw


# ---------------------------------------------------------------------------
# Tests — missing channels
# ---------------------------------------------------------------------------


class TestMissingSpO2Channel:
    def test_spo2_in_missing_channels(self, flow_only_edf: Path) -> None:
        pkg = _run(flow_only_edf)
        missing = {ch["label"] for ch in pkg["missing_channels"]}
        assert "spo2" in missing

    def test_no_desat_candidates_when_spo2_absent(self, flow_only_edf: Path) -> None:
        pkg = _run(flow_only_edf)
        desat = [c for c in pkg["candidate_windows"] if c["label"] == "provisional_desaturation"]
        assert desat == []

    def test_flow_candidates_still_detected_without_spo2(self, flow_only_edf: Path) -> None:
        pkg = _run(flow_only_edf)
        flow = [c for c in pkg["candidate_windows"] if c["label"] == "provisional_flow_reduction"]
        assert len(flow) >= 1

    def test_missing_channels_have_not_in_file_reason(self, flow_only_edf: Path) -> None:
        pkg = _run(flow_only_edf)
        for ch in pkg["missing_channels"]:
            assert ch["present"] is False
            assert ch["reason"] == "not_in_file"


# ---------------------------------------------------------------------------
# Tests — flat / artifact signal
# ---------------------------------------------------------------------------


class TestFlatFlowChannel:
    def test_flat_flow_channel_has_artifact_flag(self, flat_flow_edf: Path) -> None:
        inventory = parse_edf(flat_flow_edf)
        qc = run_signal_qc(flat_flow_edf, inventory)
        flow_qc = qc.for_label("Flow")
        assert flow_qc is not None
        assert flow_qc.artifact_flag is True

    def test_flat_flow_channel_produces_no_candidates(self, flat_flow_edf: Path) -> None:
        pkg = _run(flat_flow_edf)
        flow_candidates = [c for c in pkg["candidate_windows"] if c["label"] == "provisional_flow_reduction"]
        assert len(flow_candidates) == 0, "flat/dropout flow channel should produce no candidates"
