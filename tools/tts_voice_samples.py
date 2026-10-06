"""给 CosyVoice2 的每个内置音色合成一段样例，并用基频（F0）判断男女声。

用法：
    python tools/tts_voice_samples.py                 # 全部内置音色
    python tools/tts_voice_samples.py anna bella      # 只试指定音色
样例输出在 tests_artifacts/voice-samples/，可以直接播放对比。
"""

from __future__ import annotations

import io
import json
import struct
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import get_settings  # noqa: E402

BUILTIN_VOICES = ["alex", "anna", "bella", "benjamin", "charles", "claire", "david", "diana"]
MODEL = "FunAudioLLM/CosyVoice2-0.5B"
SAMPLE_TEXT = "你好，我是这座城市的数字人讲解员，很高兴陪你一起逛一逛。"
OUT_DIR = Path(__file__).resolve().parents[1] / "tests_artifacts" / "voice-samples"


def synthesize(voice: str, text: str, fmt: str = "wav") -> bytes:
    settings = get_settings()
    payload = json.dumps(
        {"model": MODEL, "input": text, "voice": f"{MODEL}:{voice}", "response_format": fmt}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{settings.tts_endpoint.rstrip('/')}/audio/speech",
        data=payload,
        headers={"Authorization": f"Bearer {settings.tts_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=40) as response:  # noqa: S310
        return response.read()


def load_wav(data: bytes) -> tuple[int, list[int]]:
    with wave.open(io.BytesIO(data)) as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        frames = handle.readframes(handle.getnframes())
    if width != 2:
        raise ValueError(f"只支持 16-bit PCM，实际 {width * 8}-bit")
    samples = list(struct.unpack(f"<{len(frames) // 2}h", frames))
    if channels > 1:
        samples = samples[::channels]
    return rate, samples


def median_f0(rate: int, samples: list[int]) -> float:
    """纯 Python 自相关基频估计：返回有声片段的基频中位数（Hz）。"""
    step = 2 if rate > 12000 else 1
    data = samples[::step]
    effective = rate / step
    window, hop = 1024, 512
    low_lag, high_lag = int(effective / 400), int(effective / 70)
    values: list[float] = []
    for start in range(0, max(0, len(data) - window), hop):
        frame = data[start : start + window]
        mean = sum(frame) / len(frame)
        frame = [value - mean for value in frame]
        energy = sum(value * value for value in frame)
        if energy < 5_000_000:  # 静音/气息段直接跳过
            continue
        best_lag, best_corr = 0, 0.0
        for lag in range(low_lag, high_lag):
            corr = 0.0
            for index in range(0, window - lag, 2):
                corr += frame[index] * frame[index + lag]
            corr /= window - lag
            if corr > best_corr:
                best_corr, best_lag = corr, lag
        if best_lag:
            # 抗八度误差：如果 lag/2 的相关性也接近最佳，说明真正的基频在更低的 lag 上
            half = best_lag // 2
            if half >= low_lag:
                corr_half = 0.0
                for index in range(0, window - half, 2):
                    corr_half += frame[index] * frame[index + half]
                corr_half /= window - half
                if corr_half >= best_corr * 0.8:
                    best_lag = half
            values.append(effective / best_lag)
    values.sort()
    return values[len(values) // 2] if values else 0.0


def guess_gender(f0: float) -> str:
    if f0 <= 0:
        return "无法判断"
    if f0 >= 175:
        return "女声（偏高）"
    if f0 >= 155:
        return "女声（偏低）"
    if f0 >= 110:
        return "男声"
    return "男声（低沉）"


def main() -> int:
    wanted = sys.argv[1:] or BUILTIN_VOICES
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"模型：{MODEL}    样例文本：{SAMPLE_TEXT}")
    print("-" * 78)
    print(f"{'音色':10} {'时长':>6} {'基频F0':>9} {'判断':12} 文件")
    rows = []
    for voice in wanted:
        try:
            audio = synthesize(voice, SAMPLE_TEXT, "wav")
        except urllib.error.HTTPError as error:
            print(f"{voice:10} 失败：HTTP {error.code} {error.read().decode('utf-8', 'ignore')[:80]}")
            continue
        except Exception as error:  # noqa: BLE001
            print(f"{voice:10} 失败：{error}")
            continue
        rate, samples = load_wav(audio)
        seconds = len(samples) / rate
        f0 = median_f0(rate, samples)
        path = OUT_DIR / f"{voice}.wav"
        path.write_bytes(audio)
        rows.append((voice, seconds, f0, guess_gender(f0)))
        print(f"{voice:10} {seconds:5.1f}s {f0:8.1f}Hz {guess_gender(f0):12} {path.name}")
    print("-" * 78)
    female = [row[0] for row in rows if row[3].startswith("女声")]
    male = [row[0] for row in rows if row[3].startswith("男声")]
    print(f"女声：{'、'.join(female) or '（未检出）'}")
    print(f"男声：{'、'.join(male) or '（未检出）'}")
    print(f"样例目录：{OUT_DIR}")
    print("挑好之后把 .env 里的 TTS_VOICE 改成 FunAudioLLM/CosyVoice2-0.5B:<音色> 再重启服务即可。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
