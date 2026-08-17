#!/bin/bash
pkill -f "^node server/index\.js" && echo "已停止" || echo "未在运行"
