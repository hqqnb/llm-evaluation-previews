#!/bin/bash
# 一键启动 STRIKE ZONE（macOS 双击运行）
cd "$(dirname "$0")"
echo "=============================================="
echo "  STRIKE ZONE — 战术爆破 FPS"
echo "  打开浏览器访问: http://127.0.0.1:8123"
echo "  按 Ctrl+C 关闭服务"
echo "=============================================="
if command -v node >/dev/null 2>&1; then
  node server.js
else
  python3 -m http.server 8123
fi
