# NO_CODE 偵測設定平台

輸入 RTSP 擷取攝影機畫面 → 框選不規則區域 → 設定偵測功能，存成 JSON 給後端偵測程式使用。

## 啟動

```bash
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8010
```

或直接執行 `run.bat`，然後開啟 http://127.0.0.1:8010 。
API 文件：http://127.0.0.1:8010/docs

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
