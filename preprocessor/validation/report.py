# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
import json
from datetime import date
from pathlib import Path

from validation.types import EventTypeMetrics, ScoreResult


def _fmt_row(m: EventTypeMetrics) -> str:
    return (
        f"| {m['sensitivity']:.2f} "
        f"| {m['fp_per_hour']:.1f} "
        f"| {m['mean_onset_error_sec']:.1f} "
        f"| {m['p50_onset_error_sec']:.1f} "
        f"| {m['p90_onset_error_sec']:.1f} "
        f"| {m['mean_duration_error_sec']:.1f} "
        f"| {m['near_miss_count']} "
        f"| {m['tp_count']} "
        f"| {m['fn_count']} "
        f"| {m['fp_count']} |"
    )


def _build_markdown(result: ScoreResult, dataset: str, date_str: str) -> str:
    record_id = result["record_id"]
    ref_ahi = result.get("reference_ahi")
    est_ahi = result.get("estimated_ahi", 0.0)
    ahi_line = (
        f"estimated_ahi={est_ahi:.1f}  reference_ahi={ref_ahi:.1f}"
        if ref_ahi is not None
        else f"estimated_ahi={est_ahi:.1f}"
    )
    lines: list[str] = [
        f"# Validation - {dataset} - {record_id} - {date_str}",
        "",
        f"AHI: {ahi_line}",
        "",
        "## Per-event-type metrics",
        "| Event Type | Sens | FP/hr | Onset mean (s) | Onset p50 (s) | Onset p90 (s) | Dur Err (s) | Near-Miss | TP | FN | FP |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]

    for event_type, metrics in sorted(result["per_event_type"].items()):
        row = (
            f"| {event_type} "
            f"| {metrics['sensitivity']:.2f} "
            f"| {metrics['fp_per_hour']:.1f} "
            f"| {metrics['mean_onset_error_sec']:.1f} "
            f"| {metrics['p50_onset_error_sec']:.1f} "
            f"| {metrics['p90_onset_error_sec']:.1f} "
            f"| {metrics['mean_duration_error_sec']:.1f} "
            f"| {metrics['near_miss_count']} "
            f"| {metrics['tp_count']} "
            f"| {metrics['fn_count']} "
            f"| {metrics['fp_count']} |"
        )
        lines.append(row)

    lines += [
        "",
        "## Overall",
        "| Sens | FP/hr | Onset mean (s) | Onset p50 (s) | Onset p90 (s) | Dur Err (s) | Near-Miss | TP | FN | FP |",
        "|---|---|---|---|---|---|---|---|---|---|",
        _fmt_row(result["overall"]),
        "",
        "## Quality bucket breakdown",
        "| Bucket | Sens | FP/hr | Onset p50 (s) | Dur Err (s) | TP | FN | FP |",
        "|---|---|---|---|---|---|---|---|",
    ]

    for bucket in ("high", "medium", "low", "unknown"):
        m = result["per_quality_bucket"].get(bucket)
        if m is None:
            continue
        row = (
            f"| {bucket} "
            f"| {m['sensitivity']:.2f} "
            f"| {m['fp_per_hour']:.1f} "
            f"| {m['p50_onset_error_sec']:.1f} "
            f"| {m['mean_duration_error_sec']:.1f} "
            f"| {m['tp_count']} "
            f"| {m['fn_count']} "
            f"| {m['fp_count']} |"
        )
        lines.append(row)

    lines.append("")
    return "\n".join(lines)


def write_report(result: ScoreResult, out_dir: Path, dataset: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    date_str = date.today().isoformat()
    stem = f"validation_{dataset}_{result['record_id']}_{date_str}"

    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"

    json_path.write_text(json.dumps(result, indent=2))
    md_path.write_text(_build_markdown(result, dataset, date_str))

    return json_path
