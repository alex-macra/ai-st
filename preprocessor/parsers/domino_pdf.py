# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Parse the structured numerics out of a DOMINO light Report print PDF.

DOMINO is the lab software that ships with SOMNOtouch RESP recorders. Its
"light Report print" variant is text-based (no OCR needed) and contains the
lab's own scored AHI/RDI, T90, supine fraction, etc. We extract those
numerics as a deterministic gold reference that Pass 3 can cross-check
against the LLM's structured report.

PHI rules:
- This parser MUST NOT return patient name, DOB, ID, weight, height, BMI,
  physician, scorer, clinic name, address, phone, or email. Every method
  here is whitelist-based extraction of clinical numerics, with regex
  patterns anchored on English numeric labels - any string outside that
  allowlist is silently dropped.
- The audit log records the field count extracted, never the values.

Variant support (v1):
- "DOMINO light Report print" - the only variant we have a sample for.
  Anything else returns ParseFailure with reason="unsupported_pdf_variant".
"""

from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

from pypdf import PdfReader

logger = logging.getLogger(__name__)

SUPPORTED_VARIANT = "DOMINO light Report print"
SCHEMA_VERSION = "0.1"

FieldConfidence = Literal["extracted", "missing", "ambiguous"]


@dataclass
class DominoMetrics:
    """
    Whitelisted, PHI-free clinical numerics from a DOMINO light Report print.

    Every numeric field is Optional - DOMINO prints `-` for missing values
    and a v1 parser is conservative about what it claims to have extracted.
    Pass 3 only cross-checks fields whose confidence is "extracted".
    """

    schema_version: str = SCHEMA_VERSION
    parsed: bool = True
    variant: str = SUPPORTED_VARIANT

    # Recording - duration only, no recorded clock times (PHI-adjacent).
    total_recording_seconds: int | None = None
    total_sleep_time_seconds: int | None = None
    sleep_efficiency_pct: float | None = None
    sleep_latency_min: float | None = None

    # Respiratory.
    ahi: float | None = None
    rdi: float | None = None
    apnea_total: int | None = None
    hypopnea_total: int | None = None
    apnea_max_duration_s: int | None = None
    hypopnea_max_duration_s: int | None = None
    artefact_minutes: float | None = None
    artefact_pct: float | None = None

    # Respiratory per-type breakdown (from DOMINO "Number (Index)" table).
    obstructive_apnea_count: int | None = None
    obstructive_apnea_index: float | None = None
    central_apnea_count: int | None = None
    central_apnea_index: float | None = None
    hypopnea_index: float | None = None

    # Snoring (All-column values from Snore Analysis table).
    snore_count: int | None = None
    snore_index: float | None = None

    # SpO2.
    baseline_spo2_pct: int | None = None
    average_spo2_pct: int | None = None
    minimum_spo2_pct: int | None = None
    desaturation_index: float | None = None
    count_below_90: int | None = None
    count_below_80: int | None = None
    time_below_90_pct: float | None = None
    biggest_desaturation_pct: int | None = None
    longest_desaturation_s: float | None = None

    # Position - sleep-time fraction per position.
    supine_fraction_pct: float | None = None
    prone_fraction_pct: float | None = None
    left_fraction_pct: float | None = None
    right_fraction_pct: float | None = None
    upright_fraction_pct: float | None = None
    not_supine_fraction_pct: float | None = None

    # Heart rate - sleep column (existing) and wake column.
    hr_average: int | None = None
    hr_minimum: int | None = None
    hr_maximum: int | None = None
    hr_wake_mean: int | None = None
    hr_wake_min: int | None = None
    hr_wake_max: int | None = None

    # Per-field confidence; missing keys default to "missing".
    field_confidence: dict[str, FieldConfidence] = field(default_factory=dict)


@dataclass
class ParseFailure:
    parsed: Literal[False] = False
    reason: str = ""
    variant: str | None = None


ParseResult = DominoMetrics | ParseFailure


def parse_domino_pdf(path: Path | str) -> ParseResult:
    """
    Read a DOMINO light Report print PDF and return its whitelisted numerics.

    On unsupported variants or read errors, returns ParseFailure rather than
    raising - case ingestion must not be blocked by PDF-parser problems.
    """
    pdf_path = Path(path)
    try:
        reader = PdfReader(str(pdf_path))
    except Exception as e:  # broad: any pypdf read error is non-fatal here
        logger.warning("pypdf could not parse the uploaded report (%s)", type(e).__name__)
        return ParseFailure(reason="pdf_read_error")

    title = (reader.metadata.title if reader.metadata else None) or ""
    if title.strip() != SUPPORTED_VARIANT:
        return ParseFailure(reason="unsupported_pdf_variant", variant=title or None)

    text = "\n".join(p.extract_text() or "" for p in reader.pages)
    return _extract_metrics(text)


# Some exports use comma decimal notation. Convert before float().
_DECIMAL = r"\d+(?:[,.]\d+)?"


def _to_float(s: str) -> float:
    return float(s.replace(",", "."))


def _extract_metrics(text: str) -> DominoMetrics:
    m = DominoMetrics()
    confidence: dict[str, FieldConfidence] = {}

    def set_field(name: str, value: object) -> None:
        setattr(m, name, value)
        confidence[name] = "extracted"

    # --- Sleep / wake ---
    if match := re.search(r"Total Sleep Time \(TST\)\s+(\d{2}):(\d{2}):(\d{2})", text):
        h, mn, s = (int(g) for g in match.groups())
        set_field("total_sleep_time_seconds", h * 3600 + mn * 60 + s)

    if match := re.search(r"Sleep Latency \[m\]\s+(" + _DECIMAL + r")", text):
        set_field("sleep_latency_min", _to_float(match.group(1)))

    if match := re.search(r"Recorded Time.*?(\d{2}):(\d{2}):(\d{2})\s*$", text, re.MULTILINE):
        h, mn, s = (int(g) for g in match.groups())
        set_field("total_recording_seconds", h * 3600 + mn * 60 + s)

    # Sleep-efficiency comes back from DOMINO as a "% Sleep Time" cell with the
    # same value - we trust it when it's present near the TST block.
    if match := re.search(r"Sleep efficiency \(%\)\s*(?:\n[^\n]*)?\n(" + _DECIMAL + r")", text):
        set_field("sleep_efficiency_pct", _to_float(match.group(1)))

    # --- Respiratory ---
    # DOMINO writes "AHI / RDI [/h]" and the corresponding cell is "X / Y".
    # The label and value are widely separated by other table cells, so we
    # search for the X / Y shape and pin it to the AHI/RDI label section.
    if "AHI / RDI" in text:  # noqa: SIM102 - the section guard reads clearer kept separate from the pattern
        if match := re.search(
            r"(" + _DECIMAL + r")\s*/\s*(" + _DECIMAL + r")(?=\s*\n[^\n]*Flow Limitations)",
            text,
        ):
            set_field("ahi", _to_float(match.group(1)))
            set_field("rdi", _to_float(match.group(2)))

    if match := re.search(r"Max\.\s*Apnea Duration \(s\)\s*\n(\d+)", text):
        set_field("apnea_max_duration_s", int(match.group(1)))

    if match := re.search(r"Max\.\s*Hypopnoea Duration \(s\)\s+(?:-\s+)*(\d+)", text):
        set_field("hypopnea_max_duration_s", int(match.group(1)))

    if match := re.search(
        r"Artefact \(min\)\s+(?:-\s+)*(" + _DECIMAL + r")\s*\((" + _DECIMAL + r")%\)",
        text,
    ):
        set_field("artefact_minutes", _to_float(match.group(1)))
        set_field("artefact_pct", _to_float(match.group(2)))

    # --- SpO2 ---
    for label, attr, caster in [
        (r"Baseline O2 Saturation", "baseline_spo2_pct", int),
        (r"Average SpO2(?!\s*Delay)", "average_spo2_pct", int),
        (r"Minimum SpO2 \(%\)", "minimum_spo2_pct", int),
        (r"Biggest Desaturation \(%\)", "biggest_desaturation_pct", int),
        (r"Number\s*<\s*90\s*%", "count_below_90", int),
        (r"Number\s*<\s*80\s*%", "count_below_80", int),
    ]:
        if match := re.search(label + r"\s+(\d+)", text):
            set_field(attr, caster(match.group(1)))

    if match := re.search(r"Time\s*<\s*90\s*%\s+(" + _DECIMAL + r")\s*%", text):
        set_field("time_below_90_pct", _to_float(match.group(1)))

    if match := re.search(r"Longest Desaturation \(s\)\s+(" + _DECIMAL + r")\s*s?", text):
        set_field("longest_desaturation_s", _to_float(match.group(1)))

    # The "All" column of the desaturation table is the overall desat index.
    if match := re.search(
        r"Number of Desaturations \(Index\)\s+(\d+)\s*\((" + _DECIMAL + r")\)",
        text,
    ):
        set_field("desaturation_index", _to_float(match.group(2)))

    # --- Position (sleep-time fraction row) ---
    # Row format: "Sleep Time Fraction (%) <prone> <supine> <left> <right> <upright>"
    if match := re.search(
        r"Sleep Time Fraction \(%\)\s+("
        + _DECIMAL
        + r")\s+("
        + _DECIMAL
        + r")\s+("
        + _DECIMAL
        + r")\s+("
        + _DECIMAL
        + r")\s+("
        + _DECIMAL
        + r")",
        text,
    ):
        prone, supine, left, right, upright = (_to_float(match.group(i)) for i in range(1, 6))
        set_field("prone_fraction_pct", prone)
        set_field("supine_fraction_pct", supine)
        set_field("left_fraction_pct", left)
        set_field("right_fraction_pct", right)
        set_field("upright_fraction_pct", upright)

    if match := re.search(r"not Supine\s*\n(" + _DECIMAL + r")", text):
        set_field("not_supine_fraction_pct", _to_float(match.group(1)))

    # --- Respiratory per-type breakdown ---
    # DOMINO text order after the header:
    # "Obstructive\nMixed\nCentral\nTotal Apn.\nHypopnea\nA+H\nNumber (Index)\n"
    # followed by 6 values: Obstructive, Mixed(-), Central, Total Apn., Hypopnea, A+H
    if (
        match := re.search(
            r"Obstructive\nMixed\nCentral\nTotal Apn\.\nHypopnea\nA\+H\nNumber \(Index\)\n"
            r"(\d+)\s*\(\s*(" + _DECIMAL + r")\s*\)\n"  # Obstructive count (index)
            r"[^\n]+\n"  # Mixed: skip
            r"(\d+)\s*\(\s*(" + _DECIMAL + r")\s*\)\n"  # Central count (index)
            r"(\d+)\s*\(\s*" + _DECIMAL + r"\s*\)\n"  # Total Apn count (index skipped)
            r"(\d+)\s*\(\s*(" + _DECIMAL + r")\s*\)",  # Hypopnea count (index)
            text,
        )
    ):
        set_field("obstructive_apnea_count", int(match.group(1)))
        set_field("obstructive_apnea_index", _to_float(match.group(2)))
        set_field("central_apnea_count", int(match.group(3)))
        set_field("central_apnea_index", _to_float(match.group(4)))
        set_field("apnea_total", int(match.group(5)))
        set_field("hypopnea_total", int(match.group(6)))
        set_field("hypopnea_index", _to_float(match.group(7)))

    # --- Snoring (All column) ---
    # Text: "Snore Epis. (% Sleep Time) <prone_val>\nAll\n<count> (<index>)\n..."
    if match := re.search(
        r"Snore Epis\. \(% Sleep Time\)[^\n]*\nAll\n(\d+)\s*\(\s*(" + _DECIMAL + r")\s*\)",
        text,
    ):
        set_field("snore_count", int(match.group(1)))
        set_field("snore_index", _to_float(match.group(2)))

    # --- Heart rate (page 3) ---
    for label, attr in [
        (r"Average HR \(bpm\)", "hr_average"),
        (r"Minimum HR \(bpm\)", "hr_minimum"),
        (r"Maximum HR \(bpm\)", "hr_maximum"),
    ]:
        if match := re.search(label + r"\s+(\d+)", text):
            set_field(attr, int(match.group(1)))

    # Wake column: after "Sleep Wake\n", skip 3 index rows then read Max/Min/Avg HR.
    # DOMINO order: Acceleration, Deceleration, Arrhythmia, Max HR, Min HR, Avg HR.
    if match := re.search(
        r"Sleep Wake\n"
        r"[^\n]+\n"  # Acceleration (Index) wake
        r"[^\n]+\n"  # Deceleration (Index) wake
        r"[^\n]+\n"  # Arrhythmia (Index) wake
        r"(\d+)\s*(?:\([^)]*\))?\s*\n"  # Maximum HR wake (timestamp stripped)
        r"(\d+)\s*(?:\([^)]*\))?\s*\n"  # Minimum HR wake
        r"(\d+)",  # Average HR wake
        text,
    ):
        set_field("hr_wake_max", int(match.group(1)))
        set_field("hr_wake_min", int(match.group(2)))
        set_field("hr_wake_mean", int(match.group(3)))

    m.field_confidence = confidence
    return m


def metrics_to_dict(result: ParseResult) -> dict[str, object]:
    """
    Serialize a ParseResult for inclusion in the case package. Always returns
    a JSON-safe dict; never raises. PHI-free by construction (the dataclass
    only has whitelisted fields).
    """
    return asdict(result)
