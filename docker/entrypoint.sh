#!/usr/bin/env bash
# CulturalLeader 容器入口：启动前打印一次能力自检，然后把进程交出去（exec，信号直通 uvicorn）。
# 自检只读环境变量与镜像内容，缺任何一项都不影响启动。
set -euo pipefail

cd /app

python - <<'PY' || echo "[entry] 自检跳过（不影响启动）"
from pathlib import Path

from backend.app.config import DATA_DIR, FRONTEND_DIR, get_settings

settings = get_settings()
lkh = Path("/app/LKH-3.0.14/LKH")
lkh_ready = lkh.exists() and bool(lkh.stat().st_mode & 0o111)
model_dir = FRONTEND_DIR / "assets" / "live2d" / "model"
has_model = any(model_dir.glob("*.model3.json"))
db = DATA_DIR / "app.db"

print("─" * 62)
print("CulturalLeader 启动自检")
print(f"  数据目录   {DATA_DIR}（{'已有 app.db，沿用' if db.exists() else '首次启动，将自动建库播种'}）")
print(f"  行程求解   {'LKH-3.0.14 已就绪' if lkh_ready else '未找到 LKH：退回内置启发式（插入法 + 2-opt）'}")
print(f"  地图服务   {'腾讯位置服务已配置' if settings.map_ready else '未配置 Key：自建矢量底图 + 通勤估算'}")
print(f"  大模型     {'已配置' if settings.openai_api_key.strip() else '未配置：本地知识库 Mock 讲解'}")
print(f"  语音合成   {'云端 TTS（音色 ' + settings.tts_voice + '）' if settings.tts_ready else '未配置：浏览器语音'}")
print(f"  语音识别   {'已配置' if settings.asr_ready else '未配置：浏览器识别 / 文字输入'}")
print(f"  数字人形象 {'已挂载模型' if has_model else '未挂载模型：界面会提示放入形象'}")
print("─" * 62)
PY

exec "$@"
