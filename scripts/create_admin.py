"""
Creates (or promotes) an admin user directly in MongoDB.
Useful for bootstrapping the first admin/police account since signup
always creates role="user" accounts by design.

Usage:
    python scripts/create_admin.py --email admin@example.com --password "StrongPass123" --name "Admin User" --role admin
"""
import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402


async def main(email: str, password: str, name: str, phone: str, role: str) -> None:
    settings = get_settings()
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]

    existing = await db.users.find_one({"email": email})
    if existing:
        await db.users.update_one({"email": email}, {"$set": {"role": role}})
        print(f"Existing user {email} promoted to role='{role}'.")
    else:
        await db.users.insert_one({
            "full_name": name,
            "email": email,
            "phone": phone,
            "password_hash": hash_password(password),
            "role": role,
            "created_at": datetime.now(timezone.utc),
        })
        print(f"Created new {role} user: {email}")

    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bootstrap an admin/police account")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--name", default="Admin User")
    parser.add_argument("--phone", default="+10000000000")
    parser.add_argument("--role", default="admin", choices=["admin", "police"])
    args = parser.parse_args()

    asyncio.run(main(args.email, args.password, args.name, args.phone, args.role))
