# Relay server image. Small, single-purpose: runs the FastAPI webhook relay.
FROM python:3.11-slim

# Keep Python lean and unbuffered so logs stream out promptly.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY swingbot ./swingbot
COPY run_relay.py run_report.py run_backtest.py ./

# Persisted at runtime via volumes (see docker-compose.yml).
RUN mkdir -p logs data

EXPOSE 8000

# Uvicorn serves the module-level `app` built from the environment.
CMD ["uvicorn", "swingbot.relay.server:app", "--host", "0.0.0.0", "--port", "8000"]
