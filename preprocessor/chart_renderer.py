"""
Renders a compact multi-panel JPEG for a candidate event window.
Output: 480×180px, dark background, ≤35KB, no patient info.
Cache: {CHARTS_DIR}/{caseHash}_{start_sec_int}_{end_sec_int}.jpg

Panels (top→bottom): SpO2, Airflow, Thoracic effort, Abdomen (if present).
30s window centered on the event; clamped to study bounds.
"""

from __future__ import annotations

import io
import os
from pathlib import Path

import matplotlib
import numpy as np
import pyedflib

# pyplot binds the rendering backend at import time, so the Agg selection has to
# run before it. The statement between the two import groups is what keeps the
# import sorter from merging them; do not collapse it.
matplotlib.use("Agg")

import matplotlib.gridspec as gridspec
import matplotlib.pyplot as plt

from edf_parser import ChannelInventory

CHART_RENDERER_VERSION = "0.1.0"

_CHARTS_DIR = Path(os.environ.get("CHARTS_DIR", "data/charts"))

_CHANNEL_GROUPS = {
    "spo2": {"labels": {"spo2", "saturation", "oximetry", "o2 sat"}, "color": "#4ade80"},
    "airflow": {
        "labels": {"flow", "nasal flow", "airflow", "oronasal", "ptaf", "nasal pressure"},
        "color": "#60a5fa",
    },
    "thorax": {"labels": {"thorax", "chest", "resp effort", "thoracic"}, "color": "#f97316"},
    "abdomen": {"labels": {"abdomen", "abdominal"}, "color": "#facc15"},
}

_BG_COLOR = "#0f0f1a"
_GRID_COLOR = "#1e1e30"
_WINDOW_SEC = 30.0


def _find_channel(inventory: ChannelInventory, label_set: set[str]) -> str | None:
    for ch in inventory.channels:
        if ch.label.lower() in label_set:
            return ch.label
    return None


def _read_window(
    reader: pyedflib.EdfReader,
    ch_index: int,
    sample_rate: float,
    start_sec: float,
    end_sec: float,
) -> np.ndarray:
    n_total = reader.getNSamples()[ch_index]
    i_start = max(0, int(start_sec * sample_rate))
    i_end = min(n_total, int(end_sec * sample_rate))
    if i_start >= i_end:
        return np.array([])
    n = i_end - i_start
    signal = reader.readSignal(ch_index, start=i_start, n=n)
    return signal.astype(np.float64)


def render_window(
    edf_path: Path,
    inventory: ChannelInventory,
    event_center_sec: float,
    case_hash: str,
) -> Path | None:
    """Render a 30s window centred on *event_center_sec* and return the chart path.
    Returns None when no channels are available to plot.
    """
    _CHARTS_DIR.mkdir(parents=True, exist_ok=True)

    half = _WINDOW_SEC / 2.0
    win_start = max(0.0, event_center_sec - half)
    win_end = min(float(inventory.duration_sec), win_start + _WINDOW_SEC)
    win_start = max(0.0, win_end - _WINDOW_SEC)

    key = f"{case_hash}_{int(win_start)}_{int(win_end)}"
    chart_path = _CHARTS_DIR / f"{key}.jpg"
    if chart_path.exists():
        return chart_path

    # Discover which panels to render (in display order)
    panels: list[tuple[str, str, str]] = []  # (group_name, channel_label, color)
    for group_name, info in _CHANNEL_GROUPS.items():
        label = _find_channel(inventory, info["labels"])
        if label is not None:
            panels.append((group_name, label, info["color"]))

    if not panels:
        return None

    n_panels = len(panels)
    fig_w_in = 480 / 100
    fig_h_in = 180 / 100
    fig = plt.figure(figsize=(fig_w_in, fig_h_in), dpi=100, facecolor=_BG_COLOR)
    gs = gridspec.GridSpec(n_panels, 1, figure=fig, hspace=0.0, left=0.0, right=1.0, top=1.0, bottom=0.0)

    with pyedflib.EdfReader(str(edf_path)) as reader:
        for i, (_, ch_label, color) in enumerate(panels):
            ax = fig.add_subplot(gs[i])
            ax.set_facecolor(_BG_COLOR)
            for spine in ax.spines.values():
                spine.set_visible(False)
            ax.tick_params(left=False, bottom=False, labelleft=False, labelbottom=False)

            ch = inventory.by_label(ch_label)
            if ch is None:
                continue
            signal = _read_window(reader, ch.index, ch.sample_rate, win_start, win_end)
            if signal.size == 0:
                continue

            t = np.linspace(win_start, win_end, len(signal))
            ax.plot(t, signal, color=color, linewidth=0.6, antialiased=True)
            ax.set_xlim(win_start, win_end)
            ax.margins(y=0.05)

    buf = io.BytesIO()
    fig.savefig(
        buf, format="jpeg", dpi=100, facecolor=_BG_COLOR, pil_kwargs={"quality": 55, "optimize": True}
    )
    buf.seek(0)
    data = buf.getvalue()

    # Enforce 35KB ceiling by re-saving the same figure at lower quality
    if len(data) > 35_000:
        buf2 = io.BytesIO()
        fig.savefig(
            buf2, format="jpeg", dpi=100, facecolor=_BG_COLOR, pil_kwargs={"quality": 30, "optimize": True}
        )
        data = buf2.getvalue()

    plt.close(fig)
    chart_path.write_bytes(data)
    return chart_path
