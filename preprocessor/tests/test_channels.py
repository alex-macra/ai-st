# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Randomised tests for the run-length scan shared by the detectors.

`runs` replaced three separately written copies of the same loop, each of which
carried its own block for a run still open at the end of the signal. Hand-picked
cases per detector could not show that the replacement agrees with them
everywhere, so `runs` is compared here against a reference implementation
written by a different method, over randomised masks. The detectors built on it
are then checked for the properties their callers rely on: windows inside the
recording, ordered, non-overlapping, and no shorter than the minimum duration.
"""

from collections.abc import Iterator

import numpy as np
import pytest

from candidate_windows import (
    _detect_co2_elevation,
    _detect_desaturations,
    _detect_flow_reductions,
)
from channels import find_channel, mask_outside, runs
from edf_parser import ChannelInfo, ChannelInventory

SEED = 20260804


def _reference_runs(mask: np.ndarray, min_samples: int) -> list[tuple[int, int]]:
    """
    Maximal True stretches, found by differencing rather than by scanning.

    Padding both ends with False turns every boundary into a ±1 edge, so a run
    still open at the end of the mask falls out of the same expression as the
    rest instead of needing the separate block the old detectors each wrote.
    """
    padded = np.concatenate(([False], np.asarray(mask, dtype=bool), [False]))
    edges = np.diff(padded.astype(np.int8))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    return [(int(s), int(e)) for s, e in zip(starts, ends, strict=True) if e - s >= min_samples]


def _random_masks(rng: np.random.Generator, count: int) -> Iterator[np.ndarray]:
    """
    Masks in blocks rather than per sample, so runs are long enough to survive a
    minimum length. Lengths reach zero, and nothing stops a mask ending True.
    """
    for _ in range(count):
        length = int(rng.integers(0, 400))
        blocks = rng.random(max(1, length)) < rng.uniform(0.05, 0.95)
        yield np.repeat(blocks, int(rng.integers(1, 20)))[:length]


@pytest.mark.parametrize("min_samples", [0, 1, 3, 17])
def test_runs_matches_reference_over_random_masks(min_samples: int) -> None:
    rng = np.random.default_rng(SEED)
    for mask in _random_masks(rng, 250):
        assert list(runs(mask, min_samples)) == _reference_runs(mask, min_samples), mask


@pytest.mark.parametrize(
    ("mask", "min_samples", "expected"),
    [
        ([], 1, []),
        ([True], 1, [(0, 1)]),
        ([True], 2, []),
        ([True, True], 2, [(0, 2)]),
        # Runs still open at the end of the mask - the tail each detector used to
        # handle in its own block after the loop.
        ([False, True, True], 2, [(1, 3)]),
        ([True, False, True, True], 2, [(2, 4)]),
        ([True, True, False], 2, [(0, 2)]),
        ([True, False, True], 1, [(0, 1), (2, 3)]),
        ([False, False], 1, []),
    ],
)
def test_runs_edge_cases(mask: list[bool], min_samples: int, expected: list[tuple[int, int]]) -> None:
    assert list(runs(np.array(mask, dtype=bool), min_samples)) == expected


# (detector, minimum event duration at default parameters, plausible value range,
# the out-of-range value the device writes when the sensor drops out)
_DETECTORS = [
    pytest.param(_detect_flow_reductions, 10.0, (-1.0, 1.0), None, id="flow"),
    pytest.param(_detect_desaturations, 5.0, (80.0, 100.0), -1.0, id="spo2"),
    pytest.param(_detect_co2_elevation, 30.0, (30.0, 70.0), 0.0, id="co2"),
]

_SAMPLE_RATES = [1.0, 4.0, 25.0, 32.0, 256.0]


def _random_signal(rng: np.random.Generator, low: float, high: float, dropout: float | None) -> np.ndarray:
    """
    A bounded random walk with dropout stretches. Lengths span the range where a
    recording is shorter than the detector's own smoothing windows.
    """
    length = int(rng.integers(0, 6000))
    walk = np.cumsum(rng.normal(0.0, (high - low) / 20.0, length))
    signal = np.clip(walk + rng.uniform(low, high), low, high)
    if dropout is not None and length:
        for _ in range(int(rng.integers(0, 4))):
            start = int(rng.integers(0, length))
            signal[start : start + int(rng.integers(1, 300))] = dropout
    return signal


@pytest.mark.parametrize(("detect", "min_duration_sec", "value_range", "dropout"), _DETECTORS)
def test_detector_windows_are_well_formed(detect, min_duration_sec, value_range, dropout) -> None:
    rng = np.random.default_rng(SEED)
    for _ in range(120):
        sample_rate = float(rng.choice(_SAMPLE_RATES))
        signal = _random_signal(rng, *value_range, dropout)
        recording_sec = len(signal) / sample_rate

        previous_end = 0.0
        for start, end, magnitude in detect(signal, sample_rate):
            assert 0.0 <= start < end <= recording_sec
            assert start >= previous_end
            # A run is counted in whole samples, so it can fall short of the
            # duration by less than one.
            assert end - start >= min_duration_sec - 1.0 / sample_rate
            assert np.isfinite(magnitude)
            previous_end = end


@pytest.mark.parametrize(("detect", "min_duration_sec", "value_range", "dropout"), _DETECTORS)
@pytest.mark.parametrize(
    "signal",
    [
        pytest.param(np.array([]), id="empty"),
        pytest.param(np.zeros(1), id="single-sample"),
        pytest.param(np.full(500, np.nan), id="all-nan"),
        pytest.param(np.full(500, 1e9), id="all-out-of-range"),
    ],
)
def test_detectors_report_nothing_for_degenerate_signals(
    detect, min_duration_sec, value_range, dropout, signal
) -> None:
    assert detect(signal.astype(np.float64), 25.0) == []


def test_mask_outside_leaves_the_caller_signal_alone() -> None:
    signal = np.array([95.0, -1.0, 120.0, 98.0])
    masked = mask_outside(signal, 50.0, 100.0)
    assert np.array_equal(np.isnan(masked), [False, True, True, False])
    assert not np.isnan(signal).any()


def test_mask_outside_accepts_integer_signals() -> None:
    masked = mask_outside(np.array([95, 200, 98]), 50.0, 100.0)
    assert masked.dtype == np.float64
    assert np.isnan(masked[1])


def _inventory(*labels: str) -> ChannelInventory:
    return ChannelInventory(
        duration_sec=60.0,
        channels=[
            ChannelInfo(
                index=i,
                label=label,
                sample_rate=25.0,
                physical_min=0.0,
                physical_max=100.0,
                unit="%",
                duration_sec=60.0,
            )
            for i, label in enumerate(labels)
        ],
    )


def test_find_channel_matches_case_insensitively_and_takes_the_first() -> None:
    inventory = _inventory("ECG", "SpO2", "Saturation")
    assert find_channel(inventory, {"spo2", "saturation"}) == "SpO2"


def test_find_channel_returns_none_when_absent() -> None:
    assert find_channel(_inventory("ECG"), {"spo2"}) is None
