#!/usr/bin/env bash
# 一键校验：后端 pytest + 前端天文/地形逻辑 + 前端 JS 语法。
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="/home/ricaedo/下载/yes/envs/leader/bin/python"
[ -x "$PYTHON" ] || PYTHON="python"
NODE=".tools/node/bin/node"
[ -x "$NODE" ] || NODE="node"

echo "== 后端测试 =="
"$PYTHON" -m pytest backend/tests -q

echo "== 前端逻辑校验 =="
"$NODE" --import ./tools/node-three-register.mjs tools/check_frontend.mjs

echo "== 前端语法检查 =="
for file in frontend/js/*.js frontend/js/map/*.js frontend/js/data/*.js; do
  cp "$file" /tmp/cl_check.mjs
  "$NODE" --check /tmp/cl_check.mjs
done
echo "语法检查通过"
