from datetime import date, datetime
from typing import Optional
import uuid

from pydantic import BaseModel


class WellResponse(BaseModel):
    id: uuid.UUID
    name: str
    field: Optional[str] = None
    latest_health_score: Optional[float] = None
    analysis_status: str
    data_count: Optional[int] = None
    date_range: Optional[dict] = None  # {"start": "2023-01-01", "end": "2024-12-31"}
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WellListResponse(BaseModel):
    wells: list[WellResponse]
    total: int
