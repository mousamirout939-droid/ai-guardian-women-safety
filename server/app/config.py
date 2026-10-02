"""
Central application configuration.
Reads from environment variables (see .env.example at project root).
"""
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    APP_NAME: str = "AI Guardian Shield"
    ENV: str = "development"
    DEBUG: bool = True

    # Security / JWT
    JWT_SECRET_KEY: str = "change-this-secret-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    MONGO_URI: str = "mongodb://localhost:27017"
    MONGO_DB_NAME: str = "guardian_shield"

    # Redis (rate limiting / caching)
    REDIS_URL: str = "redis://localhost:6379/0"

    # Optional SMS delivery for manual SOS alerts
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    # CORS
    CORS_ORIGINS: str = (
        "https://ai-guardian-women-safety.vercel.app,"
        "https://ai-guardian-women-safety.onrender.com,"
        "http://localhost:5173,http://localhost:3000,http://localhost:80"
    )

    # AI thresholds
    GESTURE_CONFIDENCE_THRESHOLD: float = 0.7
    OBJECT_DETECTION_CONFIDENCE: float = 0.45
    SCREAM_PROBABILITY_THRESHOLD: float = 0.6

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("MONGO_URI")
    @classmethod
    def normalize_mongo_uri(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned.startswith("mongodb:mongodb+srv://"):
            return cleaned.replace("mongodb:mongodb+srv://", "mongodb+srv://", 1)
        if cleaned.startswith("mongodb:mongodb://"):
            return cleaned.replace("mongodb:mongodb://", "mongodb://", 1)
        return cleaned

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
