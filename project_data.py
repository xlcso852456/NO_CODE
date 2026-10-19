"""把網頁存出的專案資料（data/projects/*.json）轉成 pandas DataFrame。

在其他程式中使用：
    from project_data import load_projects_df, load_regions_df
    projects = load_projects_df()   # 一個專案一列
    regions = load_regions_df()     # 一個框選區域一列（座標展開）

直接執行可預覽，加 --csv 另存成 CSV（存到 data/，Excel 可直接開）：
    python project_data.py
    python project_data.py --csv
"""

import argparse
import json
from pathlib import Path
from typing import Optional

import pandas as pd

from main import DATA_DIR, EQUIPMENT_OPTIONS, FUNCTIONS, IMAGE_DIR, PROJECT_DIR

SCOPES = {"global": "全域", "region": "區域"}
EQUIPMENT_NAMES = {e["id"]: e["name"] for e in EQUIPMENT_OPTIONS}

PROJECT_COLUMNS = [
    "id", "project_name", "rtsp",
    "function", "function_name", "scope", "scope_name",
    "region_count", "regions",
    "detection_start", "detection_end",
    "fence_enter_seconds", "crowd_people", "crowd_enter_seconds",
    "equipment", "equipment_names",
    "image_path", "created_at", "updated_at",
]
REGION_COLUMNS = [
    "project_id", "project_name", "rtsp", "function", "scope",
    "region_index", "region_name", "point_count", "points",
]
LIST_COLUMNS = {"regions", "equipment", "equipment_names", "points"}


def _project_row(p: dict) -> dict:
    fence = p.get("fence") or {}
    crowd = p.get("crowd") or {}
    equipment = p.get("equipment") or []
    regions = p.get("regions") or []
    return {
        "id": p["id"],
        "project_name": p["project_name"],
        "rtsp": p["rtsp"],
        "function": p.get("function"),
        "function_name": FUNCTIONS.get(p.get("function")),
        "scope": p.get("scope"),
        "scope_name": SCOPES.get(p.get("scope")),
        "region_count": len(regions),
        "regions": regions,
        "detection_start": p["detection_time"]["start"],
        "detection_end": p["detection_time"]["end"],
        "fence_enter_seconds": fence.get("enter_seconds"),
        "crowd_people": crowd.get("people"),
        "crowd_enter_seconds": crowd.get("enter_seconds"),
        "equipment": equipment,
        "equipment_names": [EQUIPMENT_NAMES.get(e, e) for e in equipment],
        "image_path": str(IMAGE_DIR / p["image"]) if p.get("image") else None,
        "created_at": p.get("created_at"),
        "updated_at": p.get("updated_at"),
    }


def load_projects_df(project_dir: Path = PROJECT_DIR) -> pd.DataFrame:
    """一個專案一列，依更新時間新到舊排序；regions、equipment 欄位為 list。"""
    rows = [
        _project_row(json.loads(path.read_text(encoding="utf-8")))
        for path in sorted(Path(project_dir).glob("*.json"))
    ]
    df = pd.DataFrame(rows, columns=PROJECT_COLUMNS)
    # 沒選該功能的參數為 <NA>，用可為空的整數型別避免變成浮點數
    int_cols = ["region_count", "fence_enter_seconds", "crowd_people", "crowd_enter_seconds"]
    df[int_cols] = df[int_cols].astype("Int64")
    for col in ("created_at", "updated_at"):
        df[col] = pd.to_datetime(df[col])
    return df.sort_values("updated_at", ascending=False, ignore_index=True)


def load_regions_df(projects: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """一個框選區域一列；points 為 [[x, y], ...]（960x540 座標），全域專案為整張畫面。"""
    if projects is None:
        projects = load_projects_df()
    rows = [
        {
            "project_id": p.id,
            "project_name": p.project_name,
            "rtsp": p.rtsp,
            "function": p.function,
            "scope": p.scope,
            "region_index": i,
            "region_name": r["name"],
            "point_count": len(r["points"]),
            "points": r["points"],
        }
        for p in projects.itertuples(index=False)
        for i, r in enumerate(p.regions, start=1)
    ]
    df = pd.DataFrame(rows, columns=REGION_COLUMNS)
    df[["region_index", "point_count"]] = df[["region_index", "point_count"]].astype("Int64")
    return df


def to_csv(df: pd.DataFrame, path: Path) -> None:
    """list 欄位轉成 JSON 字串再存，讀回來可用 json.loads 還原；utf-8-sig 讓 Excel 正確顯示中文。"""
    out = df.copy()
    for col in LIST_COLUMNS & set(out.columns):
        out[col] = out[col].map(lambda v: json.dumps(v, ensure_ascii=False))
    out.to_csv(path, index=False, encoding="utf-8-sig")


def main() -> None:
    parser = argparse.ArgumentParser(description="把專案資料轉成 DataFrame")
    parser.add_argument("--csv", action="store_true", help="另存成 data/projects.csv 與 data/regions.csv")
    args = parser.parse_args()

    projects = load_projects_df()
    regions = load_regions_df(projects)

    pd.set_option("display.width", 220)
    pd.set_option("display.max_columns", None)
    pd.set_option("display.max_colwidth", 60)
    print(f"專案 {len(projects)} 筆")
    print(projects.drop(columns="regions").to_string() if len(projects) else "（沒有資料）")
    print(f"\n區域 {len(regions)} 筆")
    print(regions.to_string() if len(regions) else "（沒有資料）")

    if args.csv:
        to_csv(projects, DATA_DIR / "projects.csv")
        to_csv(regions, DATA_DIR / "regions.csv")
        print(f"\n已存成 {DATA_DIR / 'projects.csv'} 與 {DATA_DIR / 'regions.csv'}")


if __name__ == "__main__":
    main()
