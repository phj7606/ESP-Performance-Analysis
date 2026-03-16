from typing import Optional
import uuid

from pydantic import BaseModel


class WellUploadResult(BaseModel):
    """Well 1개 업로드 결과"""
    well_id: uuid.UUID
    well_name: str
    records_inserted: int
    date_range: Optional[dict] = None  # {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
    columns_found: list[str] = []
    warnings: list[str] = []


class UploadResponse(BaseModel):
    """파일 업로드 전체 결과 (멀티 Well 지원)"""
    wells: list[WellUploadResult]
    total_wells: int
    total_records: int
    message: str = "Upload successful"
