"""NO_CODE 偵測設定平台 — FastAPI 後端

啟動方式：
    uvicorn main:app --reload --port 8000
"""

import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote

# RTSP 走 TCP 較不易因防火牆/NAT 掉封包而花屏，須在 import cv2 前設定
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
try:
    import cv2
except ImportError:
    cv2 = None

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
PROJECT_DIR = DATA_DIR / "projects"
IMAGE_DIR = DATA_DIR / "images"
PROJECT_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)

FRAME_WIDTH = 960
FRAME_HEIGHT = 540
MAX_IMAGE_BYTES = 10 * 1024 * 1024
RTSP_TIMEOUT_MS = 8000
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}

FUNCTIONS = {
    "fence": "電子圍籬",
    "crowd": "群聚",
    "fall": "偵測昏倒",
    "equipment": "裝備偵測",
}

# 可偵測的裝備清單，要增減項目改這裡即可
# 圖片放在 static/equipment/{id}.png|jpg|jpeg|webp|svg，照片優先於預設的 .svg 圖示
EQUIPMENT_OPTIONS = [
    {"id": "helmet", "name": "安全帽"},
    {"id": "vest", "name": "反光背心"},
    {"id": "mask", "name": "口罩"},
    {"id": "gloves", "name": "手套"},
]
EQUIPMENT_IDS = {e["id"] for e in EQUIPMENT_OPTIONS}
EQUIPMENT_IMAGE_DIR = STATIC_DIR / "equipment"
EQUIPMENT_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".svg")

FULL_FRAME = [(0, 0), (FRAME_WIDTH, 0), (FRAME_WIDTH, FRAME_HEIGHT), (0, FRAME_HEIGHT)]
GLOBAL_REGION_NAME = "全域"

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ID_RE = re.compile(r"^[0-9a-f]{12}$")


# ---------- 資料模型 ----------

def check_rtsp(v: str) -> str:
    v = v.strip()
    if not v.lower().startswith(("rtsp://", "rtsps://")):
        raise ValueError("RTSP 網址須以 rtsp:// 或 rtsps:// 開頭")
    return v


class Region(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    points: list[tuple[int, int]] = Field(min_length=3)

    @field_validator("points")
    @classmethod
    def points_in_frame(cls, v):
        for x, y in v:
            if not (0 <= x <= FRAME_WIDTH and 0 <= y <= FRAME_HEIGHT):
                raise ValueError(f"座標 ({x}, {y}) 超出 {FRAME_WIDTH}x{FRAME_HEIGHT} 範圍")
        return v


class DetectionTime(BaseModel):
    start: str = "00:00"
    end: str = "23:59"

    @field_validator("start", "end")
    @classmethod
    def valid_time(cls, v):
        if not TIME_RE.match(v):
            raise ValueError("時間格式須為 HH:MM")
        return v


class FenceConfig(BaseModel):
    enter_seconds: int = Field(ge=0, le=86400, description="進入圍籬幾秒後觸發")


class CrowdConfig(BaseModel):
    people: int = Field(ge=2, le=1000, description="幾人以上視為群聚")
    enter_seconds: int = Field(ge=0, le=86400, description="群聚持續幾秒後觸發")


class ProjectIn(BaseModel):
    project_name: str = Field(min_length=1, max_length=100)
    rtsp: str = Field(min_length=1, max_length=500)
    function: Literal["fence", "crowd", "fall", "equipment"]
    scope: Literal["global", "region"]  # 全域：整張畫面；區域：使用框選的多邊形
    regions: list[Region] = []
    detection_time: DetectionTime = DetectionTime()
    fence: Optional[FenceConfig] = None
    crowd: Optional[CrowdConfig] = None
    equipment: list[str] = []

    @field_validator("project_name", "rtsp")
    @classmethod
    def strip(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("不可為空白")
        return v

    @field_validator("rtsp")
    @classmethod
    def valid_rtsp(cls, v):
        return check_rtsp(v)

    @field_validator("equipment")
    @classmethod
    def valid_equipment(cls, v):
        unknown = [e for e in v if e not in EQUIPMENT_IDS]
        if unknown:
            raise ValueError(f"未知的裝備：{', '.join(unknown)}")
        return list(dict.fromkeys(v))

    @model_validator(mode="after")
    def check_function_params(self):
        if self.scope == "global":
            self.regions = [Region(name=GLOBAL_REGION_NAME, points=FULL_FRAME)]
        elif not self.regions:
            raise ValueError("偵測範圍為區域時，至少需要框選一個區域")

        func = self.function
        if func == "fence" and self.fence is None:
            raise ValueError("已選電子圍籬，請填寫進入時間")
        if func == "crowd" and self.crowd is None:
            raise ValueError("已選群聚，請填寫人數與進入時間")
        if func == "equipment" and not self.equipment:
            raise ValueError("已選裝備偵測，請至少選擇一項裝備")
        # 未選的功能不保留其參數，避免存出無效資料
        if func != "fence":
            self.fence = None
        if func != "crowd":
            self.crowd = None
        if func != "equipment":
            self.equipment = []
        return self


class SnapshotIn(BaseModel):
    rtsp: str = Field(min_length=1, max_length=500)

    @field_validator("rtsp")
    @classmethod
    def valid_rtsp(cls, v):
        return check_rtsp(v)


# ---------- RTSP 擷取 ----------

def grab_frame(url: str):
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, RTSP_TIMEOUT_MS,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, RTSP_TIMEOUT_MS,
    ])
    try:
        if not cap.isOpened():
            raise HTTPException(502, "無法連線到 RTSP，請確認網址、帳號密碼與網路是否正確")
        # 剛連上時可能要等到關鍵影格才解得出畫面，多讀幾次
        for _ in range(10):
            ok, frame = cap.read()
            if ok and frame is not None:
                return frame
        raise HTTPException(502, "已連上 RTSP，但讀不到畫面")
    finally:
        cap.release()


# ---------- 儲存 ----------

def project_path(project_id: str) -> Path:
    if not ID_RE.match(project_id):
        raise HTTPException(404, "找不到專案")
    return PROJECT_DIR / f"{project_id}.json"


def load_project(project_id: str) -> dict:
    path = project_path(project_id)
    if not path.exists():
        raise HTTPException(404, "找不到專案")
    return json.loads(path.read_text(encoding="utf-8"))


def write_project(project: dict) -> None:
    path = project_path(project["id"])
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def migrate_projects() -> None:
    """補齊舊版資料：多選 functions 轉成單選 function；沒有 scope 時依是否有框選區域判斷。"""
    for path in PROJECT_DIR.glob("*.json"):
        project = json.loads(path.read_text(encoding="utf-8"))
        changed = False
        if "functions" in project:
            funcs = project.pop("functions")
            project.setdefault("function", funcs[0] if funcs else None)
            changed = True
        if "scope" not in project:
            project["scope"] = "region" if project.get("regions") else "global"
            if project["scope"] == "global":
                project["regions"] = [{"name": GLOBAL_REGION_NAME, "points": [list(p) for p in FULL_FRAME]}]
            changed = True
        if changed:
            write_project(project)


migrate_projects()


def parse_payload(data: str) -> ProjectIn:
    try:
        return ProjectIn.model_validate_json(data)
    except ValidationError as e:
        messages = []
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"])
            msg = err["msg"].removeprefix("Value error, ")
            messages.append(f"{loc}: {msg}" if loc else msg)
        raise HTTPException(422, "；".join(messages))


async def save_image(project_id: str, image: UploadFile) -> str:
    ext = IMAGE_TYPES.get(image.content_type or "")
    if ext is None:
        raise HTTPException(415, "只接受 JPEG 或 PNG 圖片")
    content = await image.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "圖片超過 10MB")
    for old in IMAGE_DIR.glob(f"{project_id}.*"):
        old.unlink()
    filename = f"{project_id}{ext}"
    (IMAGE_DIR / filename).write_bytes(content)
    return filename


def equipment_images() -> dict[str, str]:
    """裝備 id → 圖片網址；照片優先於預設 .svg。
    檔名比對不分大小寫：Windows 本來就不分，Linux 有分，統一後 Helmet.PNG 在兩邊都找得到。"""
    files = {p.name.lower(): p for p in EQUIPMENT_IMAGE_DIR.glob("*") if p.is_file()}
    images = {}
    for e in EQUIPMENT_OPTIONS:
        for ext in EQUIPMENT_IMAGE_EXTS:
            path = files.get(e["id"] + ext)
            if path:
                # 帶修改時間避免瀏覽器快取到舊圖
                images[e["id"]] = f"/static/equipment/{quote(path.name)}?v={int(path.stat().st_mtime)}"
                break
    return images


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------- API ----------

app = FastAPI(title="NO_CODE 偵測設定平台")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/images", StaticFiles(directory=IMAGE_DIR), name="images")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/options")
def options():
    images = equipment_images()
    return {
        "frame": {"width": FRAME_WIDTH, "height": FRAME_HEIGHT},
        "functions": [{"id": k, "name": v} for k, v in FUNCTIONS.items()],
        "equipment": [{**e, "image": images.get(e["id"])} for e in EQUIPMENT_OPTIONS],
    }


@app.post("/api/snapshot")
def snapshot(body: SnapshotIn):
    """用 OpenCV 從 RTSP 擷取一張畫面，縮放成 960x540 後回傳 JPEG。"""
    if cv2 is None:
        raise HTTPException(500, "伺服器未安裝 OpenCV，請執行 pip install opencv-python-headless")
    frame = grab_frame(body.rtsp)
    src_h, src_w = frame.shape[:2]
    frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise HTTPException(500, "畫面編碼失敗")
    return Response(buf.tobytes(), media_type="image/jpeg", headers={
        "X-Source-Width": str(src_w),
        "X-Source-Height": str(src_h),
        "Cache-Control": "no-store",
    })


@app.get("/api/projects")
def list_projects():
    projects = [json.loads(p.read_text(encoding="utf-8")) for p in PROJECT_DIR.glob("*.json")]
    projects.sort(key=lambda p: p["updated_at"], reverse=True)
    return projects


@app.get("/api/projects/{project_id}")
def get_project(project_id: str):
    return load_project(project_id)


@app.post("/api/projects", status_code=201)
async def create_project(data: str = Form(...), image: Optional[UploadFile] = File(None)):
    payload = parse_payload(data)
    project_id = uuid.uuid4().hex[:12]
    project = {
        "id": project_id,
        **payload.model_dump(),
        "image": await save_image(project_id, image) if image else None,
        "image_size": [FRAME_WIDTH, FRAME_HEIGHT],
        "created_at": now(),
        "updated_at": now(),
    }
    write_project(project)
    return project


@app.put("/api/projects/{project_id}")
async def update_project(project_id: str, data: str = Form(...), image: Optional[UploadFile] = File(None)):
    existing = load_project(project_id)
    payload = parse_payload(data)
    project = {
        **existing,
        **payload.model_dump(),
        "updated_at": now(),
    }
    if image:
        project["image"] = await save_image(project_id, image)
    write_project(project)
    return project


@app.delete("/api/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    path = project_path(project_id)
    if not path.exists():
        raise HTTPException(404, "找不到專案")
    path.unlink()
    for img in IMAGE_DIR.glob(f"{project_id}.*"):
        img.unlink()
