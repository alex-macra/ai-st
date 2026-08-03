"""PHI-free tests for the DOMINO light Report print parser."""

from __future__ import annotations

from pathlib import Path

from parsers.domino_pdf import (
    DominoMetrics,
    ParseFailure,
    metrics_to_dict,
    parse_domino_pdf,
)


def test_dataclass_defaults_are_phi_free():
    m = DominoMetrics()
    d = metrics_to_dict(m)
    # The whitelist dataclass cannot carry name/DOB/clinic by construction;
    # this test guards against future fields being added without thought.
    forbidden = {
        "name",
        "first_name",
        "last_name",
        "dob",
        "date_of_birth",
        "patient_id",
        "physician",
        "scorer",
        "clinic",
        "hospital",
        "address",
        "phone",
        "email",
        "weight",
        "height",
        "bmi",
    }
    assert forbidden.isdisjoint(d.keys())


def test_metrics_to_dict_handles_failure():
    failure = ParseFailure(reason="unsupported_pdf_variant", variant="other")
    d = metrics_to_dict(failure)
    assert d == {"parsed": False, "reason": "unsupported_pdf_variant", "variant": "other"}


def test_unsupported_variant_returns_failure(tmp_path: Path):
    # Hand-build a tiny PDF whose /Title is not the supported variant, and
    # confirm the parser refuses it cleanly instead of attempting extraction.
    from pypdf import PdfWriter

    out = tmp_path / "wrong_variant.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_metadata({"/Title": "Some Other Sleep Report"})
    with out.open("wb") as f:
        writer.write(f)

    result = parse_domino_pdf(out)
    assert isinstance(result, ParseFailure)
    assert result.reason == "unsupported_pdf_variant"
    assert result.variant == "Some Other Sleep Report"


def test_unreadable_path_returns_failure(tmp_path: Path):
    bogus = tmp_path / "does-not-exist.pdf"
    result = parse_domino_pdf(bogus)
    assert isinstance(result, ParseFailure)
    assert result.reason == "pdf_read_error"
