import hashlib
import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import JSONResponse

from deidentify import deidentify_edf_header
from edf_parser import parse_edf, extract_demographics, Demographics
from signal_qc import run_signal_qc
from candidate_windows import find_candidate_windows
from evidence_packager import package_evidence
from const import SCHEMA_VERSION
from chart_renderer import render_window, CHART_RENDERER_VERSION
from signal_slicer import build_signal_slices
from parsers.domino_pdf import parse_domino_pdf, ParseFailure, metrics_to_dict

logger = logging.getLogger(__name__)

PREPROCESSOR_VERSION = "0.2.0"
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
MAX_TOTAL_UPLOAD_BYTES = 400 * 1024 * 1024
MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_SCREENSHOT_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_SCREENSHOTS = 100

app = FastAPI(title="AI-ST Preprocessor", version=PREPROCESSOR_VERSION)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "version": PREPROCESSOR_VERSION, "chartRendererVersion": CHART_RENDERER_VERSION}


@app.post("/ingest")
async def ingest(
    edf: UploadFile | None = File(default=None),
    pdf: UploadFile | None = File(default=None),
    screenshots: list[UploadFile] = File(default=[]),
    cohort: str = Form(default="adult"),
):
    if cohort not in ("adult", "pediatric"):
        raise HTTPException(status_code=400, detail="cohort must be 'adult' or 'pediatric'")

    if edf is None and pdf is None and not screenshots:
        raise HTTPException(status_code=400, detail="at least one of edf, pdf, or screenshots is required")
    if len(screenshots) > MAX_SCREENSHOTS:
        raise HTTPException(status_code=413, detail="too many screenshots")

    with tempfile.TemporaryDirectory() as tmpdir:
        total_bytes = 0
        edf_path: Path | None = None
        case_hash: str | None = None
        if edf is not None:
            edf_content = await _read_upload_limited(edf)
            total_bytes += len(edf_content)
            case_hash = hashlib.sha256(edf_content).hexdigest()
            edf_path = Path(tmpdir) / "study.edf"
            edf_path.write_bytes(edf_content)

        pdf_path: Path | None = None
        pdf_metrics: dict | None = None
        if pdf is not None:
            pdf_content = await _read_upload_limited(pdf)
            if len(pdf_content) > MAX_PDF_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="PDF exceeds the size limit")
            total_bytes += len(pdf_content)
            _check_total_upload_bytes(total_bytes)
            pdf_path = Path(tmpdir) / "report.pdf"
            pdf_path.write_bytes(pdf_content)
            pdf_metrics = _parse_pdf_metrics(pdf_path)

        screenshot_filenames: list[str] = []
        for index, ss in enumerate(screenshots, start=1):
            screenshot_content = await _read_upload_limited(ss)
            if len(screenshot_content) > MAX_SCREENSHOT_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="screenshot exceeds the size limit")
            total_bytes += len(screenshot_content)
            _check_total_upload_bytes(total_bytes)
            extension = {
                "image/png": ".png",
                "image/jpeg": ".jpg",
                "image/webp": ".webp",
            }.get(ss.content_type or "", "")
            screenshot_filenames.append(f"screenshot-{index:03d}{extension}")

        if edf_path is None:
            case_package = _minimal_case_package(
                pdf_path=pdf_path,
                screenshot_filenames=screenshot_filenames,
                cohort=cohort,
                pdf_metrics=pdf_metrics,
            )
            return JSONResponse(content=case_package)

        assert case_hash is not None
        try:
            demographics = extract_demographics(edf_path)
            clean_edf_path = deidentify_edf_header(edf_path, tmpdir)
            channel_inventory = parse_edf(clean_edf_path)
            qc_results = run_signal_qc(clean_edf_path, channel_inventory)
            candidates = find_candidate_windows(clean_edf_path, channel_inventory, qc_results, cohort=cohort)

            # Render charts for top candidates (highest priority first, already sorted)
            for window in candidates.windows:
                center = (window.start_sec + window.end_sec) / 2.0
                chart_path = render_window(
                    edf_path=clean_edf_path,
                    inventory=channel_inventory,
                    event_center_sec=center,
                    case_hash=case_hash,
                )
                if chart_path is not None:
                    # Encode path reference into notes so evidence_packager can extract it
                    window.notes.insert(0, f"chart:{chart_path.name}")

            try:
                build_signal_slices(clean_edf_path, channel_inventory, candidates, case_hash)
                signal_slices_available = True
            except Exception:
                logger.warning("signal_slicer_failed")
                signal_slices_available = False

            case_package = package_evidence(
                channel_inventory=channel_inventory,
                qc_results=qc_results,
                candidates=candidates,
                pdf_path=pdf_path,
                screenshot_filenames=screenshot_filenames,
                cohort=cohort,
                preprocessor_version=PREPROCESSOR_VERSION,
                chart_renderer_version=CHART_RENDERER_VERSION,
                edf_path=clean_edf_path,
                pdf_metrics=pdf_metrics,
                demographics=demographics,
            )
            case_package["signal_slices_available"] = signal_slices_available
        except Exception as exc:
            logger.warning("study_preprocessing_failed")
            raise HTTPException(
                status_code=422,
                detail="study preprocessing failed; verify the file format and try again",
            ) from exc

    return JSONResponse(content=case_package)


async def _read_upload_limited(upload: UploadFile) -> bytes:
    content = bytearray()
    while chunk := await upload.read(1024 * 1024):
        content.extend(chunk)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="uploaded file exceeds the size limit")
    return bytes(content)


def _check_total_upload_bytes(total_bytes: int) -> None:
    if total_bytes > MAX_TOTAL_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="combined upload exceeds the size limit")


def _minimal_case_package(
    pdf_path: Path | None,
    screenshot_filenames: list[str],
    cohort: str,
    pdf_metrics: dict | None = None,
) -> dict:
    """Case package for uploads without an EDF - only document/image artifacts.
    Signal-derived fields are absent (`recording=None`, empty channels and
    candidates) and `edf_available=False` is the discriminator for downstream
    LLM passes. Schema documented in ARCHITECTURE.md → 'Upload contract'."""
    return {
        "schema_version": SCHEMA_VERSION,
        "preprocessor_version": PREPROCESSOR_VERSION,
        "cohort": cohort,
        "recording": None,
        "channels": [],
        "missing_channels": [],
        "low_quality_channels": [],
        "candidate_windows": [],
        "candidate_count_total": 0,
        "candidate_count_trimmed_from_llm_package": 0,
        "pdf_available": pdf_path is not None,
        "pdf_metrics": pdf_metrics,
        "screenshot_filenames": list(screenshot_filenames),
        "screenshot_count": len(screenshot_filenames),
        "edf_available": False,
    }


def _parse_pdf_metrics(pdf_path: Path) -> dict | None:
    """Call the DOMINO parser; return the serialised metrics dict on success,
    None on failure. Never raises - a bad PDF must not block case ingestion."""
    try:
        result = parse_domino_pdf(pdf_path)
    except Exception:
        logger.warning("pdf_parser_failed_unexpectedly")
        return None
    if isinstance(result, ParseFailure):
        logger.info("pdf_parse_failed")
        return None
    return metrics_to_dict(result)
