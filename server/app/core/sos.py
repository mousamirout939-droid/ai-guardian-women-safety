import asyncio
import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


def create_tracking_token(alert_id: str) -> str:
    settings = get_settings()
    return hmac.new(
        settings.JWT_SECRET_KEY.encode(),
        f"sos-tracking:{alert_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


def hash_tracking_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_tracking_url(token: str) -> str:
    settings = get_settings()
    return f"{settings.PUBLIC_APP_URL.rstrip('/')}/track/{token}"


async def send_sos_sms(
    contacts: list[dict],
    user_name: str,
    location: dict | None,
    tracking_url: str = "",
) -> dict:
    if not contacts:
        return {"status": "no_contacts", "sent": 0, "total": 0}

    settings = get_settings()
    if not all((settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_FROM_NUMBER)):
        return {"status": "not_configured", "sent": 0, "total": len(contacts)}

    message = f"Emergency SOS from {user_name}. Please contact them immediately."
    if tracking_url:
        message += f" Live status and location: {tracking_url}"
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


async def process_due_sos_escalations(db, now: datetime | None = None) -> int:
    settings = get_settings()
    now = now or datetime.now(timezone.utc)
    due_alerts = db.alerts.find({
        "source": "manual_sos",
        "status": "active",
        "escalation.next_at": {"$lte": now},
    })
    processed = 0

    async for alert in due_alerts:
        escalation = alert.get("escalation", {})
        expected_next_at = escalation.get("next_at")
        if not expected_next_at:
            continue
        claimed = await db.alerts.find_one_and_update(
            {
                "_id": alert["_id"],
                "status": "active",
                "escalation.next_at": expected_next_at,
            },
            {"$set": {"escalation.next_at": now + timedelta(seconds=settings.SOS_ESCALATION_DELAY_SECONDS)}},
            return_document=True,
        )
        if not claimed:
            continue

        contacts = [contact async for contact in db.contacts.find({"user_id": alert["user_id"]}).sort("priority", 1)]
        contact_index = int(escalation.get("next_contact_index", 0))
        tracking_url = create_tracking_url(create_tracking_token(str(alert["_id"])))
        location = alert.get("location")
        updates: dict = {}

        if contact_index < len(contacts):
            target = contacts[contact_index]
            result = await send_sos_sms([target], alert.get("user_name", "A user"), location, tracking_url)
            updates = {
                "escalation.next_contact_index": contact_index + 1,
                "escalation.last_target": target.get("name", "Trusted contact"),
                "escalation.last_sms_status": result["status"],
            }
        elif settings.SOS_POLICE_HELPLINE and not escalation.get("helpline_notified"):
            result = await send_sos_sms(
                [{"phone": settings.SOS_POLICE_HELPLINE}],
                alert.get("user_name", "A user"),
                location,
                tracking_url,
            )
            updates = {
                "escalation.helpline_notified": True,
                "escalation.last_target": "Configured emergency helpline",
                "escalation.last_sms_status": result["status"],
            }
        else:
            updates = {
                "escalation.next_at": None,
                "escalation.state": "exhausted",
            }

        if updates:
            await db.alerts.update_one({"_id": alert["_id"], "status": "active"}, {"$set": updates})
        processed += 1

    return processed


async def sos_escalation_worker(db_getter) -> None:
    while True:
        try:
            await process_due_sos_escalations(db_getter())
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("SOS escalation worker iteration failed")
        await asyncio.sleep(15)