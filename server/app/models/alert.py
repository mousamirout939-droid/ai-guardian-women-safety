from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

AlertSource = Literal[
    "manual_sos", "gesture_detection", "scream_detection",
    "object_detection", "fall_detection", "voice_command",
]
AlertSeverity = Literal["low", "medium", "high", "critical"]
AlertStatus = Literal["active", "acknowledged", "resolved", "false_alarm"]


class GeoPoint(BaseModel):
    latitude: float
    longitude: float


class AlertCreate(BaseModel):
    source: AlertSource
    severity: AlertSeverity = "high"
    message: str = ""
    location: GeoPoint | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: dict = Field(default_factory=dict)


class AlertOut(BaseModel):
    id: str
    user_id: str
    source: AlertSource
    severity: AlertSeverity
    status: AlertStatus
    message: str
    location: GeoPoint | None = None
    confidence: float
    metadata: dict
    created_at: datetime
    resolved_at: datetime | None = None


class AlertStatusUpdate(BaseModel):
    status: AlertStatus
