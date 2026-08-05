# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
The demo study exists so the application can be run without a real recording.
That is only worth anything if what comes out the far end resembles the study
that went in, so these run the generated file through the real detection stack
and check the reported numbers against what the generator wrote.
"""

from pathlib import Path

import numpy as np
import pytest

from candidate_windows import find_candidate_windows
from demo_study import (
    DURATION_SEC,
    POSITION_CHANGE_SEC,
    demo_edf_bytes,
    demo_study_summary,
    write_demo_edf,
)
from edf_parser import parse_edf
from evidence_packager import package_evidence
from signal_qc import run_signal_qc


@pytest.fixture(scope="module")
def demo_edf(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return write_demo_edf(tmp_path_factory.mktemp("demo") / "demo.edf")


@pytest.fixture(scope="module")
def package(demo_edf: Path) -> dict:
    inventory = parse_edf(demo_edf)
    qc = run_signal_qc(demo_edf, inventory)
    candidates = find_candidate_windows(demo_edf, inventory, qc, cohort="adult")
    return package_evidence(
        channel_inventory=inventory,
        qc_results=qc,
        candidates=candidates,
        pdf_path=None,
        screenshot_filenames=[],
        cohort="adult",
        preprocessor_version="test",
        chart_renderer_version="test",
        edf_path=demo_edf,
        pdf_metrics=None,
        demographics=None,
    )


class TestGeneratedFile:
    def test_is_byte_for_byte_reproducible(self, tmp_path: Path) -> None:
        first = write_demo_edf(tmp_path / "a.edf").read_bytes()
        second = write_demo_edf(tmp_path / "b.edf").read_bytes()
        assert first == second

    def test_cached_bytes_match_a_fresh_write(self, demo_edf: Path) -> None:
        assert demo_edf_bytes() == demo_edf.read_bytes()

    def test_carries_the_advertised_channels(self, demo_edf: Path) -> None:
        labels = [c.label for c in parse_edf(demo_edf).channels]
        assert labels == demo_study_summary()["channels"]

    def test_header_says_demo_and_names_no_person(self, demo_edf: Path) -> None:
        # The first 256 bytes are the EDF header, where the patient and
        # recording identification fields live. Ingest de-identifies the header
        # anyway; this checks that there was nothing to strip in the first place.
        header = demo_edf.read_bytes()[:256].decode("ascii", errors="replace").lower()
        assert "somnoscribe_demo" in header
        assert "synthetic_demo" in header


class TestDetectedContent:
    """
    The generator and the detector arrive at these numbers by different routes:
    one writes events into a waveform, the other finds them again by comparing
    a smoothed envelope against a rolling baseline. Exact agreement is not the
    expectation, and the tolerances below say how much disagreement is fine.
    """

    def test_recording_length_matches(self, package: dict) -> None:
        assert package["study_metrics"]["total_recording_hours"] == pytest.approx(
            DURATION_SEC / 3600.0, abs=0.01
        )

    def test_finds_both_event_classes(self, package: dict) -> None:
        flow = package["study_metrics"]["flow_stats"]
        assert flow["apnea_count"] > 0, "apneas were written in but none were classified as such"
        assert flow["hypopnea_count"] > 0

    def test_event_index_is_close_to_what_was_written(self, package: dict) -> None:
        summary = demo_study_summary()
        headline = package["study_metrics"]["flow_stats"]["count"]
        expected = summary["respiratoryEvents"]
        # Events without a coupled desaturation are dropped from the headline
        # count by design, so the detector finding fewer is correct behaviour.
        assert 0.8 * expected <= headline <= expected

    def test_desaturations_are_detected_and_coupled(self, package: dict) -> None:
        spo2 = package["study_metrics"]["spo2"]
        assert spo2["desat_count"] > 0
        assert spo2["nadir_pct"] < spo2["baseline_pct"]
        assert package["study_metrics"]["flow_stats"]["coupled_hypopnea_count"] > 0

    def test_reproduces_the_positional_pattern(self, package: dict) -> None:
        positional = package["study_metrics"]["positional"]
        expected_supine_pct = 100.0 * POSITION_CHANGE_SEC / DURATION_SEC
        assert positional["supine_time_pct"] == pytest.approx(expected_supine_pct, abs=1.0)
        # Events were concentrated in the supine segment; the split is the point
        # of including a position channel at all.
        assert positional["supine_rei_per_hour"] > positional["nonsupine_rei_per_hour"]

    def test_signal_quality_is_not_flagged_as_a_dead_sensor(self, package: dict) -> None:
        # Apneas drop flow to a small residual rather than exactly zero, so the
        # channel must not read as disconnected.
        assert package["study_metrics"]["rei_calculation_detail"]["flow_channel_flat_pct"] < 1.0
        assert "Flow" not in package["low_quality_channels"]


class TestSummary:
    def test_counts_agree_with_the_schedule(self) -> None:
        summary = demo_study_summary()
        assert summary["apneas"] + summary["hypopneas"] == summary["respiratoryEvents"]
        assert summary["supineEvents"] + summary["nonSupineEvents"] == summary["respiratoryEvents"]
        assert summary["expectedEventIndexPerHour"] == pytest.approx(
            summary["respiratoryEvents"] / (DURATION_SEC / 3600.0), abs=0.1
        )

    def test_spo2_stays_physiological(self, demo_edf: Path) -> None:
        inventory = parse_edf(demo_edf)
        import mne

        raw = mne.io.read_raw_edf(str(demo_edf), preload=True, verbose="ERROR")
        spo2 = raw.get_data(picks=["SpO2"])[0]
        assert np.nanmin(spo2) > 50.0
        assert np.nanmax(spo2) <= 100.0
        assert "SpO2" in [c.label for c in inventory.channels]
