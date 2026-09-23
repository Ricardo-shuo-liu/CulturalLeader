#!/usr/bin/env bash
# 启动本地讲台。
#   PORT=9000 ./run.sh        指定端口（被占用时直接报错退出）
#   PYTHON=/path/to/python ./run.sh   指定解释器
set -euo pipefail

cd "$(dirname "$0")"

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  if [ -x "/home/ricaedo/下载/yes/envs/leader/bin/python" ]; then
    PYTHON="/home/ricaedo/下载/yes/envs/leader/bin/python"
  else
    PYTHON="python"
  fi
fi

port_in_use() {
  timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" >/dev/null 2>&1
}

REQUESTED_PORT="${PORT:-}"
PORT="${PORT:-8000}"

if port_in_use "$PORT"; then
  echo "⚠  端口 ${PORT} 已被占用，可能已经有一个服务在运行："
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep -E ":${PORT}[[:space:]]" || true
  fi
  if [ -n "$REQUESTED_PORT" ]; then
    echo "   请先结束占用进程，或换端口：PORT=8001 ./run.sh"
    exit 1
  fi
  for candidate in 8001 8002 8003 8010 8080; do
    if ! port_in_use "$candidate"; then
      echo "   → 自动改用端口 ${candidate}"
      PORT="$candidate"
      break
    fi
  done
  if port_in_use "$PORT"; then
    echo "   8000/8001/8002/8003/8010/8080 均被占用，请手动指定：PORT=9000 ./run.sh"
    exit 1
  fi
fi

echo "CulturalLeader → http://127.0.0.1:${PORT}/  （后台 /admin，默认令牌 dev-token，Ctrl+C 停止）"
exec "$PYTHON" -m uvicorn backend.app.main:app --host 127.0.0.1 --port "$PORT"
