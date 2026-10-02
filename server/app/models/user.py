from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class UserSignup(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str = Field(min_length=7, max_length=20)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    phone: str
    role: Literal["user", "police", "admin"] = "user"
    created_at: datetime


class SignupResponse(UserOut):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
