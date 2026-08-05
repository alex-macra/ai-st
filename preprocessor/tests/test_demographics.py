# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Tests for EDF demographic extraction.

Demographics must be derived BEFORE de-identification (which scrubs the patient
header) and must surface only HIPAA-safe fields: age in years (capped at 89)
and sex. Birthdate and patient name must NEVER appear in the output.
"""

from datetime import datetime

from edf_parser import _normalise_sex, _parse_birthdate


def test_normalise_sex_variants():
    assert _normalise_sex("Male") == "M"
    assert _normalise_sex("F") == "F"
    assert _normalise_sex("female") == "F"
    assert _normalise_sex("X") == "X"
    assert _normalise_sex("unknown") == "X"
    assert _normalise_sex("") is None
    assert _normalise_sex(None) is None


def test_parse_birthdate_edf_plus_formats():
    assert _parse_birthdate("02 jun 2013") == datetime(2013, 6, 2)
    assert _parse_birthdate("02-Jun-2013") == datetime(2013, 6, 2)
    assert _parse_birthdate("02 June 2013") == datetime(2013, 6, 2)


def test_parse_birthdate_returns_none_on_garbage():
    assert _parse_birthdate("") is None
    assert _parse_birthdate("not a date") is None
