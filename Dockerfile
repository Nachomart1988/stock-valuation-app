# Root-level Dockerfile for Railway deployment (backend service)
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (Docker layer caching)
COPY backend/requirements.txt .

# Install PyTorch CPU-only
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install core Python dependencies (skip optional quantum/DRL packages for smaller image)
RUN pip install --no-cache-dir $(grep -v '^\(pennylane\|qiskit\|stable-baselines3\|gymnasium\|#\)' requirements.txt)

# Optional: Quantum/DRL dependencies (controlled via build arg)
ARG ENABLE_QUANTUM=0
RUN if [ "$ENABLE_QUANTUM" = "1" ]; then \
      pip install --no-cache-dir pennylane qiskit stable-baselines3 gymnasium; \
    fi

# Copy backend application code
COPY backend/ .

EXPOSE 8000

# Railway provides $PORT
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
