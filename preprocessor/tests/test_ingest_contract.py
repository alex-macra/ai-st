import httpx
import pytest

import main as service
from const import SCHEMA_VERSION
from main import app


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def request(
    method: str,
    path: str,
    **kwargs: object,
) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://synthetic.test") as client:
        return await client.request(method, path, **kwargs)


@pytest.mark.anyio
async def test_rejects_when_no_files_attached() -> None:
    response = await request("POST", "/ingest", data={"cohort": "adult"})
    assert response.status_code == 400
    assert "at least one" in response.json()["detail"]


@pytest.mark.anyio
async def test_rejects_unknown_cohort() -> None:
    response = await request(
        "POST",
        "/ingest",
        data={"cohort": "unknown"},
        files={"pdf": ("report.pdf", b"%PDF-1.4 synthetic", "application/pdf")},
    )
    assert response.status_code == 400
    assert "cohort" in response.json()["detail"]


@pytest.mark.anyio
async def test_pdf_only_returns_minimal_case_package() -> None:
    response = await request(
        "POST",
        "/ingest",
        data={"cohort": "adult"},
        files={"pdf": ("report.pdf", b"%PDF-1.4 synthetic", "application/pdf")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["edf_available"] is False
    assert body["pdf_available"] is True
    assert body["screenshot_count"] == 0
    assert body["recording"] is None
    assert body["channels"] == []
    assert body["candidate_windows"] == []
    assert body["cohort"] == "adult"
    assert body["pdf_metrics"] is None


@pytest.mark.anyio
async def test_screenshots_only_returns_safe_filenames() -> None:
    response = await request(
        "POST",
        "/ingest",
        data={"cohort": "pediatric"},
        files=[
            ("screenshots", ("screenshot-001.png", b"synthetic-a", "image/png")),
            ("screenshots", ("screenshot-002.png", b"synthetic-b", "image/png")),
        ],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["edf_available"] is False
    assert body["pdf_available"] is False
    assert body["screenshot_count"] == 2
    assert body["screenshot_filenames"] == ["screenshot-001.png", "screenshot-002.png"]
    assert body["cohort"] == "pediatric"


@pytest.mark.anyio
async def test_rejects_file_over_size_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 4)
    response = await request(
        "POST",
        "/ingest",
        files={"pdf": ("report.pdf", b"%PDF-", "application/pdf")},
    )
    assert response.status_code == 413
    assert "size limit" in response.json()["detail"]


@pytest.mark.anyio
async def test_rejects_combined_upload_over_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "MAX_UPLOAD_BYTES", 16)
    monkeypatch.setattr(service, "MAX_TOTAL_UPLOAD_BYTES", 8)
    response = await request(
        "POST",
        "/ingest",
        files=[
            ("screenshots", ("one.png", b"12345", "image/png")),
            ("screenshots", ("two.png", b"67890", "image/png")),
        ],
    )
    assert response.status_code == 413
    assert "combined upload" in response.json()["detail"]


@pytest.mark.anyio
async def test_pdf_and_screenshots_combined() -> None:
    response = await request(
        "POST",
        "/ingest",
        data={"cohort": "adult"},
        files=[
            ("pdf", ("report.pdf", b"%PDF-1.4 synthetic", "application/pdf")),
            ("screenshots", ("screenshot-001.png", b"synthetic", "image/png")),
        ],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["pdf_available"] is True
    assert body["screenshot_count"] == 1
    assert body["edf_available"] is False


@pytest.mark.anyio
async def test_response_carries_preprocessor_version_and_schema() -> None:
    response = await request(
        "POST",
        "/ingest",
        data={"cohort": "adult"},
        files={"pdf": ("report.pdf", b"%PDF-1.4 synthetic", "application/pdf")},
    )
    body = response.json()
    assert "preprocessor_version" in body
    assert body["schema_version"] == SCHEMA_VERSION
    assert "pdf_metrics" in body


@pytest.mark.anyio
async def test_healthz_reports_version() -> None:
    response = await request("GET", "/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert "version" in body
    assert "chartRendererVersion" in body
