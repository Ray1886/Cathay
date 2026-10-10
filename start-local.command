#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"

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

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -r "OPENAI_API_KEY?請輸入 OpenAI API key（輸入時會顯示）："
  if [[ -z "$OPENAI_API_KEY" ]]; then
    print -u2 '未輸入 API key，已取消啟動。'
    exit 1
  fi
  export OPENAI_API_KEY
fi

export OPEN_BROWSER=1
exec "$node_bin" server.js
