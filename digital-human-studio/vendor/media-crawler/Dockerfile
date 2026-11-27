FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    MEDIA_CRAWLER_DATA_DIR=/app/data \
    MEDIA_CRAWLER_TASK_DB=/app/data/tasks.db \
    PATH="/app/.venv/bin:/usr/local/bin:$PATH"

RUN sed -i "s|deb.debian.org|mirrors.aliyun.com|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && sed -i "s|security.debian.org|mirrors.aliyun.com|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
 && sed -i "s|deb.debian.org|mirrors.aliyun.com|g" /etc/apt/sources.list 2>/dev/null || true \
 && sed -i "s|security.debian.org|mirrors.aliyun.com|g" /etc/apt/sources.list 2>/dev/null || true \
 && apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl nodejs libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ uv==0.10.9

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev \
 && uv run playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright

COPY . .

RUN set -eux \
 && sed -i "s/^HEADLESS = False/HEADLESS = True/" config/base_config.py \
 && sed -i "s/^ENABLE_CDP_MODE = True/ENABLE_CDP_MODE = False/" config/base_config.py || true \
 && sed -i "s/headless: bool = False/headless: bool = True/" api/schemas/crawler.py \
 && mkdir -p /app/data /app/browser_data \
 && (getent passwd mediacrawler >/dev/null || useradd --create-home --shell /usr/sbin/nologin --uid 10001 mediacrawler) \
 && chown -R 10001:10001 /app /ms-playwright \
 && ls -la /app/api/webui/index.html

USER 10001:10001
EXPOSE 8080
CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
