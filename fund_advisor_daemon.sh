#!/bin/bash
# 基金投资分析服务守护进程：仅本机访问 127.0.0.1:3081
cd "$(dirname "$0")"
while true; do
  if ! curl -s -o /dev/null --max-time 2 http://127.0.0.1:3081/api/status; then
    echo "[$(date '+%F %T')] fund-advisor 未运行，启动中..." >> /tmp/fund_advisor_daemon.log
    pkill -f '^node server/index\.js' 2>/dev/null
    sleep 1
    nohup node server/index.js >> /tmp/fund_advisor.log 2>&1 &
    for i in $(seq 1 20); do
      sleep 1
      curl -s -o /dev/null --max-time 2 http://127.0.0.1:3081/api/status && break
    done
  fi
  sleep 8
done
