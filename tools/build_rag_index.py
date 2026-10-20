"""构建本地非遗资料库 RAG 索引。

用法：
    python tools/build_rag_index.py            # asset/ → data/rag/ich.db
    python tools/build_rag_index.py --status   # 只看当前索引状态
    python tools/build_rag_index.py --asset asset --db data/rag/ich.db --force
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import rag  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="构建非遗 RAG 索引")
    parser.add_argument("--asset", default=None, help="资料目录（默认 .env/配置里的 rag_asset_dir）")
    parser.add_argument("--db", default=None, help="索引文件路径（默认 data/rag/ich.db）")
    parser.add_argument("--status", action="store_true", help="只打印索引状态")
    parser.add_argument("--force", action="store_true", help="即使索引已是最新也重建")
    args = parser.parse_args()

    asset_root = Path(args.asset) if args.asset else rag.asset_dir()
    target = Path(args.db) if args.db else rag.db_path()
    if args.status:
        print(json.dumps(rag.status(), ensure_ascii=False, indent=2))
        return 0
    if not asset_root.exists():
        print(f"资料目录不存在：{asset_root}")
        return 1
    if not args.force and target.exists():
        try:
            with rag._connect(target) as conn:  # noqa: SLF001 - 工具脚本直接读元信息
                meta = rag._read_meta(conn)  # noqa: SLF001
            if meta.get("asset_signature") == rag.asset_signature(asset_root):
                print(f"索引已是最新：{target}（{meta.get('chunks')} 块）")
                return 0
        except Exception:  # noqa: BLE001
            pass
    print(f"资料目录：{asset_root}")
    stats = rag.rebuild_index(asset_root, target, progress=lambda message: print(f"  {message}"))
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
