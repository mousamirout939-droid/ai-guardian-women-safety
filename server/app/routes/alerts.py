import asyncio
import logging
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
import httpx

from app.config import get_settings
from app.core.sos import create_tracking_token, create_tracking_url, hash_tracking_token, send_sos_sms
from app.core.deps import get_current_user, require_role
from app.core.ws_manager import manager
from app.database import get_db
from app.models.alert import AlertCreated, AlertCreate, AlertOut, AlertStatusUpdate, LocationUpdate

router = APIRouter(prefix="/api/alerts", tags=["alerts"])
logger = logging.getLogger(__name__)


_send_sos_sms = send_sos_sms


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


@router.post("", response_model=AlertCreated, status_code=status.HTTP_201_CREATED)
async def create_alert(payload: AlertCreate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = payload.model_dump()
    now = datetime.now(timezone.utc)
    doc["_id"] = ObjectId()
    doc["user_id"] = current_user["_id"]
    doc["status"] = "active"
    doc["created_at"] = now
    doc["resolved_at"] = None
    tracking_url = None
    if payload.source == "manual_sos":
        token = create_tracking_token(str(doc["_id"]))
        settings = get_settings()
        tracking_url = create_tracking_url(token)
        doc["user_name"] = current_user.get("full_name", "A user")
        doc["tracking_token_hash"] = hash_tracking_token(token)
        doc["tracking_expires_at"] = now + timedelta(hours=settings.SOS_TRACKING_EXPIRY_HOURS)
        doc["location_history"] = ([{
            "latitude": payload.location.latitude,
            "longitude": payload.location.longitude,
            "timestamp": now,
        }] if payload.location else [])
        doc["escalation"] = {
            "next_contact_index": 0,
            "next_at": now + timedelta(seconds=settings.SOS_ESCALATION_DELAY_SECONDS),
            "state": "waiting_for_acknowledgement",
        }

    result = await db.alerts.insert_one(doc)
    doc["_id"] = result.inserted_id

    if payload.source == "manual_sos":
        contacts = []
        try:
            contacts = [contact async for contact in db.contacts.find({"user_id": current_user["_id"]}).sort("priority", 1)]
            initial_contacts = contacts[:1]
            sms_result = await _send_sos_sms(
                initial_contacts,
                current_user.get("full_name", "A user"),
                payload.location.model_dump() if payload.location else None,
                tracking_url or "",
            )
            sms_result["total_contacts"] = len(contacts)
            sms_result["notified_contact"] = initial_contacts[0].get("name") if initial_contacts else None
            doc["metadata"]["sms_notification"] = sms_result
            if initial_contacts:
                doc["escalation"]["next_contact_index"] = 1
        except Exception:
            logger.exception("Could not process SMS notifications for SOS alert")
            doc["metadata"]["sms_notification"] = {"status": "failed", "sent": 0, "total": len(contacts)}
        try:
            await db.alerts.update_one(
                {"_id": result.inserted_id},
                {"$set": {"metadata": doc["metadata"], "escalation": doc["escalation"]}},
            )
        except Exception:
            logger.exception("Could not persist SOS SMS notification status")

    alert_out = _serialize(doc)
    await manager.send_to_user(current_user["_id"], {"type": "new_alert", "alert": alert_out.model_dump()})
    await manager.broadcast({"type": "network_alert", "alert": alert_out.model_dump(), "user_name": current_user.get("full_name")})
    return AlertCreated(**alert_out.model_dump(), tracking_url=tracking_url)


@router.put("/{alert_id}/location")
async def update_sos_location(
    alert_id: str,
    payload: LocationUpdate,
    current_user: dict = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    point = {**payload.model_dump(), "timestamp": now}
    result = await get_db().alerts.update_one(
        {"_id": ObjectId(alert_id), "user_id": current_user["_id"], "source": "manual_sos", "status": "active"},
        {
            "$set": {"location": payload.model_dump(), "last_location_at": now},
            "$push": {"location_history": {"$each": [point], "$slice": -300}},
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active SOS alert not found")
    return {"status": "location_updated", "timestamp": now}


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
    if payload.status == "acknowledged":
        updates["acknowledged_at"] = datetime.now(timezone.utc)
        updates["acknowledged_by"] = current_user.get("full_name", "User")

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
