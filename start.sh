#!/bin/bash
# 基金投资分析助手 · 便携启动
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "未发现 node_modules，正在安装依赖（需要网络）..."
  npm install --no-audit --no-fund || { echo "依赖安装失败"; exit 1; }
fi
PORT="${FUND_ADVISOR_PORT:-3081}"
echo "基金投资分析助手已启动: http://127.0.0.1:${PORT}"
exec node server/index.js
