import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import upload, wells, analysis
from app.api import export

app = FastAPI(
    title="ESP Performance Analysis System API",
    version="0.1.0",
    description="Offshore ESP performance degradation detection and remaining useful life prediction platform",
)

# CORS 허용 오리진: 환경변수 ALLOWED_ORIGINS로 복수 도메인 지정 가능.
# 미설정 시 로컬 개발 환경(localhost:3000) 기본값 사용.
# 배포 시: ALLOWED_ORIGINS=https://your-app.vercel.app,https://another-domain.com
_allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in _allowed_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(wells.router, prefix="/api", tags=["wells"])
app.include_router(analysis.router, prefix="/api", tags=["analysis"])
app.include_router(export.router, prefix="/api", tags=["export"])


@app.get("/health", tags=["health"])
async def health_check():
    """Server health check endpoint"""
    return {"status": "ok"}
