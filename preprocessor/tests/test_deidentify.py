"""
Byte-level tests for EDF header de-identification.

We synthesize a minimal EDF-shaped header (just the first 256 bytes are needed
for our byte-level patcher to operate) and verify the patient + recording
identification fields are overwritten while every other byte is preserved.
"""
from pathlib import Path
import pytest
from PIL import Image
import io

from deidentify import deidentify_edf_header


def _make_image(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), color=(200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_deidentify_screenshot_crops_top_strip():
    from deidentify import deidentify_screenshot, TOP_CROP_PX
    original = _make_image(800, 600)
    result = deidentify_screenshot(original)
    out_img = Image.open(io.BytesIO(result))
    assert out_img.size == (800, 600 - TOP_CROP_PX)


def _make_fake_edf(path: Path, patient_id: bytes, recording_id: bytes, tail: bytes = b"") -> None:
    assert len(patient_id) == 80
    assert len(recording_id) == 80
    header = b"0       " + patient_id + recording_id  # bytes 0..167
    # bytes 168..255 are startdate/starttime/etc - fill with spaces for the test
    header += b" " * (256 - len(header))
    path.write_bytes(header + tail)


def test_patient_field_is_redacted(tmp_path):
    src = tmp_path / "src.edf"
    out = tmp_path / "out"
    out.mkdir()
    _make_fake_edf(
        src,
        patient_id=b"PCODE M 01-JAN-1990 EXAMPLE_PERSON".ljust(80, b" "),
        recording_id=b"Startdate 01-JAN-2025 INV01 EQ01".ljust(80, b" "),
    )

    result = deidentify_edf_header(src, str(out))

    data = result.read_bytes()
    patient = data[8:88]
    assert patient == b"X X X X".ljust(80, b" ")
    assert b"EXAMPLE_PERSON" not in data
    assert b"PCODE" not in data


def test_recording_field_preserves_startdate_prefix(tmp_path):
    src = tmp_path / "src.edf"
    out = tmp_path / "out"
    out.mkdir()
    _make_fake_edf(
        src,
        patient_id=b"PCODE M 01-JAN-1990 NAME".ljust(80, b" "),
        recording_id=b"Startdate 15-MAR-2025 InvestigatorJohn EquipmentX".ljust(80, b" "),
    )

    result = deidentify_edf_header(src, str(out))

    recording = result.read_bytes()[88:168]
    assert recording.startswith(b"Startdate 15-MAR-2025 ")
    assert b"InvestigatorJohn" not in recording
    assert b"EquipmentX" not in recording
    assert len(recording) == 80


def test_recording_field_without_startdate_prefix_fully_redacted(tmp_path):
    src = tmp_path / "src.edf"
    out = tmp_path / "out"
    out.mkdir()
    _make_fake_edf(
        src,
        patient_id=b"X X X X NAME".ljust(80, b" "),
        recording_id=b"SomeFreeformText InvestigatorName".ljust(80, b" "),
    )

    result = deidentify_edf_header(src, str(out))

    recording = result.read_bytes()[88:168]
    assert recording == b"X X X X".ljust(80, b" ")


def test_signal_data_preserved_byte_for_byte(tmp_path):
    src = tmp_path / "src.edf"
    out = tmp_path / "out"
    out.mkdir()
    tail_bytes = bytes(range(256)) * 16  # 4 KB of distinct signal-region bytes
    _make_fake_edf(
        src,
        patient_id=b"PCODE M 01-JAN-1990 NAME".ljust(80, b" "),
        recording_id=b"Startdate 01-JAN-2025 X X".ljust(80, b" "),
        tail=tail_bytes,
    )

    result = deidentify_edf_header(src, str(out))

    src_bytes = src.read_bytes()
    out_bytes = result.read_bytes()
    assert len(out_bytes) == len(src_bytes)
    # everything past the recording-id field must be untouched
    assert out_bytes[168:] == src_bytes[168:]


def test_file_too_small_raises(tmp_path):
    src = tmp_path / "tiny.edf"
    src.write_bytes(b"\x00" * 100)
    out = tmp_path / "out"
    out.mkdir()

    with pytest.raises(ValueError, match="too small"):
        deidentify_edf_header(src, str(out))


def test_returns_path_under_out_dir(tmp_path):
    src = tmp_path / "src.edf"
    out = tmp_path / "out"
    out.mkdir()
    _make_fake_edf(
        src,
        patient_id=b" " * 80,
        recording_id=b" " * 80,
    )

    result = deidentify_edf_header(src, str(out))
    assert result.name == "clean.edf"
    assert result.parent == out
