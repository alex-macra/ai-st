"""Unit tests for main.py internal helpers.

HTTP-contract tests (endpoint shapes, status codes) live in test_ingest_contract.py.
These exercise the private helpers directly so edge cases aren't buried behind HTTP.
"""
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from main import _minimal_case_package, _parse_pdf_metrics, PREPROCESSOR_VERSION
from const import SCHEMA_VERSION


class TestMinimalCasePackage:
    def test_no_files(self):
        pkg = _minimal_case_package(pdf_path=None, screenshot_filenames=[], cohort="adult")
        assert pkg["edf_available"] is False
        assert pkg["pdf_available"] is False
        assert pkg["screenshot_count"] == 0
        assert pkg["screenshot_filenames"] == []
        assert pkg["recording"] is None
        assert pkg["channels"] == []
        assert pkg["candidate_windows"] == []

    def test_pdf_only(self, tmp_path):
        pdf = tmp_path / "report.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        pkg = _minimal_case_package(pdf_path=pdf, screenshot_filenames=[], cohort="adult")
        assert pkg["pdf_available"] is True
        assert pkg["edf_available"] is False
        assert pkg["screenshot_count"] == 0

    def test_screenshots_only(self):
        pkg = _minimal_case_package(
            pdf_path=None,
            screenshot_filenames=["a.png", "b.png"],
            cohort="pediatric",
        )
        assert pkg["pdf_available"] is False
        assert pkg["screenshot_count"] == 2
        assert pkg["screenshot_filenames"] == ["a.png", "b.png"]
        assert pkg["cohort"] == "pediatric"

    def test_pdf_and_screenshots(self, tmp_path):
        pdf = tmp_path / "r.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        pkg = _minimal_case_package(
            pdf_path=pdf,
            screenshot_filenames=["img.png"],
            cohort="adult",
            pdf_metrics={"ahi": 12.5},
        )
        assert pkg["pdf_available"] is True
        assert pkg["screenshot_count"] == 1
        assert pkg["pdf_metrics"] == {"ahi": 12.5}

    def test_carries_schema_and_version(self):
        pkg = _minimal_case_package(pdf_path=None, screenshot_filenames=[], cohort="adult")
        assert pkg["schema_version"] == SCHEMA_VERSION
        assert pkg["preprocessor_version"] == PREPROCESSOR_VERSION

    def test_counts_totals_are_zero(self):
        pkg = _minimal_case_package(pdf_path=None, screenshot_filenames=[], cohort="adult")
        assert pkg["candidate_count_total"] == 0
        assert pkg["candidate_count_trimmed_from_llm_package"] == 0
        assert pkg["missing_channels"] == []
        assert pkg["low_quality_channels"] == []


class TestParsePdfMetrics:
    def test_nonexistent_file_returns_none(self, tmp_path):
        result = _parse_pdf_metrics(tmp_path / "ghost.pdf")
        assert result is None

    def test_invalid_pdf_returns_none(self, tmp_path):
        bad = tmp_path / "junk.pdf"
        bad.write_bytes(b"this is not a pdf")
        result = _parse_pdf_metrics(bad)
        assert result is None

    def test_empty_file_returns_none(self, tmp_path):
        empty = tmp_path / "empty.pdf"
        empty.write_bytes(b"")
        result = _parse_pdf_metrics(empty)
        assert result is None
