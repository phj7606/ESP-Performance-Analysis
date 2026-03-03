from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import upload, wells

app = FastAPI(
    title="ESP Performance Analysis System API",
    version="0.1.0",
    description="Offshore ESP 성능 저하 감지 및 잔여 수명 예측 플랫폼",
)

# CORS 설정: 프론트엔드(localhost:3000) 접근 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 라우터 등록
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(wells.router, prefix="/api", tags=["wells"])


@app.get("/health", tags=["health"])
async def health_check():
    """서버 상태 확인 엔드포인트"""
    return {"status": "ok"}
