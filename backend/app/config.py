from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = PROJECT_ROOT / "frontend"
DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    """运行配置。除 ADMIN_TOKEN 外全部可选，缺失即自动降级为本地 Mock。"""

    model_config = SettingsConfigDict(env_file=str(PROJECT_ROOT / ".env"), extra="ignore")

    openai_api_key: str = ""
    openai_base_url: str = ""
    chat_model: str = "gpt-4o-mini"
    tts_model: str = "tts-1"
    tts_voice: str = "alloy"
    asr_model: str = "whisper-1"

    mock_mode: str = "auto"
    admin_token: str = "dev-token"
    database_url: str = f"sqlite:///{DATA_DIR / 'app.db'}"

    @property
    def mock(self) -> bool:
        if self.mock_mode.strip().lower() == "on":
            return True
        return not self.openai_api_key.strip()

    @property
    def base_url(self) -> str | None:
        value = self.openai_base_url.strip()
        return value or None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return Settings()
