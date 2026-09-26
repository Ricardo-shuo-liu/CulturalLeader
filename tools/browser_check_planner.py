"""旧「行程工作台」验收已升级为「城市流程编辑 + 整体攻略」验收。

双击城市进入流程编辑、腾讯 GL 地图拖拽/缩放、LKH TSPTW 重新优化、
我的攻略组合与只读分享页，全部在下面这个脚本里验证（含无 JS Key 的降级路径）：

    python tools/browser_check_flows.py

运行前先启动服务：./run.sh
本文件保留为兼容入口，直接转发执行。
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parent / "browser_check_flows.py"

if __name__ == "__main__":
    print("→ 转发到 tools/browser_check_flows.py（流程编辑 + 整体攻略验收）")
    sys.argv = [str(TARGET), *sys.argv[1:]]
    runpy.run_path(str(TARGET), run_name="__main__")
