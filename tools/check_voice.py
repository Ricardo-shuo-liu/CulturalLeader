"""语音自检：确认「数字人为什么不出声」，并给出可执行的修复方法。

用法：python tools/check_voice.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import get_settings  # noqa: E402
from backend.app.services import speech  # noqa: E402


def main() -> int:
    settings = get_settings()
    print("语音自检")
    print("-" * 60)
    print(f".env：{Path(settings.model_config['env_file'])}")
    print(f"对话模型：{settings.chat_model}  地址：{settings.base_url or 'api.openai.com'}")
    print(f"MOCK 模式：{'是（无 Key，纯本地）' if settings.mock else '否'}")
    print(f"TTS 地址：{settings.tts_endpoint or 'api.openai.com'}")
    print(f"TTS 模型/音色：{settings.tts_model} / {settings.tts_voice}")
    print(f"TTS Key：{'已配置（来自 TTS_API_KEY）' if settings.tts_api_key.strip() else ('沿用 OPENAI_API_KEY' if settings.openai_api_key.strip() else '未配置')}")
    print("-" * 60)

    if not settings.tts_key:
        print("[问题] 没有配置任何语音合成 Key → 后端不合成语音，前端会退回浏览器语音。")
        print("      修复：在 .env 填 TTS_API_KEY / TTS_BASE_URL（指向支持 TTS 的服务），或安装系统语音包让浏览器出声。")

    tts_ok = False
    print("[检查] 尝试调用一次云端语音合成…")
    try:
        audio = asyncio.run(speech.synthesize("语音自检，一二三四五。"))
        print(f"[PASS] 云端 TTS 可用，返回 {len(audio)} 字节音频（约 {len(audio) / 1024:.1f} KB）")
        tts_ok = True
    except speech.SpeechUnavailable as error:
        print(f"[WARN] 云端 TTS 不可用：{error}")
    except Exception as error:  # noqa: BLE001
        print(f"[FAIL] 云端 TTS 调用失败：{type(error).__name__}: {error}")

    asr_ok = False
    print()
    print("[检查] 语音识别（按住说话）配置…")
    print(f"       ASR 地址：{settings.asr_endpoint or 'api.openai.com'} · 模型：{settings.asr_model}")
    if not settings.asr_key:
        print("[WARN] 未配置语音识别 Key（Firefox 不支持浏览器识别，按住说话会不可用）")
    elif not settings.asr_ready:
        print(f"[WARN] {settings.asr_endpoint} 不提供 /v1/audio/transcriptions，按住说话会不可用")
    else:
        try:
            import io
            import wave

            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(16000)
                handle.writeframes(b"\x00\x00" * 8000)  # 0.5 秒静音
            text = asyncio.run(speech.transcribe(buffer.getvalue(), "silence.wav", "audio/wav"))
            print(f"[PASS] 语音识别接口可用（静音测试返回：{text or '（空）'}）")
            asr_ok = True
        except Exception as error:  # noqa: BLE001
            print(f"[FAIL] 语音识别调用失败：{type(error).__name__}: {str(error)[:160]}")

    if tts_ok and asr_ok:
        print()
        print("结论：语音输出与语音输入都可用，重启服务后即可使用。")
        return 0

    print()
    print("两条修复路线（任选其一）：")
    print("  ① 用云端语音（推荐，音质稳定）——硅基流动示例（国内可直连）：")
    print("     TTS_BASE_URL=https://api.siliconflow.cn/v1")
    print("     TTS_API_KEY=sk-...（硅基流动控制台申请）")
    print("     TTS_MODEL=FunAudioLLM/CosyVoice2-0.5B")
    print("     TTS_VOICE=FunAudioLLM/CosyVoice2-0.5B:alex   # 音色 id 以控制台列表为准")
    print("     常用音色：男 alex/benjamin/charles；女 anna/claire/bella/diana（david 中低）")
    print("     试听对比：python tools/tts_voice_samples.py（样例存 tests_artifacts/voice-samples/）")
    print("     或 OpenAI 官方：TTS_BASE_URL=https://api.openai.com/v1 / TTS_MODEL=tts-1 / TTS_VOICE=alloy")
    print("     注意：DeepSeek、Kimi 等只有对话接口的网关没有 TTS，配了也不会出声。")
    print("  ② 语音识别（按住说话）同样可以指向硅基流动：")
    print("     —— 与 ① 用的是同一家服务，可以共用同一个 Key。")
    print("     ASR_BASE_URL=https://api.siliconflow.cn/v1")
    print("     ASR_API_KEY=sk-...（同上）")
    print("     ASR_MODEL=FunAudioLLM/SenseVoiceSmall")
    print("  ③ 用浏览器语音（离线、零成本）：")
    print("     Linux：sudo apt install speech-dispatcher espeak-ng，然后重启浏览器")
    print("     Windows / macOS：系统自带中文语音，直接在页面点讲解即可出声")
    print("  改完 .env 需要重启服务：Ctrl+C 后重新 ./run.sh")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
