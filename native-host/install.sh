#!/bin/bash
# 安装 CC Archive 的 Native Messaging host。
set -euo pipefail

EXT_ID="$1"
if [ -z "$EXT_ID" ]; then
  echo "用法: ./install.sh <扩展 ID>" >&2
  echo "扩展 ID 在 chrome://extensions 里开启「开发者模式」、加载本扩展后即可看到。" >&2
  exit 1
fi
HOST_NAME="com.ccarchive.launcher"
DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$DIR/host.mjs"

[ -f "$HOST_PATH" ] || { echo "❌ 找不到 $HOST_PATH" >&2; exit 1; }
chmod +x "$HOST_PATH"

MANIFEST=$(cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "CC Archive 启动器：执行本地命令并打开网页",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
)

# 只装到 Chrome 真正会读取的两个位置：
#   1) 全局：~/Library/Application Support/Google/Chrome/NativeMessagingHosts
#   2) 各配置文件：<profile>/NativeMessagingHosts
# 注意不要遍历 Chrome 目录下的所有子目录 —— 那些是内部数据目录，写进去没用还添乱。
TARGETS=("$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts")

# 只挑真正的配置文件目录（Default / Profile N / System Profile）
for d in "$HOME/Library/Application Support/Google/Chrome/"*/; do
  base="$(basename "$d")"
  case "$base" in
    Default|Profile\ *|System\ Profile) TARGETS+=("${d}NativeMessagingHosts") ;;
  esac
done

installed=0
for t in "${TARGETS[@]}"; do
  mkdir -p "$t"
  printf '%s\n' "$MANIFEST" > "$t/$HOST_NAME.json"
  echo "  ✅ ${t/#$HOME/~}"
  installed=$((installed+1))
done

echo
echo "已安装 $installed 处（扩展 ID: $EXT_ID）。重启 Chrome 后生效。"
