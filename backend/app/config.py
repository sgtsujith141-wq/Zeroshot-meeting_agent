"""Runtime configuration loaded from environment / git-ignored .env files."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent

# Repo-root .env first, backend/.env may override. Neither is ever committed.
load_dotenv(REPO_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    organizer_token: str = field(default_factory=lambda: os.getenv("ORGANIZER_TOKEN", ""))
    organizer_name: str = field(default_factory=lambda: os.getenv("ORGANIZER_NAME", "Organiser"))

    llm_provider: str = field(default_factory=lambda: os.getenv("LLM_PROVIDER", "auto").lower())
    gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
    gemini_model: str = field(default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))
    ollama_base_url: str = field(
        default_factory=lambda: os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    )
    ollama_model: str = field(default_factory=lambda: os.getenv("OLLAMA_MODEL", "qwen3:8b"))
    llm_temperature: float = field(default_factory=lambda: _float("LLM_TEMPERATURE", 0.0))
    llm_seed: int = field(default_factory=lambda: _int("LLM_SEED", 7))
    llm_timeout_seconds: int = field(default_factory=lambda: _int("LLM_TIMEOUT_SECONDS", 600))

    sarvam_api_key: str = field(default_factory=lambda: os.getenv("SARVAM_API_KEY", ""))
    sarvam_model: str = field(default_factory=lambda: os.getenv("SARVAM_STT_MODEL", "saaras:v4"))
    sarvam_mode: str = field(default_factory=lambda: os.getenv("SARVAM_STT_MODE", "codemix"))
    sarvam_language_code: str = field(
        default_factory=lambda: os.getenv("SARVAM_LANGUAGE_CODE", "unknown")
    )

    data_dir: Path = field(
        default_factory=lambda: _resolve_data_dir(os.getenv("DATA_DIR", "backend/data"))
    )
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 200))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.getenv(
                "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if o.strip()
        )
    )
    default_timezone: str = field(
        default_factory=lambda: os.getenv("DEFAULT_TIMEZONE", "Asia/Kolkata")
    )
    reminder_poll_seconds: int = field(default_factory=lambda: _int("REMINDER_POLL_SECONDS", 30))

    smtp_host: str = field(default_factory=lambda: os.getenv("SMTP_HOST", ""))
    smtp_port: int = field(default_factory=lambda: _int("SMTP_PORT", 587))
    smtp_username: str = field(default_factory=lambda: os.getenv("SMTP_USERNAME", ""))
    smtp_password: str = field(default_factory=lambda: os.getenv("SMTP_PASSWORD", ""))
    smtp_from: str = field(default_factory=lambda: os.getenv("SMTP_FROM", ""))

    @property
    def db_path(self) -> Path:
        return self.data_dir / "app.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)


def _resolve_data_dir(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else (REPO_DIR / p).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
