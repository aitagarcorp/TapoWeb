#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
export TZ="America/Caracas"
export PYTHONUNBUFFERED=1

cd /home/advcamaras/apps/webtapo

exec .venv/bin/python -m backend
