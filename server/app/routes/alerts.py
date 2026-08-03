from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user, require_role
from app.core.ws_manager import manager
from app.database import get_db
from app.models.alert import AlertCreate, AlertOut, AlertStatusUpdate

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


def _serialize(doc: dict) -> AlertOut:
    return AlertOut(
        id=str(doc["_id"]),
        user_id=doc["user_id"],
        source=doc["source"],
        severity=doc["severity"],
        status=doc.get("status", "active"),
        message=doc.get("message", ""),
        location=doc.get("location"),
        confidence=doc.get("confidence", 1.0),
        metadata=doc.get("metadata", {}),
        created_at=doc["created_at"],
        resolved_at=doc.get("resolved_at"),
    )


@router.post("", response_model=AlertOut, status_code=status.HTTP_201_CREATED)
async def create_alert(payload: AlertCreate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = payload.model_dump()
    doc["user_id"] = current_user["_id"]
    doc["status"] = "active"
    doc["created_at"] = datetime.now(timezone.utc)
    doc["resolved_at"] = None
    result = await db.alerts.insert_one(doc)
    doc["_id"] = result.inserted_id

    alert_out = _serialize(doc)
    await manager.send_to_user(current_user["_id"], {"type": "new_alert", "alert": alert_out.model_dump()})
    await manager.broadcast({"type": "network_alert", "alert": alert_out.model_dump(), "user_name": current_user.get("full_name")})
    return alert_out


@router.get("", response_model=list[AlertOut])
async def list_alerts(current_user: dict = Depends(get_current_user), limit: int = 50):
    db = get_db()
    cursor = db.alerts.find({"user_id": current_user["_id"]}).sort("created_at", -1).limit(limit)
    return [_serialize(doc) async for doc in cursor]


@router.get("/feed", response_model=list[AlertOut])
async def alerts_feed(_: dict = Depends(require_role("police", "admin")), limit: int = 100):
    """Live feed of all alerts network-wide, restricted to police/admin roles."""
    db = get_db()
    cursor = db.alerts.find({}).sort("created_at", -1).limit(limit)
    return [_serialize(doc) async for doc in cursor]


@router.patch("/{alert_id}/status", response_model=AlertOut)
async def update_alert_status(alert_id: str, payload: AlertStatusUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    updates: dict = {"status": payload.status}
    if payload.status == "resolved":
        updates["resolved_at"] = datetime.now(timezone.utc)

    result = await db.alerts.find_one_and_update(
        {"_id": ObjectId(alert_id), "user_id": current_user["_id"]},
        {"$set": updates},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    alert_out = _serialize(result)
    await manager.send_to_user(current_user["_id"], {"type": "alert_updated", "alert": alert_out.model_dump()})
    return alert_out
