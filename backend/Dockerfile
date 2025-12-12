# ===========================
#  Base Image
# ===========================
FROM python:3.10-slim

# ===========================
# Install system dependencies
# ===========================
RUN apt-get update && apt-get install -y \
    build-essential \
    libhdf5-dev \
    libsndfile1 \
    libjpeg62-turbo-dev \
    zlib1g-dev \
    libpng-dev \
    libfreetype6-dev \
    libopenblas-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# ===========================
# Set working directory
# ===========================
WORKDIR /app

# ===========================
# Install Python dependencies
# ===========================
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ===========================
# Copy the backend
# ===========================
COPY . .

# ===========================
# Cloud Run environment
# ===========================
ENV PORT=8080

# ===========================
# Start server with gunicorn
# ===========================
CMD ["gunicorn", "--timeout", "180", "--workers", "1", "--threads", "8", "--bind", "0.0.0.0:8080", "app:app"]
