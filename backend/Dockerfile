FROM python:3.11-slim

WORKDIR /app

# 시스템 의존성 설치 (psycopg2 빌드 필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 의존성 먼저 복사 (레이어 캐시 최적화)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

EXPOSE 8000
