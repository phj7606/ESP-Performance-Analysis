from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import upload, wells, analysis

app = FastAPI(
    title="ESP Performance Analysis System API",
    version="0.1.0",
    description="Offshore ESP performance degradation detection and remaining useful life prediction platform",
)

# CORS configuration: allow access from frontend (localhost:3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(wells.router, prefix="/api", tags=["wells"])
app.include_router(analysis.router, prefix="/api", tags=["analysis"])


@app.get("/health", tags=["health"])
async def health_check():
    """Server health check endpoint"""
    return {"status": "ok"}
