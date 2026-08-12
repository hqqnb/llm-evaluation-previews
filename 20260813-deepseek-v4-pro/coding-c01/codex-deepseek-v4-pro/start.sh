#!/usr/bin/env bash
# 《极光》星舰 3D —— 一键启动
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
echo "已启动本地服务器：http://localhost:${PORT}  （Ctrl+C 退出）"
python3 -m http.server "$PORT" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1
if command -v open >/dev/null 2>&1; then
  open "http://localhost:${PORT}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:${PORT}"
fi
wait $SERVER_PID
