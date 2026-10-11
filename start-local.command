#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"

if command -v lsof >/dev/null 2>&1; then
  occupied_pid="$(lsof -tiTCP:8765 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$occupied_pid" ]]; then
    print -u2 "本機 8765 連接埠已有服務（PID: $occupied_pid）。請先在舊終端按 Control+C，或確認程序後執行 kill $occupied_pid，再重新開啟此腳本。"
    exit 1
  fi
fi

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
  bundled_node="/Users/ray/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [[ -x "$bundled_node" ]]; then
    node_bin="$bundled_node"
  else
    print -u2 '找不到 Node.js。請先安裝 Node.js，再執行此檔案。'
    exit 1
  fi
fi

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  read -r "DEEPSEEK_API_KEY?請輸入 DeepSeek API key（輸入時會顯示）："
  if [[ -z "$DEEPSEEK_API_KEY" ]]; then
    print -u2 '未輸入 API key，已取消啟動。'
    exit 1
  fi
  export DEEPSEEK_API_KEY
fi

export OPEN_BROWSER=1
exec "$node_bin" server.js
