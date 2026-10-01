#!/bin/sh
# One command boot for Linux and Mac. Uses src/daemon2.js.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATA_DIR=${ZOT_DATA_DIR:-"$HOME/.zot"}
PORT=${PORT:-8787}
mkdir -p "$DATA_DIR"
export ZOT_DATA_DIR="$DATA_DIR"
export PORT="$PORT"
exec node "$ROOT/src/daemon2.js" "$@"
