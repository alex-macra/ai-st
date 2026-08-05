# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
"""
Strip PHI from an upload before any downstream processing: the EDF header here,
and the patient banner on DOMINO screenshots below.

The EDF path operates at the byte level on the fixed-width header fields:
- bytes 8–87:  local patient identification (80 ASCII chars, space-padded)
- bytes 88–167: local recording identification (80 ASCII chars, space-padded)

Signal headers and signal data are never touched, so mixed-sampling-rate
files (e.g. SOMNOtouch RESP, with oximetry @ 25 Hz and snoring @ 200 Hz)
round-trip without loss.
"""

import io
import shutil
from pathlib import Path

from PIL import Image

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

# Caps decode memory at roughly 256 MB of RGBA. Well above any real screen capture
# (8K is 33 Mpx) and below Pillow's own bomb threshold, which only warns until 178 Mpx.
MAX_SCREENSHOT_PIXELS = 64_000_000


def deidentify_screenshot(image_bytes: bytes) -> bytes:
    """Crop the top strip from a screenshot to remove the DOMINO patient-info bar.

    This is a fixed-height crop, not content detection: it removes the band where
    DOMINO prints the patient banner in its default window. It is a defence, not a
    guarantee — see SAFETY.md. Raises rather than returning the original, so a
    caller cannot store an image that was not de-identified.

    Re-encoding also drops EXIF/XMP, which a workstation capture can carry: the
    save plugins write `encoderinfo`, not the source `info`. `test_deidentify.py`
    pins that, since it is Pillow's behaviour rather than ours.
    """
    img = Image.open(io.BytesIO(image_bytes))
    width, height = img.size
    if width * height > MAX_SCREENSHOT_PIXELS:
        raise ValueError(f"screenshot too large to decode ({width}x{height})")
    if height <= TOP_CROP_PX:
        raise ValueError(f"screenshot is shorter than the {TOP_CROP_PX}px patient-info crop")

    image_format = img.format or "PNG"
    cropped = img.crop((0, TOP_CROP_PX, width, height))
    buf = io.BytesIO()
    cropped.save(buf, format=image_format)
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
