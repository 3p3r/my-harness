#!/usr/bin/env bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
venv_python="$repo_root/.venv-langchain-smoke311/bin/python"

if [[ ! -x "$venv_python" ]]; then
  printf 'Missing %s\n' "$venv_python" >&2
  exit 1
fi

exec "$venv_python" "$repo_root/tools/langchain_fleet_smoke.py" "$@"
