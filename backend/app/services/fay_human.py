"""Fay 风格数字人消息构造。

迁移自 Fay 的数字人驱动约定（见 Fay/core/fay_core.py 中 Topic=human 的消息）：
服务端只下发文本、音频地址与「通用动作语义」（code/behavior/affect），
具体动作编号由前端映射，便于更换 Live2D / 3D / 硬件形象。
"""

from __future__ import annotations

from urllib.parse import quote

FAY_TOPIC = "human"

GUIDANCE_WORDS = ("请", "建议", "推荐", "前往", "这边", "路线", "出发", "游览")


def action_for_sentence(text: str, index: int) -> dict[str, str]:
    """按句子内容给出通用动作语义（不含具体动作编号）。"""

    if index == 0:
        return {"code": "greeting", "behavior": "greet", "affect": "warm"}
    if any(word in text for word in GUIDANCE_WORDS):
        return {"code": "guidance.invite", "behavior": "invite", "affect": "warm"}
    return {"code": "speak.explain", "behavior": "explain", "affect": "neutral"}


def build_audio_message(
    *,
    text: str,
    index: int,
    audio_url: str | None,
    is_first: bool,
    is_end: bool,
    action: dict | None = None,
    sentiment: float | None = None,
    username: str = "",
    robot: str = "",
) -> dict:
    return {
        "Topic": FAY_TOPIC,
        "Data": {
            "Key": "audio",
            "Text": text,
            "Index": index,
            "HttpValue": audio_url,
            "IsFirst": 1 if is_first else 0,
            "IsEnd": 1 if is_end else 0,
            "Lips": [],
            "Sentiment": sentiment,
            "Action": action or action_for_sentence(text, index),
        },
        "Username": username,
        "robot": robot,
    }


def tts_url_for(text: str, index: int, base: str = "/api/tts") -> str:
    return f"{base}?text={quote(text)}&index={index}"
