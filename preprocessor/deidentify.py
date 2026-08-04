# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Strip PHI from the EDF header before any downstream processing.

Operates at the byte level on the fixed-width EDF header fields:
- bytes 8–87:  local patient identification (80 ASCII chars, space-padded)
- bytes 88–167: local recording identification (80 ASCII chars, space-padded)

Signal headers and signal data are never touched, so mixed-sampling-rate
files (e.g. SOMNOtouch RESP, with oximetry @ 25 Hz and snoring @ 200 Hz)
round-trip without loss.
"""

import shutil
from pathlib import Path

_PATIENT_ID_OFFSET = 8
_PATIENT_ID_LEN = 80
_RECORDING_ID_OFFSET = 88
_RECORDING_ID_LEN = 80
_HEADER_MIN_BYTES = _RECORDING_ID_OFFSET + _RECORDING_ID_LEN  # 168

_DEIDENTIFIED_PATIENT = b"X X X X".ljust(_PATIENT_ID_LEN, b" ")


def _deidentified_recording_id(raw: bytes) -> bytes:
    """
    Replace the recording-id field while preserving the EDF+ "Startdate dd-MMM-yyyy"
    prefix if present, since some readers parse the start date out of this field.
    """
    text = raw.decode("ascii", errors="replace").rstrip()
    if text.startswith("Startdate "):
        parts = text.split(" ", 2)
        if len(parts) >= 2:
            preserved = f"Startdate {parts[1]} X X X"
            return preserved.encode("ascii", errors="replace").ljust(_RECORDING_ID_LEN, b" ")
    return b"X X X X".ljust(_RECORDING_ID_LEN, b" ")


TOP_CROP_PX = 40


def deidentify_screenshot(image_bytes: bytes) -> bytes:
    """Crop the top strip from a screenshot to remove the DOMINO patient-info bar."""
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    width, height = img.size
    cropped = img.crop((0, TOP_CROP_PX, width, height))
    buf = io.BytesIO()
    cropped.save(buf, format=img.format or "PNG")
    return buf.getvalue()


def deidentify_edf_header(edf_path: Path, out_dir: str) -> Path:
    """
    Write a PHI-stripped copy of the EDF to `out_dir/clean.edf` and return its path.

    Only the patient and recording identification fields in the fixed EDF header
    are overwritten; everything else (signal headers, signal data, annotations)
    is preserved byte-for-byte.
    """
    clean_path = Path(out_dir) / "clean.edf"
    shutil.copy2(edf_path, clean_path)

    file_size = clean_path.stat().st_size
    if file_size < _HEADER_MIN_BYTES:
        raise ValueError(f"EDF too small to contain a valid header ({file_size} bytes < {_HEADER_MIN_BYTES})")

    with open(clean_path, "r+b") as f:
        f.seek(_RECORDING_ID_OFFSET)
        original_recording_id = f.read(_RECORDING_ID_LEN)

        f.seek(_PATIENT_ID_OFFSET)
        f.write(_DEIDENTIFIED_PATIENT)

        f.seek(_RECORDING_ID_OFFSET)
        f.write(_deidentified_recording_id(original_recording_id))

    return clean_path
