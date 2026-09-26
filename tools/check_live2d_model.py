"""校验 Live2D 模型是否满足接入要求（对齐 Fay《Live2D模型制作要求》）。

用法：
    python tools/check_live2d_model.py                 # 读取 assets/live2d/config.json
    python tools/check_live2d_model.py path/to/x.model3.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIVE2D_DIR = ROOT / "frontend" / "assets" / "live2d"
CONFIG = LIVE2D_DIR / "config.json"

REQUIRED_LIP_SYNC = "ParamMouthOpenY"
REQUIRED_EYE = ("ParamEyeLOpen", "ParamEyeROpen")
REQUIRED_MOTION_GROUPS = ("Idle", "TapBody")

results: list[tuple[str, str]] = []


def check(level: str, message: str) -> None:
    results.append((level, message))


def resolve_model_path(argv: list[str]) -> Path | None:
    if len(argv) > 1:
        return Path(argv[1]).expanduser().resolve()
    if not CONFIG.exists():
        check("FAIL", f"找不到配置 {CONFIG.relative_to(ROOT)}")
        return None
    payload = json.loads(CONFIG.read_text(encoding="utf-8"))
    model = payload.get("model")
    if not model:
        check("FAIL", "config.json 里没有 model 字段")
        return None
    return (LIVE2D_DIR / model).resolve()


def main() -> int:
    model_path = resolve_model_path(sys.argv)
    if model_path is None:
        report()
        return 1

    check("INFO", f"模型文件：{model_path}")
    if not model_path.exists():
        check("FAIL", "模型文件不存在 —— 把 Cubism 导出的整个目录放到 frontend/assets/live2d/model/")
        return report()

    try:
        model = json.loads(model_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        check("FAIL", f"model3.json 解析失败：{error}")
        return report()

    version = model.get("Version")
    check("PASS" if version == 3 else "WARN", f"model3.json 版本：{version}（建议 3）")

    references = model.get("FileReferences", {})
    base = model_path.parent

    moc = references.get("Moc")
    if moc and (base / moc).exists():
        check("PASS", f"模型文件存在：{moc}")
    else:
        check("FAIL", f"缺少 .moc3：{moc}")

    textures = references.get("Textures") or []
    missing_textures = [texture for texture in textures if not (base / texture).exists()]
    if not textures:
        check("FAIL", "没有贴图（Textures 为空）")
    elif missing_textures:
        check("FAIL", f"贴图缺失：{', '.join(missing_textures[:3])}")
    else:
        check("PASS", f"贴图齐全：{len(textures)} 张")

    for optional, label in (("Physics", "物理"), ("Pose", "姿态")):
        value = references.get(optional)
        if value and not (base / value).exists():
            check("WARN", f"{label}文件声明了但不存在：{value}")

    groups = {group.get("Name"): group.get("Ids", []) for group in model.get("Groups", [])}
    lip_ids = groups.get("LipSync", [])
    if REQUIRED_LIP_SYNC in lip_ids:
        check("PASS", f"LipSync 组包含 {REQUIRED_LIP_SYNC}")
    else:
        check("FAIL", f"缺少 LipSync 组或组内没有 {REQUIRED_LIP_SYNC}（口型必需）")
    if "EyeBlink" in groups and all(item in groups["EyeBlink"] for item in REQUIRED_EYE):
        check("PASS", "EyeBlink 组包含 ParamEyeLOpen / ParamEyeROpen")
    else:
        check("WARN", "缺少 EyeBlink 组（自动眨眼会不可用）")

    motions = references.get("Motions") or {}
    for group in REQUIRED_MOTION_GROUPS:
        items = motions.get(group) or []
        if items:
            check("PASS", f"动作组 {group}：{len(items)} 个")
        else:
            check("FAIL" if group == "Idle" else "WARN", f"缺少动作组 {group}")

    # Fay 要求：动作/表情不得对 ParamMouthOpenY 设置关键帧
    offenders = []
    for group, items in motions.items():
        for item in items:
            file = item.get("File")
            if not file:
                continue
            path = base / file
            if path.exists() and REQUIRED_LIP_SYNC in path.read_text(encoding="utf-8", errors="ignore"):
                offenders.append(f"{group}/{file}")
    if offenders:
        check(
            "WARN",
            f"以下动作含 {REQUIRED_LIP_SYNC} 关键帧：{', '.join(offenders[:3])}"
            "（本项目每帧在动作之后覆盖该参数，一般不影响；若口型抖动再移除）",
        )
    else:
        check("PASS", f"动作未占用 {REQUIRED_LIP_SYNC}（口型由程序独占）")

    total_motions = sum(len(items) for items in motions.values())
    check("INFO", f"动作文件合计 {total_motions} 个；运行时会读取参数表，若缺少头部/眼球参数只影响跟随效果")
    return report()


def report() -> int:
    if not results:
        return 1
    print("Live2D 模型校验")
    print("-" * 52)
    for level, message in results:
        print(f"[{level:4}] {message}")
    failures = sum(1 for level, _ in results if level == "FAIL")
    warnings = sum(1 for level, _ in results if level == "WARN")
    print("-" * 52)
    print(f"结论：{'通过' if failures == 0 else '未通过'}（FAIL {failures} / WARN {warnings}）")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
