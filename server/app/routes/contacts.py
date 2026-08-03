from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import get_current_user
from app.database import get_db
from app.models.contact import ContactCreate, ContactOut, ContactUpdate

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _serialize(doc: dict) -> ContactOut:
    return ContactOut(
        id=str(doc["_id"]),
        user_id=doc["user_id"],
        name=doc["name"],
        phone=doc["phone"],
        email=doc.get("email"),
        relationship=doc.get("relationship", "other"),
        priority=doc.get("priority", 1),
    )


@router.get("", response_model=list[ContactOut])
async def list_contacts(current_user: dict = Depends(get_current_user)):
    db = get_db()
    cursor = db.contacts.find({"user_id": current_user["_id"]}).sort("priority", 1)
    return [_serialize(doc) async for doc in cursor]


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def create_contact(payload: ContactCreate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = payload.model_dump()
    doc["user_id"] = current_user["_id"]
    result = await db.contacts.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


@router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(contact_id: str, payload: ContactUpdate, current_user: dict = Depends(get_current_user)):
    db = get_db()
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    result = await db.contacts.find_one_and_update(
        {"_id": ObjectId(contact_id), "user_id": current_user["_id"]},
        {"$set": updates},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    return _serialize(result)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(contact_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.contacts.delete_one({"_id": ObjectId(contact_id), "user_id": current_user["_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
