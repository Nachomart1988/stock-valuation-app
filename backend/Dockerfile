# Use Python slim image (much smaller than full Python)
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (minimal)
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for Docker layer caching)
COPY requirements.txt .

# Install PyTorch CPU-only first (from official CPU index)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install core Python dependencies (skip optional quantum/DRL packages for smaller image)
RUN pip install --no-cache-dir $(grep -v '^\(pennylane\|qiskit\|stable-baselines3\|gymnasium\|#\)' requirements.txt)

# Optional: Quantum/DRL dependencies (controlled via build arg)
ARG ENABLE_QUANTUM=0
RUN if [ "$ENABLE_QUANTUM" = "1" ]; then \
      pip install --no-cache-dir pennylane qiskit stable-baselines3 gymnasium; \
    fi

# Copy application code
COPY . .

# Expose port (Railway will override this with $PORT)
EXPOSE 8000

# Start command - Railway provides $PORT
# Use shell form to allow variable expansion
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
