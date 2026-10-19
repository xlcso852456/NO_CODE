"""本機 RTSP 測試串流：啟動 MediaMTX，再用 FFmpeg 推一路影像上去。

    python start_test_rtsp.py              # 推測試圖樣 (1920x1080)
    python start_test_rtsp.py 影片.mp4      # 循環播放指定影片

串流網址：rtsp://127.0.0.1:8554/test，按 Ctrl+C 停止。
"""

import socket
import subprocess
import sys
import time
from pathlib import Path

import imageio_ffmpeg

HERE = Path(__file__).resolve().parent
MEDIAMTX = HERE / "mediamtx" / "mediamtx.exe"
CONFIG = HERE / "mediamtx_test.yml"
URL = "rtsp://127.0.0.1:8554/test"


def wait_for_port(port: int, timeout: float = 10) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False


def main() -> None:
    if len(sys.argv) > 1:
        video = Path(sys.argv[1])
        if not video.exists():
            sys.exit(f"找不到影片：{video}")
        source = ["-re", "-stream_loop", "-1", "-i", str(video)]
        label = f"影片 {video.name}（循環播放）"
    else:
        source = ["-re", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=15"]
        label = "測試圖樣 1920x1080"

    if not MEDIAMTX.exists():
        sys.exit(
            f"找不到 {MEDIAMTX}\n"
            "請到 https://github.com/bluenviron/mediamtx/releases 下載 Windows 版"
            "（mediamtx_v*_windows_amd64.zip），解壓縮到 test_rtsp/mediamtx/"
        )
    server = subprocess.Popen([str(MEDIAMTX), str(CONFIG)], cwd=MEDIAMTX.parent)
    try:
        if not wait_for_port(8554):
            sys.exit("MediaMTX 沒有啟動成功（8554 埠可能被占用）")
        print(f"\n測試串流：{URL}\n內容：{label}\n按 Ctrl+C 停止\n", flush=True)
        subprocess.run([
            imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
            *source,
            "-an", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p", "-g", "15",
            "-f", "rtsp", "-rtsp_transport", "tcp", URL,
        ])
    except KeyboardInterrupt:
        pass
    finally:
        server.terminate()
        server.wait()


if __name__ == "__main__":
    main()
