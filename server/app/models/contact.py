from pydantic import BaseModel, EmailStr, Field


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=9, max_length=16, pattern=r"^\+[1-9]\d{7,14}$")
    email: EmailStr | None = None
    relationship: str = Field(default="other", max_length=50)
    priority: int = Field(default=1, ge=1, le=5)


class ContactOut(ContactCreate):
    id: str
    user_id: str


class ContactUpdate(BaseModel):
    name: str | None = None
    phone: str | None = Field(default=None, min_length=9, max_length=16, pattern=r"^\+[1-9]\d{7,14}$")
    email: EmailStr | None = None
    relationship: str | None = None
    priority: int | None = None
