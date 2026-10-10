FROM python:3.13-slim-bookworm@sha256:a1165e272e578941b84abc79e4ab38a0305cd12803a5c4247979ac7655f4d641
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /app/backend
RUN pip install --no-cache-dir uv==0.10.9
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-cache
COPY backend/app ./app
COPY backend/worker ./worker
RUN useradd --uid 10001 --create-home appuser && mkdir -p /app/storage/artifacts && chown -R appuser /app
ENV PATH="/app/backend/.venv/bin:$PATH"
USER appuser
CMD ["python", "-m", "worker.main"]
