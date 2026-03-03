from typing import Optional
import uuid

from pydantic import BaseModel


class UploadResponse(BaseModel):
    """파일 업로드 결과"""
    well_id: uuid.UUID
    well_name: str
    records_inserted: int
    date_range: Optional[dict] = None  # {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
    columns_found: list[str] = []
    warnings: list[str] = []
    message: str = "업로드 성공"
