#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required. See docs/getting-started.md.' >&2
  exit 1
fi
exec node scripts/start.js --ai
