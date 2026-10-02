import asyncio
import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
import httpx

from app.config import get_settings
from app.core.deps import get_current_user, require_role
from app.core.ws_manager import manager
from app.database import get_db
from app.models.alert import AlertCreate, AlertOut, AlertStatusUpdate

router = APIRouter(prefix="/api/alerts", tags=["alerts"])
logger = logging.getLogger(__name__)


async def _send_sos_sms(contacts: list[dict], user_name: str, location: dict | None) -> dict:
    if not contacts:
        return {"status": "no_contacts", "sent": 0, "total": 0}

    settings = get_settings()
    if not all((settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_FROM_NUMBER)):
        return {"status": "not_configured", "sent": 0, "total": len(contacts)}

    message = f"Emergency SOS from {user_name}. Please contact them immediately."
    if location:
        message += f" Last location: https://maps.google.com/?q={location['latitude']},{location['longitude']}"
    endpoint = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"

    async def send_one(client: httpx.AsyncClient, contact: dict) -> bool:
        try:
            response = await client.post(
                endpoint,
                data={"To": contact["phone"], "From": settings.TWILIO_FROM_NUMBER, "Body": message},
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
            )
            response.raise_for_status()
            return True
        except httpx.HTTPError:
            logger.warning("SOS SMS request failed for a trusted contact")
            return False

    async with httpx.AsyncClient(timeout=8.0) as client:
        results = await asyncio.gather(*(send_one(client, contact) for contact in contacts))

    sent = sum(results)
    notification_status = "accepted" if sent == len(contacts) else "partial" if sent else "failed"
    return {"status": notification_status, "sent": sent, "total": len(contacts)}


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

    if payload.source == "manual_sos":
        contacts = []
        try:
            contacts = [contact async for contact in db.contacts.find({"user_id": current_user["_id"]}).sort("priority", 1)]
            doc["metadata"]["sms_notification"] = await _send_sos_sms(
                contacts,
                current_user.get("full_name", "A user"),
                payload.location.model_dump() if payload.location else None,
            )
        except Exception:
            logger.exception("Could not process SMS notifications for SOS alert")
            doc["metadata"]["sms_notification"] = {"status": "failed", "sent": 0, "total": len(contacts)}
        try:
            await db.alerts.update_one({"_id": result.inserted_id}, {"$set": {"metadata": doc["metadata"]}})
        except Exception:
            logger.exception("Could not persist SOS SMS notification status")

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
