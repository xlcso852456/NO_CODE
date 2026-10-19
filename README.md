# NO_CODE 偵測設定平台

輸入 RTSP 擷取攝影機畫面 → 框選不規則區域 → 設定偵測功能，存成 JSON 給後端偵測程式使用。

操作說明請見使用手冊：[NO_CODE 偵測設定平台 使用手冊.pptx](<NO_CODE 偵測設定平台 使用手冊.pptx>)

## 啟動

```bash
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8010
```

或直接執行 `run.bat`，然後開啟 http://127.0.0.1:8010 。Linux 請見下方〈在 Linux 上執行〉。
API 文件：http://127.0.0.1:8010/docs

## 在 Linux 上執行

```bash
# 1. 取得程式（data/ 不在 GitHub 上，舊的專案資料要另外複製 data/ 資料夾過去）
git clone https://github.com/xlcso852456/NO_CODE.git
cd NO_CODE

# 2. 建立虛擬環境並安裝套件（Ubuntu 23.04+ / Debian 12 不允許直接 pip install 到系統）
sudo apt install python3-venv
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. 啟動（會自動使用 .venv）
./run.sh                  # 只有這台電腦能開網頁
HOST=0.0.0.0 ./run.sh     # 其他電腦用 http://<這台IP>:8010 連線
```

注意事項：

- 需要 Python 3.9 以上（建議 3.10+）。
- **時區**：存檔時間與偵測時段以這台電腦的時區為準，請確認時區正確（`sudo timedatectl set-timezone Asia/Taipei`）。
- 開放給其他電腦時，防火牆要開 8010 埠（例：`sudo ufw allow 8010/tcp`）。網頁沒有登入機制，只建議在內網使用。
- 這台電腦要連得到攝影機的 RTSP 網路。
- 若不是用 git clone、而是用隨身碟等方式複製，`.sh` 可能失去執行權限，先執行 `chmod +x run.sh test_rtsp/start_test_rtsp.sh`，或改用 `bash run.sh`。
- 測試串流：下載 `mediamtx_v*_linux_amd64.tar.gz`（ARM 機器如 Jetson、樹莓派用 `linux_arm64`）解壓縮到 `test_rtsp/mediamtx/`，執行 `test_rtsp/start_test_rtsp.sh`。

## 操作

1. **讀取畫面**：輸入 RTSP 網址按「讀取畫面」（或 Enter），伺服器用 OpenCV 擷取一張畫面並縮放為 960×540，座標以此尺寸為準。
2. **偵測範圍**：選「全域」則座標固定為整張畫面 `(0,0)–(960,540)`、不可框選；選「區域」才能框選。
   **框選區域**：點擊新增頂點，點第一個點或按 `Enter` 完成；`Backspace`／右鍵復原，`Esc` 取消。完成後拖曳區域內部可整塊移動，拖曳頂點可調整形狀。可框選多個區域並命名。
3. **填寫設定**：專案名稱、偵測時段，勾選功能（單選，選了一項其他會鎖住，取消勾選才能改選）：
   - 電子圍籬：進入時間（秒）
   - 群聚：人數、進入時間（秒）
   - 偵測昏倒
   - 裝備偵測：彈出視窗勾選要偵測的裝備
4. **儲存專案**：下方列表可編輯、下載 JSON、刪除。

## 本機 RTSP 測試串流

網路上的公開 RTSP 測試網址常常失效，`test_rtsp/` 內附本機測試串流（MediaMTX + FFmpeg）。

第一次使用前，到 [MediaMTX Releases](https://github.com/bluenviron/mediamtx/releases) 下載 Windows 版
（`mediamtx_v*_windows_amd64.zip`），解壓縮到 `test_rtsp/mediamtx/`，確認有 `test_rtsp/mediamtx/mediamtx.exe`。
FFmpeg 由 `pip install -r requirements.txt` 裡的 `imageio-ffmpeg` 提供，不用另外安裝。

```bash
test_rtsp\start_test_rtsp.bat              # 推測試圖樣
test_rtsp\start_test_rtsp.bat 影片.mp4      # 循環播放影片（也可把影片拖到 .bat 上）
```

啟動後在網頁填入 `rtsp://127.0.0.1:8554/test` 即可測試。只在本機 127.0.0.1 開 8554 埠，按 Ctrl+C 停止。

## 儲存格式

每個專案存在 `data/projects/{id}.json`，畫面存在 `data/images/{id}.jpg`。

```json
{
  "id": "76862c513ef8",
  "project_name": "A 廠區入口",
  "rtsp": "rtsp://192.168.1.20:554/live",
  "function": "fence",
  "scope": "region",
  "regions": [
    { "name": "區域1", "points": [[79, 79], [380, 59], [420, 250], [250, 330]] },
    { "name": "區域2", "points": [[519, 119], [880, 139], [940, 519], [559, 499]] }
  ],
  "detection_time": { "start": "08:00", "end": "18:00" },
  "fence": { "enter_seconds": 3 },
  "crowd": null,
  "equipment": [],
  "image": "76862c513ef8.jpg",
  "image_size": [960, 540],
  "created_at": "2026-10-19T19:01:09",
  "updated_at": "2026-10-19T19:01:09"
}
```

| 欄位 | 說明 |
|---|---|
| `function` | 單選：`fence` 電子圍籬、`crowd` 群聚、`fall` 偵測昏倒、`equipment` 裝備偵測 |
| `scope` | `global` 全域、`region` 區域 |
| `regions[].points` | 多邊形頂點 `[x, y]`，座標範圍 0–960 × 0–540。全域時固定為 `[{"name":"全域","points":[[0,0],[960,0],[960,540],[0,540]]}]` |
| `detection_time` | 每日偵測時段，`end` 早於 `start` 表示跨夜 |
| `fence.enter_seconds` | 進入圍籬區域超過幾秒觸發（未選電子圍籬時為 `null`） |
| `crowd.people` / `crowd.enter_seconds` | 幾人以上、持續幾秒視為群聚（未選群聚時為 `null`） |
| `equipment` | 要偵測的裝備 id（未選裝備偵測時為 `[]`） |

舊版資料會在伺服器啟動時自動補齊：多選 `functions` 轉成 `function`；沒有 `scope` 的專案，有框選區域視為 `region`，否則視為 `global`。

## 轉成 DataFrame

[project_data.py](project_data.py) 把 `data/projects/*.json` 讀成 pandas DataFrame：

```python
from project_data import load_projects_df, load_regions_df

projects = load_projects_df()   # 一個專案一列
regions = load_regions_df()     # 一個框選區域一列，points 為 [[x, y], ...]

fences = projects[projects.function == "fence"]
for r in regions.itertuples():
    print(r.project_name, r.region_name, r.points)
```

| DataFrame | 欄位 |
|---|---|
| `load_projects_df()` | `id`、`project_name`、`rtsp`、`function`、`function_name`、`scope`、`scope_name`、`region_count`、`regions`、`detection_start`、`detection_end`、`fence_enter_seconds`、`crowd_people`、`crowd_enter_seconds`、`equipment`、`equipment_names`、`image_path`、`created_at`、`updated_at` |
| `load_regions_df()` | `project_id`、`project_name`、`rtsp`、`function`、`scope`、`region_index`、`region_name`、`point_count`、`points` |

沒選到的功能參數為 `<NA>`。也可以直接執行：`python project_data.py` 預覽，`python project_data.py --csv` 另存成 `data/projects.csv`、`data/regions.csv`（Excel 可直接開，list 欄位存成 JSON 字串）。

## 裝備清單與圖片

裝備清單在 `main.py` 的 `EQUIPMENT_OPTIONS`（目前為安全帽 `helmet`、反光背心 `vest`、口罩 `mask`、手套 `gloves`），增減項目改那裡即可。

每項裝備的圖片放在 `static/equipment/`，檔名用裝備 id：

| 檔案 | 說明 |
|---|---|
| `helmet.svg` 等 | 內建預設圖示 |
| `helmet.png` / `.jpg` / `.jpeg` / `.webp` | 自己的照片，放進來就會**優先**取代預設圖示，重新整理網頁即生效 |

建議用正方形圖片；沒有圖片時會顯示名稱首字。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/options` | 功能與裝備選項 |
| POST | `/api/snapshot` | `{"rtsp": "rtsp://..."}` → 回傳 960×540 JPEG（標頭 `X-Source-Width/Height` 為原始尺寸） |
| GET | `/api/projects` | 專案列表 |
| GET | `/api/projects/{id}` | 單一專案 |
| POST | `/api/projects` | 新增（multipart：`data` = JSON 字串、`image` = 圖片，可省略） |
| PUT | `/api/projects/{id}` | 更新（同上，未附圖片則保留原圖） |
| DELETE | `/api/projects/{id}` | 刪除專案與圖片 |
