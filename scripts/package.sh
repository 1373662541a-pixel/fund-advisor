#!/bin/bash
# 打包发布：完整便携版（含 node_modules + 离线数据）
set -e
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
DATE=$(date +%Y%m%d)
OUT=dist
PKG=fund-advisor-v${VER}-${DATE}
mkdir -p "$OUT"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$PKG"

# 代码与依赖
cp -r server public scripts node_modules "$STAGE/$PKG/"
# 数据（含节假日、基金名称库、OCR 字库、运行时文件）
mkdir -p "$STAGE/$PKG/data"
cp -r data/. "$STAGE/$PKG/data/"
# 根文件
cp package.json package-lock.json README.md fund_advisor_daemon.sh "$STAGE/$PKG/"

# 便携启动脚本
cat > "$STAGE/$PKG/start.sh" <<'SH'
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
SH

cat > "$STAGE/$PKG/stop.sh" <<'SH'
#!/bin/bash
pkill -f "node server/index.js" && echo "已停止" || echo "未在运行"
SH
chmod +x "$STAGE/$PKG/start.sh" "$STAGE/$PKG/stop.sh"

# 清理临时垃圾
find "$STAGE/$PKG" -name "*.tmp" -o -name "*.tmpdir" -o -name "*.log" | xargs -r rm -rf

# tar.gz：从包目录内打包，不含顶层目录条目（规避 proot 环境解压 chmod 报错）
tar -C "$STAGE/$PKG" -czf "$OUT/${PKG}.tar.gz" .
# zip
if command -v zip >/dev/null 2>&1; then
  (cd "$STAGE" && zip -rq "$OLDPWD/$OUT/${PKG}.zip" "$PKG")
else
  python3 - "$STAGE" "$OUT/${PKG}.zip" "$PKG" <<'PY'
import sys, os, zipfile
stage, zpath, pkg = sys.argv[1], sys.argv[2], sys.argv[3]
root = os.path.join(stage, pkg)
with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
    for r, _, fs in os.walk(root):
        for f in fs:
            full = os.path.join(r, f)
            z.write(full, os.path.relpath(full, stage))
print('zip 完成:', zpath)
PY
fi
ls -lh "$OUT"
echo "打包完成：$OUT/${PKG}.tar.gz"
