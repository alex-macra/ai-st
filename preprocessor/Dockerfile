# Build from the repository root:
#   docker build -f preprocessor/Dockerfile .
FROM python:3.12-slim

# libgomp is required by the NumPy/SciPy stack that MNE pulls in. matplotlib
# already selects the Agg backend in chart_renderer.py, so no display is needed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY preprocessor/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY preprocessor/ ./

# Evidence output is shared with the API through a volume mounted here.
ENV CHARTS_DIR=/var/lib/ai-st/charts \
    SLICES_DIR=/var/lib/ai-st/slices

# uid 1000 matches the `node` user in the API image. Both services mount the
# same evidence volume, and whichever container initialises it fixes the
# ownership for the other, so the two uids have to agree.
RUN useradd --create-home --uid 1000 preprocessor \
 && mkdir -p /var/lib/ai-st/charts /var/lib/ai-st/slices \
 && chown -R preprocessor:preprocessor /var/lib/ai-st /app
USER preprocessor

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/healthz', timeout=2).status == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
