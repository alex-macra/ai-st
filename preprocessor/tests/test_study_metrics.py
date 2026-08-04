# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Tests for the study_metrics aggregate block computed in evidence_packager.
Locks in: ODI per-hour, candidate-by-type / by-severity counts, and graceful
behavior when SpO2 metrics cannot be computed.
"""

from candidate_windows import CandidateSet, CandidateWindow
from edf_parser import ChannelInventory
from evidence_packager import _candidate_counts_by_dedupe_key, _compute_study_metrics


def _empty_inventory(duration_sec: float = 28800.0) -> ChannelInventory:
    return ChannelInventory(duration_sec=duration_sec, channels=[])


class _NoQc:
    def for_label(self, _label):  # noqa: ANN001
        return None


def test_study_metrics_basic_counts():
    candidates = CandidateSet(
        windows=[
            CandidateWindow(
                0, 5, "provisional_desaturation", "SpO2", 3.0, dedupe_key="provisional_desaturation_mild"
            ),
            CandidateWindow(
                60,
                70,
                "provisional_desaturation",
                "SpO2",
                4.0,
                dedupe_key="provisional_desaturation_moderate",
            ),
            CandidateWindow(
                100,
                120,
                "provisional_flow_reduction",
                "Flow",
                0.6,
                dedupe_key="provisional_flow_reduction_moderate",
            ),
            CandidateWindow(
                200, 201, "provisional_positional", "Position", 1.0, dedupe_key="provisional_positional_mild"
            ),
        ],
        channels_used=["SpO2", "Flow", "Position"],
        channels_missing=[],
    )

    metrics = _compute_study_metrics(
        edf_path=None,  # type: ignore[arg-type]  # spo2 path is gated
        inventory=_empty_inventory(duration_sec=7200.0),  # 2h
        qc=_NoQc(),  # type: ignore[arg-type]
        candidates=candidates,
    )

    assert metrics["total_recording_sec"] == 7200.0
    assert metrics["total_recording_hours"] == 2.0
    assert metrics["candidate_count_total"] == 4
    assert metrics["candidate_count_by_type"] == {
        "provisional_desaturation": 2,
        "provisional_flow_reduction": 1,
        "provisional_positional": 1,
    }
    assert "candidate_count_by_severity" not in metrics
    # ODI = desat_count / hours = 2 / 2 = 1.0
    assert metrics["provisional_odi_per_hour"] == 1.0


def test_study_metrics_zero_duration_does_not_divide_by_zero():
    candidates = CandidateSet(windows=[], channels_used=[], channels_missing=[])
    metrics = _compute_study_metrics(
        edf_path=None,  # type: ignore[arg-type]
        inventory=_empty_inventory(duration_sec=0.0),
        qc=_NoQc(),  # type: ignore[arg-type]
        candidates=candidates,
    )
    assert metrics["provisional_odi_per_hour"] == 0.0
    assert metrics["candidate_count_total"] == 0


def test_study_metrics_omits_spo2_when_edf_path_missing():
    candidates = CandidateSet(windows=[], channels_used=[], channels_missing=[])
    metrics = _compute_study_metrics(
        edf_path=None,  # type: ignore[arg-type]
        inventory=_empty_inventory(),
        qc=_NoQc(),  # type: ignore[arg-type]
        candidates=candidates,
    )
    assert "spo2" not in metrics


def test_flow_stats_coupled_uncoupled_hypopnea_counts():
    """
    coupled_hypopnea_count = headline hypopneas (desat-confirmed).
    uncoupled_hypopnea_count = events tagged TAG_UNCOUPLED_HYPOPNEA (excluded from headline).
    """
    from candidate_windows import TAG_UNCOUPLED_HYPOPNEA

    coupled = CandidateWindow(
        100, 120, "provisional_flow_reduction", "Flow", 0.6, dedupe_key="provisional_flow_reduction_moderate"
    )
    uncoupled = CandidateWindow(
        200,
        215,
        "provisional_flow_reduction",
        "Flow",
        0.5,
        dedupe_key="provisional_flow_reduction_moderate",
        notes=[TAG_UNCOUPLED_HYPOPNEA],
    )
    apnea = CandidateWindow(
        300, 320, "provisional_flow_reduction", "Flow", 0.95, dedupe_key="provisional_flow_reduction_severe"
    )

    candidates = CandidateSet(
        windows=[coupled, uncoupled, apnea],
        channels_used=["Flow"],
        channels_missing=[],
        flow_filter_stats={
            "pre_filter": 3,
            "merged_pairs": 0,
            "tagged_artifact": 0,
            "tagged_uncoupled_hypopnea": 1,
            "headline_count": 2,
            "total_after_merge": 3,
            "coupling_applied": 1,
        },
    )
    metrics = _compute_study_metrics(
        edf_path=None,
        inventory=_empty_inventory(duration_sec=7200.0),
        qc=_NoQc(),
        candidates=candidates,
    )
    fs = metrics["flow_stats"]
    assert fs["coupled_hypopnea_count"] == 1
    assert fs["uncoupled_hypopnea_count"] == 1
    assert fs["apnea_count"] == 1
    assert fs["count"] == 2  # headline: coupled + apnea
    assert fs["coupled_hypopnea_count"] == fs["hypopnea_count"]


def test_positional_rei_uses_headline_not_raw_candidates():
    """
    _positional_rei is called with headline_candidates (untagged events only),
    so uncoupled/artifact-tagged events must not inflate the positional event counts.
    Regression guard against the pre-8a94202 bug where flow_candidates (full raw set)
    was passed instead.
    """
    from unittest.mock import MagicMock, patch

    from candidate_windows import TAG_UNCOUPLED_HYPOPNEA
    from evidence_packager import _positional_rei

    coupled = CandidateWindow(100, 120, "provisional_flow_reduction", "Flow", 0.6)
    # Constructed to document what headline_flow_events excludes; deliberately
    # not passed to _positional_rei below.
    _uncoupled = CandidateWindow(
        200, 215, "provisional_flow_reduction", "Flow", 0.5, notes=[TAG_UNCOUPLED_HYPOPNEA]
    )

    # headline_flow_events filters uncoupled out; pass only headline list
    headline = [coupled]  # uncoupled excluded

    # Build a minimal mock position channel so _positional_rei can compute counts
    # without reading a real EDF file.
    mock_ch = MagicMock()
    mock_ch.sample_rate = 1.0
    mock_ch.index = 0

    mock_inventory = MagicMock()
    mock_inventory.by_label.return_value = mock_ch

    from edf_parser import ChannelInfo

    mock_inventory.channels = [
        ChannelInfo(
            label="Position",
            index=0,
            sample_rate=1.0,
            physical_min=0.0,
            physical_max=4.0,
            unit="",
            duration_sec=600.0,
        )
    ]

    mock_qc_ch = MagicMock()
    mock_qc_ch.quality_score = 1.0
    mock_qc = MagicMock()
    mock_qc.for_label.return_value = mock_qc_ch

    import numpy as np

    # 300s left (code=2), 300s upright (code=1) — code 0=supine per SOMNOtouch spec
    pos_sig = np.concatenate([np.full(300, 2.0), np.full(300, 1.0)])

    with patch("pyedflib.EdfReader") as mock_edf_cls:
        mock_reader = MagicMock()
        mock_reader.__enter__ = lambda s: s
        mock_reader.__exit__ = MagicMock(return_value=False)
        mock_reader.readSignal.return_value = pos_sig
        mock_edf_cls.return_value = mock_reader

        result = _positional_rei(
            edf_path=MagicMock(),
            inventory=mock_inventory,
            qc=mock_qc,
            flow_candidates=headline,
            duration_hours=600 / 3600,
        )

    assert result is not None
    # headline has 1 event at t=100-120s, which falls in left (code=2) region
    assert result["nonsupine_flow_event_count"] == 1
    assert result["supine_flow_event_count"] == 0


def test_dedupe_key_counter_skips_empty_keys():
    candidates = CandidateSet(
        windows=[
            CandidateWindow(0, 5, "x", "ch", 1.0, dedupe_key="a"),
            CandidateWindow(10, 15, "x", "ch", 1.0, dedupe_key=""),
            CandidateWindow(20, 25, "x", "ch", 1.0, dedupe_key="a"),
        ],
        channels_used=[],
        channels_missing=[],
    )
    assert _candidate_counts_by_dedupe_key(candidates) == {"a": 2}


def test_positional_supine_is_code_zero():
    """
    SOMNOtouch RESP position code 0 = supine (confirmed vs DOMINO output).
    A recording that is mostly code-0 must report high supine_time_pct, not high upright_time_pct.
    """
    from unittest.mock import MagicMock, patch

    import numpy as np

    from edf_parser import ChannelInfo
    from evidence_packager import _positional_rei

    # Headline event placed in code-0 region (supine)
    event = CandidateWindow(50, 70, "provisional_flow_reduction", "Flow", 0.7)

    mock_ch = MagicMock()
    mock_ch.sample_rate = 1.0
    mock_ch.index = 0

    mock_inventory = MagicMock()
    mock_inventory.by_label.return_value = mock_ch
    mock_inventory.channels = [
        ChannelInfo(
            label="Position",
            index=0,
            sample_rate=1.0,
            physical_min=0.0,
            physical_max=4.0,
            unit="",
            duration_sec=600.0,
        )
    ]

    mock_qc_ch = MagicMock()
    mock_qc_ch.quality_score = 1.0
    mock_qc = MagicMock()
    mock_qc.for_label.return_value = mock_qc_ch

    # 500s supine (code=0), 100s left (code=2)
    pos_sig = np.concatenate([np.full(500, 0.0), np.full(100, 2.0)])

    with patch("pyedflib.EdfReader") as mock_edf_cls:
        mock_reader = MagicMock()
        mock_reader.__enter__ = lambda s: s
        mock_reader.__exit__ = MagicMock(return_value=False)
        mock_reader.readSignal.return_value = pos_sig
        mock_edf_cls.return_value = mock_reader

        result = _positional_rei(
            edf_path=MagicMock(),
            inventory=mock_inventory,
            qc=mock_qc,
            flow_candidates=[event],
            duration_hours=600 / 3600,
        )

    assert result is not None
    assert result["supine_time_pct"] == round(500 / 600 * 100, 1)
    assert result["upright_time_pct"] == 0.0
    # Event at t=50-70s is in code=0 (supine) region
    assert result["supine_flow_event_count"] == 1
    assert result["nonsupine_flow_event_count"] == 0


def test_snore_rms_threshold_filters_noise():
    """
    Amplitude snore channels must use a 3×RMS threshold so background noise
    is not counted as snoring. A channel with a brief high-amplitude burst and
    mostly low-level noise should report only the burst duration.
    """
    from unittest.mock import MagicMock, patch

    import numpy as np

    from edf_parser import ChannelInfo
    from evidence_packager import _snore_summary

    sample_rate = 10.0  # 10 Hz
    duration_sec = 600.0
    n_samples = int(sample_rate * duration_sec)

    # Low-level noise throughout (amplitude ~5, i.e. max_val >> 1 → amplitude channel)
    rng = np.random.default_rng(42)
    sig = rng.uniform(1.0, 5.0, size=n_samples)

    # 30-second genuine snoring burst at t=300s with amplitude ~80
    burst_start = int(300 * sample_rate)
    burst_end = int(330 * sample_rate)
    sig[burst_start:burst_end] = rng.uniform(70.0, 90.0, size=burst_end - burst_start)

    mock_ch = MagicMock()
    mock_ch.sample_rate = sample_rate
    mock_ch.index = 0

    mock_inventory = MagicMock()
    mock_inventory.channels = [
        ChannelInfo(
            label="Snore",
            index=0,
            sample_rate=sample_rate,
            physical_min=0.0,
            physical_max=100.0,
            unit="",
            duration_sec=duration_sec,
        )
    ]
    mock_inventory.by_label.return_value = mock_ch

    mock_qc_ch = MagicMock()
    mock_qc_ch.quality_score = 1.0
    mock_qc = MagicMock()
    mock_qc.for_label.return_value = mock_qc_ch

    with patch("pyedflib.EdfReader") as mock_edf_cls:
        mock_reader = MagicMock()
        mock_reader.__enter__ = lambda s: s
        mock_reader.__exit__ = MagicMock(return_value=False)
        mock_reader.readSignal.return_value = sig
        mock_edf_cls.return_value = mock_reader

        result = _snore_summary(
            edf_path=MagicMock(),
            inventory=mock_inventory,
            qc=mock_qc,
            duration_hours=duration_sec / 3600.0,
        )

    assert result is not None
    # Should be approximately 30s = 0.5 min, not 600s = 10 min
    assert result["snore_minutes"] < 2.0, f"Expected < 2 min, got {result['snore_minutes']}"


def test_rei_uses_artifact_adjusted_denominator():
    """
    REI denominator must subtract flat-signal artifact so that a recording with
    25% artifact yields REI = events / (0.75 × total_hours), not events / total_hours.
    """
    from unittest.mock import MagicMock

    from edf_parser import ChannelInfo, ChannelInventory

    flow_events = [
        CandidateWindow(
            100 + i * 200,
            120 + i * 200,
            "provisional_flow_reduction",
            "Flow",
            0.7,
            dedupe_key="provisional_flow_reduction_moderate",
        )
        for i in range(4)
    ]
    candidates = CandidateSet(
        windows=flow_events,
        channels_used=["Flow"],
        channels_missing=[],
    )

    inventory = ChannelInventory(
        duration_sec=7200.0,
        channels=[
            ChannelInfo(
                index=0,
                label="Flow",
                sample_rate=10.0,
                physical_min=-100.0,
                physical_max=100.0,
                unit="",
                duration_sec=7200.0,
            )
        ],
    )

    mock_qc_ch = MagicMock()
    mock_qc_ch.quality_score = 0.8
    mock_qc_ch.flat_segments_pct = 0.25  # fraction (0-1), not percentage — matches signal_qc.py
    mock_qc_ch.artifact_flag = False
    mock_qc_ch.coverage_pct = 1.0
    mock_qc_ch.notes = []

    mock_qc = MagicMock()
    mock_qc.for_label.return_value = mock_qc_ch

    metrics = _compute_study_metrics(
        edf_path=None,
        inventory=inventory,
        qc=mock_qc,
        candidates=candidates,
    )

    # Effective hours = 2h × (1 - 0.25) = 1.5h
    expected_rei = round(4 / 1.5, 2)
    assert metrics["provisional_rei_per_hour"] == expected_rei
    detail = metrics["rei_calculation_detail"]
    assert detail["effective_recording_hours"] == round(1.5, 3)
    assert detail["recording_hours"] == round(2.0, 3)
