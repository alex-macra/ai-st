"""Synthetic-signal tests for channel-aware quality-control behavior."""

import numpy as np

from edf_parser import ChannelInfo
from signal_qc import _score_channel


def _ch(label: str, *, physical_min: float = 0.0, physical_max: float = 100.0) -> ChannelInfo:
    return ChannelInfo(
        index=0,
        label=label,
        sample_rate=4.0,
        physical_min=physical_min,
        physical_max=physical_max,
        unit="",
        duration_sec=600.0,
        n_samples=2400,
    )


def test_spo2_flat_at_97pct_is_not_artifact():
    """Healthy SpO2 sits at ~97% nearly constantly. Flat must not trigger artifact_flag."""
    sig = np.full(2400, 97.0)
    qc = _score_channel(_ch("SpO2"), sig)
    assert qc.flat_segments_pct > 0.95
    assert qc.artifact_flag is False
    assert qc.quality_score >= 0.95
    assert "high flat segment" not in " ".join(qc.notes)


def test_pulse_steady_60bpm_is_not_artifact():
    sig = np.full(2400, 60.0)
    qc = _score_channel(_ch("Pulse"), sig)
    assert qc.artifact_flag is False
    assert qc.quality_score >= 0.95


def test_position_discrete_state_is_not_artifact():
    """Body position is a discrete code; flat is its baseline state."""
    sig = np.full(2400, 1.0)
    qc = _score_channel(_ch("Position", physical_min=0.0, physical_max=4.0), sig)
    assert qc.artifact_flag is False


def test_activity_near_zero_during_quiet_sleep_is_not_artifact():
    """Accelerometer is near-zero during sleep; should not be flagged for clipping or flat."""
    sig = np.full(2400, 0.001)
    qc = _score_channel(_ch("Activity", physical_min=-2.0, physical_max=2.0), sig)
    assert qc.artifact_flag is False
    assert qc.clipping_pct == 0.0


def test_flow_constant_zero_IS_artifact():
    """Flow channel is dynamic; a flat signal IS a real sensor problem."""
    sig = np.full(2400, 0.0)
    qc = _score_channel(_ch("Flow"), sig)
    assert qc.flat_segments_pct > 0.95
    assert qc.artifact_flag is True


def test_flow_real_breathing_is_not_artifact():
    """A simulated breathing signal at ~12 br/min should pass QC."""
    t = np.linspace(0, 600, 2400)
    sig = np.sin(2 * np.pi * 0.2 * t) * 50.0
    qc = _score_channel(_ch("Flow", physical_min=-100.0, physical_max=100.0), sig)
    assert qc.artifact_flag is False
    assert qc.quality_score > 0.7


def test_thorax_real_effort_is_not_artifact():
    t = np.linspace(0, 600, 2400)
    sig = np.sin(2 * np.pi * 0.2 * t) * 30.0
    qc = _score_channel(_ch("Thorax", physical_min=-50.0, physical_max=50.0), sig)
    assert qc.artifact_flag is False


def test_low_coverage_is_artifact_for_any_channel():
    sig = np.full(2400, np.nan)
    sig[:1000] = 97.0
    qc = _score_channel(_ch("SpO2"), sig)
    assert qc.coverage_pct < 0.5
    assert qc.artifact_flag is True


def test_empty_signal():
    qc = _score_channel(_ch("Flow"), np.array([], dtype=np.float64))
    assert qc.artifact_flag is True
    assert qc.quality_score == 0.0


def test_battery_flat_is_not_artifact():
    sig = np.full(2400, 4.1)
    qc = _score_channel(_ch("Accu", physical_min=0.0, physical_max=5.0), sig)
    assert qc.artifact_flag is False
