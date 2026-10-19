#!/usr/bin/env bash
# Linux 用：./start_test_rtsp.sh            推測試圖樣
#           ./start_test_rtsp.sh 影片.mp4   循環播放影片
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "${PYTHON:-}" ]; then
    if [ -x "$DIR/../.venv/bin/python" ]; then PYTHON="$DIR/../.venv/bin/python"; else PYTHON=python3; fi
fi
exec "$PYTHON" "$DIR/start_test_rtsp.py" "$@"
