#!/usr/bin/env bash
# Linux 啟動腳本：./run.sh
#   讓其他電腦連線：HOST=0.0.0.0 ./run.sh
#   （網頁沒有登入機制，開放後同網段的人都能看到 RTSP 帳密並修改專案）
#   換埠：PORT=8080 ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8010}"
# 有 .venv 虛擬環境就用它，否則用系統的 python3
if [ -z "${PYTHON:-}" ]; then
    if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi
fi

echo "Starting NO_CODE server on ${HOST}:${PORT}  (Ctrl+C to stop)"
if [ "$HOST" = "0.0.0.0" ]; then
    echo "Open from other computers: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${PORT}"
else
    echo "Open: http://${HOST}:${PORT}"
fi
exec "$PYTHON" -m uvicorn main:app --host "$HOST" --port "$PORT"
