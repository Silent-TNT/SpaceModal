"""Build the ten-case static defense demo from an explicit allowlist."""
from pathlib import Path
import json
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from plan_review.store import load_draft, case_images

IDS = (2107, 2108, 2110, 2111, 2115, 2125, 2126, 2128, 2135, 2142)
TARGET = ROOT / "website" / "dataset-studio"


def build():
    assets = TARGET / "assets"
    samples = TARGET / "cases"
    assets.mkdir(parents=True, exist_ok=True)
    samples.mkdir(exist_ok=True)
    source = ROOT / "plan_review" / "static"
    html = (source / "index.html").read_text(encoding="utf-8")
    html = html.replace('/static/style.css?v=21', './assets/style.css?v=1')
    html = html.replace('/static/app.js?v=21', './assets/app.js?v=1')
    html = html.replace('<title>SpaceModal · 平面图工作台</title>', '<title>数据集制作演示 · SpaceModal</title>')
    html = html.replace('<strong>SpaceModal</strong>', '<strong><a href="../" style="color:inherit;text-decoration:none">SpaceModal</a></strong>')
    html = html.replace('空间模态 · 平面图转数据', '中期演示 · 平面图转数据')
    html = html.replace('<span id="cloud-state"', '<button id="upload-plans-btn" class="button ghost">上传两层图纸</button><span id="cloud-state"')
    html = html.replace('id="vision-provider"', 'id="vision-provider" hidden')
    html = html.replace('<label class="inline-field"><input id="show-grid"', '<label class="inline-field"><input id="demo-show-rooms" type="checkbox" checked>体块标注</label><label class="inline-field"><input id="show-grid"')
    html = html.replace('视觉识别候选</button>', '载入预置标注</button>')
    html = html.replace('确认入库</button>', '导出几何 JSON</button>')
    html = html.replace('打开最新版</button>', '打开已保存版</button>')
    html = html.replace('保存草稿</button>', '保存到浏览器</button>')
    html = html.replace('<option value="new">未处理 · 531 套</option>', '<option value="all">全部案例</option>')
    html = html.replace('人工数据 · 468 套', '预置示例')
    html = html.replace('<option value="all">全部</option>', '')
    html = html.replace('已确认</option>', '已导出</option>')
    html = html.replace('先选择左侧项目。', '10 套内置示例 · 本地上传与修改保存在此浏览器 · 预置标注不代表在线识别')
    html = html.replace('<button id="wall-review-btn"', '<button hidden id="wall-review-btn"')
    html = html.replace('墙体与开放分界</h2>', '演示说明</h2>')
    html = html.replace('逐条核对实体墙、门洞与墙端延伸。标注单独保存，用于改进识别。', '内置图纸配有预先制备的体块。上传图纸在当前浏览器手动标注，不上传至服务器；清理浏览器数据会删除本地进度。')
    html = html.replace('<script src="./assets/app.js', '<script src="./assets/demo.js?v=1"></script>\n  <script src="./assets/app.js')
    html = html.replace('</body>', '''<dialog id="upload-dialog" class="upload-dialog">
      <form id="upload-form"><h2>上传两层图纸</h2>
      <p>图片仅保存在当前浏览器。选择楼层并填写尺寸后，开始手动划分体块。</p>
      <label>案例名称<input name="name" maxlength="60" required value="本地图纸"></label>
      <label>一层图片<input name="floor1" type="file" accept="image/png,image/jpeg,image/webp" required></label>
      <label>二层图片<input name="floor2" type="file" accept="image/png,image/jpeg,image/webp" required></label>
      <div class="upload-sizes"><label>建筑宽度（mm）<input name="width" type="number" min="300" max="60000" step="300" value="18000" required></label>
      <label>建筑进深（mm）<input name="depth" type="number" min="300" max="60000" step="300" value="12000" required></label></div>
      <p>尺寸是标注尺度，请按图纸填写；上传后用“校准图纸”框选建筑范围。</p>
      <p id="upload-error" role="alert"></p><div class="button-row"><button type="button" id="upload-cancel" class="button ghost">取消</button><button type="submit" class="button primary">开始标注</button></div>
      </form></dialog></body>''')
    (TARGET / "index.html").write_text(html, encoding="utf-8")
    js = (source / "app.js").read_text(encoding="utf-8")
    js = js.replace('async function api(path, options={}) {', 'async function api(path, options={}) {\n  return window.REVIEW_DEMO.request(path, options);\n  /* Backend branch retained for source parity. */')
    js = js.replace('function updateVisionStatus(){', 'function updateVisionStatus(){\n  window.REVIEW_DEMO.updateStatus();return;')
    js = js.replace('const rooms=state.draft.rooms.filter((r)=>', 'const rooms=(document.getElementById("demo-show-rooms").checked?state.draft.rooms:[]).filter((r)=>')
    js = js.replace("manual_existing:'人工数据'", "manual_existing:'预置示例'")
    js = js.replace('installEvents();', 'installEvents();\n  window.REVIEW_DEMO.install();', 1)
    js = js.replace('服务器', '浏览器').replace('入库', '导出').replace('已确认', '已导出')
    js = js.replace('视觉识别将替换当前候选体块。建议先保存草稿。继续吗？', '载入预置标注会替换当前体块。建议先保存草稿。继续吗？')
    js = js.replace('视觉模型正在分析两层图纸，通常需要一段时间…', '正在载入预先制备的示例标注…')
    js = js.replace('视觉候选已生成：', '预置标注已载入：')
    js = js.replace("approved:'已导出'", "approved:'已导出'")
    (assets / "app.js").write_text(js, encoding="utf-8")
    css = (source / "style.css").read_text(encoding="utf-8")
    css += '''\n.upload-dialog{width:min(520px,92vw);border:1px solid var(--line);padding:24px;background:var(--paper);color:var(--ink)}.upload-dialog::backdrop{background:#24271f88}.upload-dialog h2{margin-top:0}.upload-dialog p{font-size:12px;line-height:1.6;color:var(--muted)}.upload-dialog label{display:block;font-size:12px;margin:12px 0}.upload-dialog input{display:block;width:100%;margin-top:6px;padding:8px;border:1px solid var(--line);background:var(--white);color:var(--ink)}.upload-sizes{display:grid;grid-template-columns:1fr 1fr;gap:14px}#upload-error{color:#b33}#vision-provider[hidden],#wall-review-btn[hidden]{display:none!important}\n'''
    (assets / "style.css").write_text(css, encoding="utf-8")
    shutil.copy2(ROOT / "website" / "scripts" / "dataset-demo-adapter.js", assets / "demo.js")
    manifest = []
    for ordinal, case_id in enumerate(IDS, 1):
        draft = load_draft(case_id)
        folder = samples / str(case_id)
        folder.mkdir(exist_ok=True)
        image_paths = {p.name: p for p in case_images(case_id)}
        floors = []
        for floor in draft["floors"]:
            filename = f"floor-{floor['floor']}.jpg"
            shutil.copy2(image_paths[floor["image_name"]], folder / filename)
            public_floor = {k: floor[k] for k in ("floor", "image_size", "bounds_px", "boundary")}
            public_floor.update(image_name=filename, image_url=f"cases/{case_id}/{filename}")
            floors.append(public_floor)
        public = {
            "schema_version": "review_draft_v1", "case_id": case_id, "house_id": f"house_{case_id}",
            "case_name": f"示例 {ordinal:02d} · ID{case_id}", "source": "demo_prepared", "status": "draft", "revision": 0,
            "scale_source": draft["scale_source"], "building_size": draft["building_size"],
            "north_rotation_quadrants": draft.get("north_rotation_quadrants", 0), "floors": floors,
            "rooms": [{k: r[k] for k in ("id", "type", "floor", "box_min", "box_max")} for r in draft["rooms"]],
            "axes": draft["axes"], "guides": [],
        }
        (folder / "draft.json").write_text(json.dumps(public, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        manifest.append({"id": case_id, "name": public["case_name"], "status": "manual_existing", "builtin": True})
    (TARGET / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    print(f"Built {len(IDS)} cases, {len(IDS)*2} images: {TARGET}")


if __name__ == "__main__":
    build()
