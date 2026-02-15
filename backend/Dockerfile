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

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port (Railway will override this with $PORT)
EXPOSE 8000

# Start command - Railway provides $PORT
# Use shell form to allow variable expansion
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
