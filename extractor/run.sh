#!/usr/bin/env bash
# Build the knowledge graph with Graphify. Build-time only — the Next.js app
# never runs Python. Creates the venv on first use.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "Creating Python venv for Graphify…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
fi

if ! "$PY" -c "import graphify" >/dev/null 2>&1; then
  echo "Installing graphifyy…"
  "$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"
fi

exec "$PY" "$HERE/extract.py"
