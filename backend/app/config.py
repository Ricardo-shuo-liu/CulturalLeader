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

    # 腾讯位置服务（https://lbs.qq.com）：WebService Key 仅后端使用；JS Key 提供给浏览器地图
    tencent_map_key: str = ""
    tencent_map_sk: str = ""  # Key 开启签名校验时填写
    tencent_map_js_key: str = ""
    # 若 Key 用「域名(Referer)授权」，把白名单里的域名填这里（后端请求会带上 Referer/Origin）
    tencent_map_referer: str = ""
    map_qps: float = 3.0
    map_daily_limit: int = 5000
    allow_estimate: bool = True
    trips_dir: str = str(DATA_DIR / "trips")
    flows_dir: str = str(DATA_DIR / "flows")
    guides_dir: str = str(DATA_DIR / "guides")

    @property
    def map_ready(self) -> bool:
        return bool(self.tencent_map_key.strip())

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
