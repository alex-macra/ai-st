# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Extract per-event decimated signal slices for frontend waveform rendering.
Written to SLICES_DIR/{caseHash}.json at ingest time.
These arrays are for display only — never passed to the LLM.

Output format per event:
  {
    "event_id": str,
    "type": str,
    "start_sec": float,
    "end_sec": float,
    "signal_slices": [        # [] when EDF lacks all relevant channels for this event type
      {
        "channel": str,
        "window_start_sec": float,
        "window_end_sec": float,
        "samples": [float, ...]   # evenly-spaced, max MAX_SAMPLES points
      }
    ]
  }
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import pyedflib

from candidate_windows import (
    CandidateSet,
    headline_flow_events,
    tagged_flow_events,
)
from channels import (
    EFFORT_LABELS,
    FLOW_LABELS,
    SPO2_LABELS,
    SPO2_PHYSIOLOGICAL_MAX,
    SPO2_PHYSIOLOGICAL_MIN,
    find_channel,
    mask_outside,
)
from edf_parser import ChannelInventory, read_window

SLICES_DIR = Path(os.environ.get("SLICES_DIR", "data/slices"))

# Padding added before/after event boundaries for context
_PRE_PAD_SEC = 30.0
_POST_PAD_SEC = 30.0

# Maximum output samples per channel per window
_MAX_SAMPLES = 400

# Channels to include per event type
_EVENT_CHANNELS: dict[str, list[set[str]]] = {
    "provisional_flow_reduction": [FLOW_LABELS, SPO2_LABELS, EFFORT_LABELS],
    "provisional_desaturation": [SPO2_LABELS, FLOW_LABELS],
}


def _decimate(signal: np.ndarray, sample_rate: float, n_out: int) -> list[float | None]:
    """Evenly subsample signal to at most n_out points. NaN/Inf become None."""

    def _safe(v: float) -> float | None:
        return None if not np.isfinite(v) else round(float(v), 4)

    if len(signal) <= n_out:
        return [_safe(v) for v in signal]
    step = len(signal) / n_out
    indices = [int(i * step) for i in range(n_out)]
    return [_safe(signal[i]) for i in indices]


def build_signal_slices(
    edf_path: Path,
    inventory: ChannelInventory,
    candidates: CandidateSet,
    case_hash: str,
) -> Path:
    """
    Compute slices for top flow-reduction and desaturation events, write to
    SLICES_DIR/{case_hash}.json, and return the written path.
    """
    SLICES_DIR.mkdir(parents=True, exist_ok=True)

    # Headline flow events first (these drive the AHI score), then tagged flow
    # events (excluded from score but visible for clinician review), then all
    # desaturations. No arbitrary cap — the clinician should see every event.
    all_flow = [w for w in candidates.windows if w.label == "provisional_flow_reduction"]
    headline = headline_flow_events(all_flow)
    tagged = tagged_flow_events(all_flow)
    all_desat = [w for w in candidates.windows if w.label == "provisional_desaturation"]

    events_to_slice = headline + tagged + all_desat
    if not events_to_slice:
        out: list[dict[str, Any]] = []
        out_path = SLICES_DIR / f"{case_hash}.json"
        out_path.write_text(json.dumps(out))
        return out_path

    duration_sec = float(inventory.duration_sec)

    # Build label → channel metadata map
    ch_meta = {ch.label: ch for ch in inventory.channels}

    output: list[dict[str, Any]] = []

    with pyedflib.EdfReader(str(edf_path)) as reader:
        for event in events_to_slice:
            window_start = max(0.0, event.start_sec - _PRE_PAD_SEC)
            window_end = min(duration_sec, event.end_sec + _POST_PAD_SEC)

            channel_groups = _EVENT_CHANNELS.get(event.label, [FLOW_LABELS, SPO2_LABELS])
            slices: list[dict[str, Any]] = []

            for label_set in channel_groups:
                ch_label = find_channel(inventory, label_set)
                if ch_label is None:
                    continue
                ch = ch_meta.get(ch_label)
                if ch is None:
                    continue

                sig = read_window(
                    reader,
                    ch.index,
                    ch.sample_rate,
                    window_start,
                    window_end,
                    dtype=np.float32,
                )
                if sig.size == 0:
                    continue

                # Mask SpO2 dropout values before decimating
                if ch_label.lower() in SPO2_LABELS:
                    sig = mask_outside(sig, SPO2_PHYSIOLOGICAL_MIN, SPO2_PHYSIOLOGICAL_MAX)

                slices.append(
                    {
                        "channel": ch_label,
                        "window_start_sec": round(window_start, 3),
                        "window_end_sec": round(window_end, 3),
                        "samples": _decimate(sig, ch.sample_rate, _MAX_SAMPLES),
                    }
                )

            output.append(
                {
                    "event_id": event.event_id,
                    "type": event.label,
                    "start_sec": round(event.start_sec, 3),
                    "end_sec": round(event.end_sec, 3),
                    "magnitude": round(event.magnitude, 3),
                    "tags": [n for n in event.notes if n.startswith("tag:")],
                    "signal_slices": slices,
                }
            )

    out_path = SLICES_DIR / f"{case_hash}.json"
    out_path.write_text(json.dumps(output, allow_nan=False, default=lambda v: None))
    return out_path
