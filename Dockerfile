# Stage 1: Build frontend
FROM node:20-slim AS frontend
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci --silent
COPY ui/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim

# WeasyPrint system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf2.0-0 \
    libffi-dev shared-mime-info && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml cli.py ./
COPY src/ src/
COPY resume/templates/ resume/templates/
COPY config/ config/
COPY .env.example .env.example

# Copy built frontend from stage 1
COPY --from=frontend /app/src/api/static src/api/static/

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["scout", "ui", "--no-browser"]
