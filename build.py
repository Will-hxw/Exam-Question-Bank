#!/usr/bin/env python3
"""
一键构建部署文件
用法: python build.py            → 输出 index.html + sw.js + 哈希静态资源（部署）
"""
import hashlib, json, os, gzip, re, sys, shutil
from io import BytesIO

LOCAL = "--local" in sys.argv
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "tmp")
os.makedirs(OUT, exist_ok=True)
_VERSION_MANUAL = "v0.1"  # 手动前缀，构建时自动拼接内容哈希
VERSION_STR = "（正式" + _VERSION_MANUAL + "）"  # 临时值，哈希计算完成后重新赋值

# ── 读取源数据 ──────────────────────────────────────
with open(os.path.join(ROOT, "data", "questions.json"), "r", encoding="utf-8") as f:
    questions_raw = json.load(f)

# ── 收集来源 ────────────────────────────────────────
sources = []
seen = {}
for q in questions_raw:
    src = q.get("source", "")
    if src and src not in seen:
        seen[src] = len(sources)
        sources.append(src)
if "" not in seen:
    seen[""] = len(sources)
    sources.append("")

# ── 转换为紧凑数组 ──────────────────────────────────
rows = []
skipped = 0
for q in questions_raw:
    qtype = 0 if q.get("type") == "single" else 1
    src_idx = seen.get(q.get("source", ""), seen.get("", 0))
    opt_keys = {opt["key"] for opt in q.get("options", [])}
    valid_answer = [a for a in q.get("answer", []) if a in opt_keys]
    if not valid_answer:
        print(f"  SKIP: {q.get('question', '?')[:40]}")
        skipped += 1
        continue
    answer_str = "".join(valid_answer)
    option_texts = [opt["text"] for opt in q["options"]]
    tag_val = (q.get("tags") or [""])[0]
    rows.append([qtype, q["question"], tag_val] + option_texts + [answer_str, src_idx])

# ── 输出紧凑 JSON（Worker fetch 用）─────────────────
obj = {"s": sources, "q": rows}
compact_json = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
bank_hash = hashlib.sha256(compact_json.encode("utf-8")).hexdigest()[:10]
bank_filename = f"questions-compact.{bank_hash}.json"

for name in os.listdir(OUT):
    if re.fullmatch(r"questions-compact\.[0-9a-f]{10}\.json", name):
        os.remove(os.path.join(OUT, name))

# 先写哈希文件再写 compact.json：构建中断时 compact.json 仍为旧版，更安全
with open(os.path.join(OUT, bank_filename), "w", encoding="utf-8", newline="\n") as f:
    f.write(compact_json)
with open(os.path.join(OUT, "questions-compact.json"), "w", encoding="utf-8", newline="\n") as f:
    f.write(compact_json)

if LOCAL:
    escaped = compact_json.replace("\\", "\\\\").replace("'", "\\'")
    with open(os.path.join(OUT, "questions.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"const _D='{escaped}';")

# ── 预加载：每个专题取前5题，保证任意专题打开都有题 ──
_topic_cnt = {}
preload_rows = []
preload_idxs = []  # 记录原始位置，用于前端修正 ID
for _i, _r in enumerate(rows):
    _tag = _r[2]
    _n = _topic_cnt.get(_tag, 0)
    if _n < 5:
        preload_rows.append(_r)
        preload_idxs.append(_i)
        _topic_cnt[_tag] = _n + 1
preload_obj = {"s": sources, "q": preload_rows, "t": len(rows), "_idx": preload_idxs}
preload_json = json.dumps(preload_obj, ensure_ascii=False, separators=(",", ":"))
preload_js = f"<script>window.__PRELOAD={preload_json};</script>"

# ── 读取各类资源 ────────────────────────────────────
with open(os.path.join(ROOT, "assets", "icon.jpg"), "rb") as f:
    source_icon_bytes = f.read()
source_icon_hash = hashlib.sha256(source_icon_bytes).hexdigest()[:10]

def load_existing_small_icon():
    assets_dir = os.path.join(ROOT, "assets")
    search_dirs = [ROOT, assets_dir, OUT]
    for d in search_dirs:
        try:
            for name in os.listdir(d):
                if not re.fullmatch(r"icon\.[0-9a-f]{10}\.jpg", name):
                    continue
                path = os.path.join(d, name)
                with open(path, "rb") as f:
                    data = f.read()
                if len(data) < len(source_icon_bytes) and hashlib.sha256(data).hexdigest()[:10] != source_icon_hash:
                    return data
        except OSError:
            continue
    return None

try:
    from PIL import Image

    with Image.open(BytesIO(source_icon_bytes)) as icon_image:
        icon_image = icon_image.convert("RGB")
        icon_image.thumbnail((64, 64), Image.Resampling.LANCZOS)
        out = BytesIO()
        icon_image.save(out, format="JPEG", quality=82, optimize=True)
        icon_bytes = out.getvalue()
except Exception as e:
    existing_icon_bytes = load_existing_small_icon()
    if existing_icon_bytes:
        print(f"WARNING: icon resize failed, reusing existing optimized icon: {e}", file=sys.stderr)
        icon_bytes = existing_icon_bytes
    else:
        raise RuntimeError("icon resize failed and no optimized icon is available; install Pillow with: python -m pip install Pillow") from e

icon_hash = hashlib.sha256(icon_bytes).hexdigest()[:10]
icon_filename = f"icon.{icon_hash}.jpg"
for name in os.listdir(OUT):
    if re.fullmatch(r"icon\.[0-9a-f]{10}\.jpg", name):
        os.remove(os.path.join(OUT, name))
with open(os.path.join(OUT, icon_filename), "wb") as f:
    f.write(icon_bytes)

with open(os.path.join(ROOT, "src", "storage.js"), "r", encoding="utf-8") as f:
    storage_js = f.read().replace("\r\n", "\n").replace("\r", "\n")
with open(os.path.join(ROOT, "src", "app.js"), "r", encoding="utf-8") as f:
    app_js = f.read().replace("\r\n", "\n").replace("\r", "\n")
with open(os.path.join(ROOT, "src", "ai.js"), "r", encoding="utf-8") as f:
    ai_js = f.read()

def write_hashed(name, content):
    h = hashlib.sha256(content.encode("utf-8")).hexdigest()[:10]
    fn = f"{name}.{h}.js"
    for old in os.listdir(OUT):
        if re.fullmatch(rf"{name}\.[0-9a-f]{{10}}\.js", old):
            os.remove(os.path.join(OUT, old))
    with open(os.path.join(OUT, fn), "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return fn

ai_filename = write_hashed("ai", ai_js)

# ── 自动版本号：内容哈希确保任何源文件变更都触发更新通知 ──
_version_hash = hashlib.sha256((bank_hash + ai_js + app_js + storage_js).encode()).hexdigest()[:6]
VERSION_STR = f"（正式{_VERSION_MANUAL}.{_version_hash}）"
DISPLAY_VERSION = f"（正式{_VERSION_MANUAL}）"  # 前端展示用，不含哈希

# ── CSS ────────────────────────────────────────────
CSS = """*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
:root {
  --bg: #fafbfc; --surface: #ffffff; --text: #1a1a2e; --text-secondary: #6b7280;
  --text-muted: #9ca3af; --accent: #4f46e5; --accent-light: #eef2ff;
  --success: #059669; --success-bg: #ecfdf5; --danger: #dc2626; --danger-bg: #fef2f2;
  --border: #e5e7eb; --border-light: #f3f4f6;
  --warning: #d97706; --warning-bg: #fffbeb;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);
  --radius: 10px; --radius-sm: 6px;
}
html { overflow-y: scroll; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.7;
  max-width: 720px; margin: 0 auto; padding: 0 20px; -webkit-font-smoothing: antialiased;
  min-height: 100vh; display: flex; flex-direction: column;
}
#app { flex: 1; }
#site-header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 24px 0 16px; }
.site-icon { width: 32px; height: 32px; border-radius: 8px; object-fit: cover; box-shadow: var(--shadow-sm); }
.site-title { font-size: 15px; font-weight: 500; color: var(--accent); letter-spacing: 0.3px; text-align: center; text-decoration: none; transition: opacity 0.2s; }
.site-title-text { color: var(--text); }
.site-title:hover { text-decoration: underline; opacity: 0.85; }
.site-header-right { display: flex; align-items: center; gap: 8px; justify-self: end; }
.dark-toggle { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; padding: 0; -webkit-tap-highlight-color: transparent; outline: none; color: var(--text-muted); transition: color 0.25s; }
.dark-toggle:hover { color: var(--text); }
[data-theme="dark"] .dark-toggle { color: #e5e7eb; }
.site-badge { font-size: 11px; padding: 3px 10px; border-radius: 100px; background: var(--warning-bg); color: var(--warning); font-weight: 500; letter-spacing: 0.3px; white-space: nowrap; }
#top-nav {
  display: flex; gap: 4px; position: sticky; top: 0; background: var(--bg); z-index: 10;
  padding: 6px; margin-bottom: 24px; border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow-sm); border: 1px solid var(--border-light);
}
#top-nav button {
  flex: 1; padding: 9px 6px; border: none; background: transparent;
  font-size: 13.5px; cursor: pointer; color: var(--text-secondary);
  border-radius: 7px; transition: all 0.2s ease; font-weight: 450;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
#top-nav button.active { color: var(--accent); background: var(--accent-light); font-weight: 550; }
button { cursor: pointer; font-family: inherit; touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
.question-card {
  padding: 24px 20px; background: var(--surface); border-radius: var(--radius);
  box-shadow: var(--shadow); border: 1px solid var(--border-light);
}
.q-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.q-type { font-size: 11px; padding: 3px 10px; border-radius: 100px; font-weight: 550; }
.q-type.single  { background: #eef2ff; color: #4f46e5; }
.q-type.multiple { background: #fef3c7; color: #b45309; }
.done-badge { font-size: 10px; padding: 2px 8px; border-radius: 12px; background: var(--success-bg); color: var(--success); font-weight: 500; letter-spacing: 0.3px; white-space: nowrap; }
.q-text { font-size: 15.5px; margin-bottom: 18px; line-height: 1.8; color: var(--text); }
.option {
  display: block; width: 100%; text-align: left; padding: 12px 15px; margin-bottom: 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface);
  font-size: 14px; line-height: 1.6; cursor: pointer; transition: border-color 0.15s, background 0.15s; color: var(--text);
}
.option.selected { border-color: var(--accent); background: var(--accent-light); color: var(--accent); font-weight: 500; }
.option.correct { border-color: var(--success); background: var(--success-bg); color: var(--success); }
.option.wrong { border-color: var(--danger); background: var(--danger-bg); color: var(--danger); }
.option:disabled { cursor: default; opacity: 0.82; }
.action-bar { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.btn {
  padding: 9px 18px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; background: var(--surface); color: var(--text); transition: all 0.15s; font-weight: 450;
}
.btn:hover { background: var(--border-light); }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn:disabled { opacity: 0.35; cursor: default; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
.feedback { font-size: 14.5px; font-weight: 550; padding: 10px 0 4px; }
.feedback.correct { color: var(--success); } .feedback.wrong { color: var(--danger); }
.answer-reveal { font-size: 13px; color: var(--text-secondary); margin-top: 6px; }
.answer-reveal span { font-weight: 550; color: var(--text); }
.progress-info { font-size: 12px; color: var(--text-muted); }
.mode-bar { display: flex; align-items: center; gap: 6px; padding: 0 0 14px; }
.mode-label { font-size: 13px; color: var(--text-muted); margin-right: 2px; }
.mode-btn { font-size: 12.5px; padding: 5px 14px; border: 1px solid var(--border); border-radius: 100px; background: var(--surface); color: var(--text-secondary); cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
.mode-btn:hover { border-color: #c7d2fe; color: var(--accent); }
.mode-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 500; }
.topic-dropdown { position: relative; display: inline-block; }
.topic-dropdown-btn {
  display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; padding: 9px 16px;
  border: 1px solid var(--border); border-radius: 100px; background: var(--surface);
  color: var(--text); font-family: inherit; font-weight: 450; cursor: pointer;
  transition: all 0.15s ease; box-shadow: var(--shadow-sm);
  -webkit-tap-highlight-color: transparent; outline: none;
}
.topic-dropdown-btn:hover { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79,70,229,0.06); }
.topic-dropdown-btn:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
.topic-dropdown-arrow {
  display: block; width: 7px; height: 7px; border-right: 1.5px solid var(--text-muted);
  border-bottom: 1.5px solid var(--text-muted); transform: rotate(45deg); transition: transform 0.2s ease;
}
.topic-dropdown-panel {
  display: none; position: absolute; top: calc(100% + 6px); left: 0; min-width: 100%;
  background: rgba(255,255,255,0.96); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border-light); border-radius: var(--radius); box-shadow: 0 8px 30px rgba(0,0,0,0.08);
  padding: 6px; z-index: 20; max-height: 340px; overflow-y: auto;
}
.topic-dropdown-panel.open { display: block; }
.topic-dropdown-panel .topic-option {
  display: block; width: 100%; text-align: left; padding: 10px 14px; border: none; border-radius: 7px;
  background: transparent; color: var(--text); font-size: 13.5px; font-family: inherit; cursor: pointer;
  transition: background 0.1s ease; white-space: nowrap;
}
.topic-dropdown-panel .topic-option:hover { background: var(--accent-light); color: var(--accent); }
.topic-dropdown-panel .topic-option.active { background: var(--accent-light); color: var(--accent); font-weight: 550; }
.stats-bar { font-size: 13px; color: var(--text-muted); padding: 0 0 12px; display: flex; gap: 18px; flex-wrap: wrap; }
.search-box {
  width: 100%; padding: 11px 15px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 14px; margin-bottom: 14px; background: var(--surface); color: var(--text);
}
.search-box:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.08); }
.filter-bar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.filter-label { font-size: 12px; color: var(--text-muted); margin-right: 2px; white-space: nowrap; }
.filter-chip { font-size: 12px; padding: 4px 12px; border: 1px solid var(--border); border-radius: 100px; background: var(--surface); color: var(--text-secondary); cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
.filter-chip:hover { border-color: #c7d2fe; color: var(--accent); }
.filter-chip.active { background: var(--accent); color: #fff; border-color: var(--accent); font-weight: 500; }
.exam-start { text-align: center; padding: 60px 24px; background: var(--surface); border-radius: var(--radius); border: 1px solid var(--border-light); box-shadow: var(--shadow); }
.exam-start-icon { font-size: 48px; margin-bottom: 8px; line-height: 1; }
.exam-start h2 { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: var(--text); }
.exam-start-subtitle { color: var(--text-secondary); margin-bottom: 20px; font-size: 13.5px; }
.exam-info-chips { display: flex; justify-content: center; gap: 8px; margin-bottom: 28px; flex-wrap: wrap; }
.exam-info-chip { font-size: 13px; padding: 7px 16px; background: var(--accent-light); border-radius: 100px; color: var(--accent); font-weight: 500; display: inline-flex; align-items: center; gap: 4px; }
.chip-icon { font-size: 14px; }
.btn-start-exam { font-size: 15px; padding: 12px 40px; display: inline-flex; align-items: center; gap: 6px; }
.btn-arrow { transition: transform 0.2s ease; }
.btn-start-exam:hover .btn-arrow { transform: translateX(3px); }
.exam-header { position: sticky; top: 56px; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; background: rgba(255,255,255,0.92); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-radius: var(--radius-sm); border: 1px solid var(--border-light); margin-bottom: 16px; box-shadow: var(--shadow-md); }
.exam-header-left { flex: 1; min-width: 0; }
.exam-progress-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; }
.exam-progress-label { font-size: 11px; color: var(--text-muted); }
.exam-progress-count { font-size: 15px; font-weight: 650; color: var(--text); }
.exam-progress-total { font-size: 12px; font-weight: 400; color: var(--text-muted); }
.exam-progress-bar { width: 100%; height: 5px; background: var(--border-light); border-radius: 3px; overflow: hidden; }
.exam-progress-fill { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.35s ease; }
.exam-timer-wrap { flex-shrink: 0; text-align: center; }
.exam-timer { font-size: 22px; font-weight: 650; color: var(--text); font-variant-numeric: tabular-nums; letter-spacing: 1px; }
.exam-timer.running { color: var(--accent); }
.btn-submit-exam { background: var(--danger); color: #fff; border-color: var(--danger); font-weight: 500; font-size: 13px; padding: 8px 18px; flex-shrink: 0; }
.btn-submit-exam:hover { background: #b91c1c; border-color: #b91c1c; }
.exam-nav-label { font-size: 12px; color: var(--text-muted); margin-top: 18px; margin-bottom: 8px; }
.exam-nav { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; padding: 14px; background: var(--surface); border-radius: var(--radius-sm); border: 1px solid var(--border-light); box-shadow: var(--shadow-sm); }
.exam-nav-item { aspect-ratio: 1; font-size: 12px; border: 1.5px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text-secondary); cursor: pointer; transition: all 0.15s ease; font-family: inherit; display: flex; align-items: center; justify-content: center; font-weight: 450; }
.exam-nav-item:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); box-shadow: 0 2px 6px rgba(79,70,229,0.12); }
.exam-nav-item.current { border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 600; box-shadow: 0 2px 8px rgba(79,70,229,0.28); transform: translateY(-0.5px); }
.exam-nav-item.answered { border-color: var(--success); background: var(--success-bg); color: var(--success); font-weight: 550; }
.exam-nav-item.marked { border-color: #f59e0b; background: #fffbeb; color: #d97706; font-weight: 550; }
.exam-nav-item.marked.current { border-color: #f59e0b; box-shadow: 0 2px 8px rgba(245,158,11,0.35); }
.exam-nav-item.answered.current { background: var(--accent); color: #fff; border-color: var(--accent); }
.exam-result { padding: 36px 24px; background: var(--surface); border-radius: var(--radius); border: 1px solid var(--border-light); box-shadow: var(--shadow); text-align: center; }
.exam-result h2 { font-size: 18px; font-weight: 600; margin-bottom: 24px; color: var(--text); }
.exam-score-visual { position: relative; width: 140px; height: 140px; margin: 0 auto 24px; }
.exam-score-ring { width: 100%; height: 100%; transform: rotate(-90deg); }
.exam-score-ring .ring-bg { fill: none; stroke: var(--border-light); stroke-width: 8; }
.exam-score-ring .ring-fill { fill: none; stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset 1s ease; }
.exam-score-ring .ring-fill.perfect { stroke: var(--success); }
.exam-score-ring .ring-fill.good { stroke: var(--accent); }
.exam-score-ring .ring-fill.fail { stroke: var(--danger); }
.exam-score-inner { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; line-height: 1; }
.exam-score-num { font-size: 40px; font-weight: 700; color: var(--accent); }
.exam-score-num.fail-color { color: var(--danger); }
.exam-score-total { font-size: 14px; color: var(--text-muted); margin-top: 2px; }
.exam-stats-row { display: flex; justify-content: center; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; }
.exam-stat-card { flex: 1; min-width: 70px; max-width: 110px; padding: 14px 8px; background: var(--bg); border-radius: var(--radius-sm); border: 1px solid var(--border-light); }
.exam-stat-value { display: block; font-size: 20px; font-weight: 650; color: var(--text); }
.exam-stat-label { display: block; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.exam-wrong-section { text-align: left; margin-top: 8px; }
.exam-wrong-section h3 { font-size: 15px; font-weight: 600; margin-bottom: 12px; color: var(--text); }
.exam-wrong-item { padding: 14px 16px; margin-bottom: 10px; background: var(--surface); border-radius: var(--radius-sm); border: 1px solid var(--border-light); text-align: left; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.exam-wrong-item:hover { border-color: #fecaca; box-shadow: 0 1px 3px rgba(220,38,38,0.06); }
.exam-wrong-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.q-num { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: var(--danger); color: #fff; border-radius: 4px; font-size: 11px; font-weight: 600; flex-shrink: 0; }
.q-type-sm { font-size: 10px; padding: 2px 8px; border-radius: 100px; font-weight: 500; }
.q-type-sm.single { background: #eef2ff; color: #4f46e5; }
.q-type-sm.multiple { background: #fef3c7; color: #b45309; }
.exam-wrong-question { font-size: 13.5px; font-weight: 500; color: var(--text); margin-bottom: 8px; line-height: 1.6; }
.exam-wrong-answers { padding-left: 2px; }
.answer-row { font-size: 12px; padding: 3px 0; }
.answer-row.wrong-row { color: var(--danger); }
.answer-row.correct-row { color: var(--success); }
.exam-result-actions { display: flex; gap: 8px; justify-content: center; margin-top: 24px; }
.exam-result-filter { display: flex; gap: 6px; margin-bottom: 14px; justify-content: center; }
.exam-result-item { padding: 16px; margin-bottom: 12px; background: var(--surface); border-radius: var(--radius-sm); border: 1px solid var(--border-light); transition: border-color 0.15s ease; }
.exam-result-item.result-wrong { border-color: #fecaca; background: #fff5f5; }
.exam-result-item.result-correct { border-color: #bbf7d0; }
.exam-result-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.exam-result-num { font-size: 13px; font-weight: 600; color: var(--text); }
.exam-result-question { font-size: 14px; font-weight: 500; color: var(--text); margin-bottom: 10px; line-height: 1.6; }
.exam-result-options { display: flex; flex-direction: column; gap: 5px; margin-bottom: 8px; }
.exam-result-options .option { padding: 8px 12px; font-size: 13px; cursor: default; margin-bottom: 0; }
.exam-result-options .option:disabled { opacity: 0.75; }
.q-num.result-correct { background: var(--success); color: #fff; }
.q-num.result-wrong { background: var(--danger); color: #fff; }
.btn-exam-history { margin-top: 12px; color: var(--text-secondary); }
.exam-history-page { padding: 0; }
.exam-history-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.exam-history-header h3 { font-size: 16px; font-weight: 600; color: var(--text); margin: 0; }
.exam-history-item { padding: 14px 16px; margin-bottom: 8px; background: var(--surface); border-radius: var(--radius-sm); border: 1px solid var(--border-light); cursor: pointer; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.exam-history-item:hover { border-color: #c7d2fe; box-shadow: var(--shadow-sm); }
.exam-history-main { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; }
.exam-history-date { font-size: 13px; color: var(--text); font-weight: 500; }
.exam-history-score { font-size: 18px; font-weight: 700; }
.exam-history-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-muted); }
.list-item {
  padding: 16px 18px; margin-bottom: 10px; background: var(--surface);
  border-radius: var(--radius); border: 1px solid var(--border-light); box-shadow: var(--shadow-sm);
}
.q-id-label { font-size: 11px; color: var(--text-muted); }
.list-item .q-text { font-size: 14px; margin-bottom: 8px; font-weight: 500; }
.list-options { font-size: 13px; color: var(--text-secondary); margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.list-options .opt-line.answer-highlight { color: var(--success); font-weight: 550; }
.list-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.list-actions button {
  font-size: 12px; padding: 4px 11px; border-radius: 100px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text-secondary);
}
.empty-state { text-align: center; padding: 80px 20px; color: var(--text-muted); font-size: 14.5px; }
.loading-dots span { display: inline-block; animation: dotPulse 1.4s infinite; opacity: 0; }
.loading-dots span:nth-child(2) { animation-delay: 0.2s; }
.loading-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes dotPulse { 0%, 60%, 100% { opacity: 0; } 30% { opacity: 1; } }
.skeleton {
  background: linear-gradient(90deg, var(--border-light) 25%, #e8eaed 50%, var(--border-light) 75%);
  background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.skeleton-text { height: 16px; margin-bottom: 10px; width: 80%; }
.skeleton-opt  { height: 42px; margin-bottom: 8px; width: 100%; }
.site-footer { padding: 42px 12px 30px; color: var(--text-muted); font-size: 12.5px; line-height: 1.6; display: flex; align-items: center; justify-content: center; gap: 28px; }
.footer-sponsor-link {
  display: flex; flex-direction: column; align-items: center; gap: 5px; flex-shrink: 0;
  color: #dc2626; text-decoration: none; font-size: 12.5px; font-weight: 550; border-radius: 10px;
  transition: transform 0.15s ease, color 0.15s ease; -webkit-tap-highlight-color: transparent;
  margin-top: 8px;
}
.footer-sponsor-link:hover { color: #b91c1c; transform: translateY(-0.5px); }
.footer-sponsor-link:focus-visible { outline: 2px solid rgba(220,38,38,0.28); outline-offset: 4px; }
.footer-sponsor-icon {
  width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; font-size: 20px;
  background: linear-gradient(135deg, rgba(254,242,242,0.75), rgba(255,255,255,0.4));
  border: 1px solid rgba(220,38,38,0.08);
  box-shadow: 0 2px 8px rgba(220,38,38,0.06), inset 0 1px 0 rgba(255,255,255,0.7);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.footer-sponsor-emoji { display: inline-block; transform: translateY(-0.5px); }
.footer-notes { text-align: left; }
.footer-notes p + p { margin-top: 2px; }
.sponsor-page { padding: 8px 0 12px; }
.sponsor-back { margin-bottom: 16px; }
.sponsor-hero { text-align: center; padding: 20px 18px 18px; }
.sponsor-heart {
  width: 52px; height: 52px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: #dc2626; font-size: 30px;
  background: linear-gradient(135deg, rgba(254,242,242,0.75), rgba(255,255,255,0.4));
  border: 1px solid rgba(220,38,38,0.08);
  box-shadow: 0 2px 12px rgba(220,38,38,0.08), inset 0 1px 0 rgba(255,255,255,0.7);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.sponsor-heart-emoji { display: inline-block; transform: translateY(-0.5px); }
.sponsor-hero h1 { font-size: 24px; line-height: 1.25; font-weight: 650; color: var(--text); margin-bottom: 8px; }
.sponsor-hero p { max-width: 360px; margin: 0 auto; color: var(--text-secondary); font-size: 13.5px; line-height: 1.7; }
.sponsor-qr-card {
  max-width: 380px; margin: 0 auto; padding: 16px; text-align: center; background: var(--surface);
  border: 1px solid var(--border-light); border-radius: var(--radius); box-shadow: var(--shadow);
}
.sponsor-qr-card img {
  display: block; width: 100%; max-width: 310px; height: auto; margin: 0 auto 12px;
  border-radius: 8px; border: 1px solid var(--border-light); background: #fff;
  -webkit-touch-callout: default; touch-action: auto;
}
.sponsor-qr-card p { color: var(--text-secondary); font-size: 13px; line-height: 1.7; }
@media (max-width: 480px) {
  body { padding: 0 12px; }
  #top-nav { padding: 4px; margin-bottom: 18px; }
  #top-nav button { font-size: 13px; padding: 8px 4px; }
  .q-text { font-size: 14.5px; }
  .option { font-size: 13.5px; padding: 11px 13px; }
  .btn { padding: 8px 15px; font-size: 12.5px; }
  .question-card { padding: 18px 14px; }
  .site-footer { padding: 34px 4px 24px; gap: 10px; }
  .footer-notes { font-size: 11.5px; }
  .sponsor-page { padding-top: 2px; }
  .sponsor-hero { padding: 12px 8px 16px; }
  .sponsor-hero h1 { font-size: 22px; }
  .sponsor-qr-card { padding: 12px; }
  .sponsor-qr-card img { max-width: 286px; }
}
[data-theme="dark"] {
  --bg: #0f1117; --surface: #1a1d27; --text: #e5e7eb; --text-secondary: #9ca3af;
  --text-muted: #6b7280; --accent: #818cf8; --accent-light: rgba(99,102,241,0.18);
  --success: #34d399; --success-bg: rgba(5,150,105,0.12); --danger: #f87171; --danger-bg: rgba(220,38,38,0.12);
  --border: #2d3148; --border-light: #232738; --warning-bg: rgba(245,158,11,0.12); --warning: #fbbf24;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.2); --shadow: 0 1px 3px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.2);
}
[data-theme="dark"] .q-type.single { background: rgba(99,102,241,0.18); color: #a5b4fc; }
[data-theme="dark"] .q-type.multiple { background: rgba(245,158,11,0.15); color: #fbbf24; }
[data-theme="dark"] .footer-sponsor-icon,
[data-theme="dark"] .sponsor-heart { background: linear-gradient(135deg, rgba(248,113,113,0.15), rgba(255,255,255,0.03)); border-color: rgba(248,113,113,0.12); }
[data-theme="dark"] .sponsor-hero h1, [data-theme="dark"] .sponsor-hero p { color: var(--text); }
[data-theme="dark"] .topic-dropdown-panel { background: rgba(26,29,39,0.96); }
[data-theme="dark"] .topic-dropdown-btn { background: var(--surface); }
[data-theme="dark"] .search-box { background: var(--surface); color: var(--text); }
[data-theme="dark"] .exam-nav-item.marked { background: rgba(245,158,11,0.1); }
[data-theme="dark"] .skeleton { background: linear-gradient(90deg, #232738 25%, #2d3148 50%, #232738 75%); background-size: 200% 100%; }
[data-theme="dark"] .exam-header { background: rgba(26,29,39,0.92); }
[data-theme="dark"] .footer-sponsor-link { color: #f87171; }
[data-theme="dark"] .btn-submit-exam:hover { background: #ef4444; border-color: #ef4444; }
[data-theme="dark"] .q-num { color: #fff; }
[data-theme="dark"] .search-box { -webkit-appearance: none; }
[data-theme="dark"] .exam-result-item.result-wrong { border-color: rgba(248,113,113,0.28); background: rgba(248,113,113,0.08); }
[data-theme="dark"] .exam-result-item.result-correct { border-color: rgba(52,211,153,0.25); }
[data-theme="dark"] .exam-wrong-item:hover { border-color: rgba(248,113,113,0.35); box-shadow: 0 1px 3px rgba(248,113,113,0.14); }
/* 解析面板 */
.ai-panel {
  margin-top: 16px; padding: 18px; background: var(--surface);
  border-radius: var(--radius); border: 1px solid var(--border-light);
  box-shadow: var(--shadow);
}
.ai-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border-light);
}
.ai-panel-header span { font-size: 14px; font-weight: 550; color: var(--accent); }
.ai-panel-close {
  width: 28px; height: 28px; border: none; background: transparent;
  cursor: pointer; color: var(--text-muted); font-size: 15px;
  border-radius: 6px; display: inline-flex; align-items: center; justify-content: center;
}
.ai-panel-close:hover { background: var(--border-light); color: var(--text); }
.ai-content {
  font-size: 13.5px; line-height: 1.8; color: var(--text);
  white-space: pre-wrap; word-break: break-word; max-height: 420px; overflow-y: auto;
}
.ai-content.streaming::after { content: '▊'; animation: ai-blink 1s infinite; color: var(--accent); }
@keyframes ai-blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
.ai-loading { display: flex; align-items: center; gap: 10px; padding: 24px 0; color: var(--text-secondary); font-size: 13.5px; }
.ai-loading-spinner {
  width: 18px; height: 18px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%;
  animation: ai-spin 0.8s linear infinite; flex-shrink: 0;
}
@keyframes ai-spin { to { transform: rotate(360deg); } }
.ai-error { color: var(--danger); font-size: 13px; white-space: pre-wrap; }
#load-progress-wrap { position: fixed; top: 0; left: 0; right: 0; z-index: 200; display: none; }
#load-progress-bar { height: 3px; width: 0; background: var(--accent); transition: width 0.2s ease; }
#load-progress-text { text-align: center; font-size: 10px; color: var(--text-muted); padding: 2px 0; display: none; }
#load-progress-bar.indeterminate { width: 100% !important; background: linear-gradient(90deg, var(--accent) 0%, #a5b4fc 50%, var(--accent) 100%); background-size: 200% 100%; animation: load-shimmer 1.2s linear infinite; }
@keyframes load-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
/* 跳转题目 */
.jump-link { font-size: 11px; color: var(--accent); cursor: pointer; margin-left: 2px; white-space: nowrap; user-select: none; }
.jump-link:hover { text-decoration: underline; }
.jump-input { width: 44px; padding: 2px 4px; border: 1px solid var(--accent); border-radius: 4px; font-size: 12px; text-align: center; font-family: inherit; color: var(--text); background: var(--surface); -moz-appearance: textfield; }
.jump-input::-webkit-inner-spin-button, .jump-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.jump-input:focus { outline: none; box-shadow: 0 0 0 2px rgba(79,70,229,0.15); }
.jump-go { font-size: 11px; padding: 1px 7px; border: 1px solid var(--accent); border-radius: 4px; background: var(--accent); color: #fff; cursor: pointer; font-family: inherit; }
.jump-error { animation: jump-shake 0.35s ease; }
@keyframes jump-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
[data-theme="dark"] .jump-input { background: var(--surface); color: var(--text); border-color: var(--accent); }"""

# ── SW 版本号：纳入所有源文件确保任何变更都触发 SW 更新 ──
sw_version = hashlib.sha256((bank_hash + ai_js + app_js + storage_js + CSS + icon_hash).encode()).hexdigest()[:8]
app_js = app_js.replace(
    "serviceWorker.register('sw.js'",
    "serviceWorker.register('sw.js?v=" + sw_version + "'"
)

# ── Service Worker：network-first HTML + cache-first 静态资源 ──
sw_js = f"""// SW v{sw_version}
const CACHE_NAME = 'cquccp-{bank_hash}';
const INDEX_URL = new URL('index.html', self.registration.scope).href;
const IMMUTABLE_URLS = new Set([
  new URL('{bank_filename}', self.registration.scope).href,
  new URL('{icon_filename}', self.registration.scope).href,
  new URL('{ai_filename}', self.registration.scope).href
]);

self.addEventListener('install', function(event) {{
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {{
      var urls = [
        new URL('{bank_filename}', self.registration.scope).href,
        new URL('{ai_filename}', self.registration.scope).href,
        new URL('{icon_filename}', self.registration.scope).href
      ];
      return Promise.all(urls.map(function(url) {{
        return cache.add(url).catch(function(e) {{
          console.warn('[SW] precache failed for:', url, e);
        }});
      }}));
    }}).then(function() {{ return self.skipWaiting(); }})
  );
}});

self.addEventListener('activate', function(event) {{
  event.waitUntil(
    caches.keys().then(function(keys) {{
      var ourKeys = keys.filter(function(k) {{
        return k.indexOf('cquccp-') === 0;
      }});
      var isUpdate = ourKeys.filter(function(k) {{ return k !== CACHE_NAME; }}).length > 0;
      return Promise.all(ourKeys.filter(function(k) {{
        return k !== CACHE_NAME;
      }}).map(function(k) {{ return caches.delete(k); }})).then(function() {{
        return self.clients.claim();
      }}).then(function() {{
        if (isUpdate) {{
          return self.clients.matchAll().then(function(clients) {{
            clients.forEach(function(client) {{
              client.postMessage({{ type: 'new-version' }});
            }});
          }});
        }}
      }});
    }})
  );
}});

function isSameScope(url) {{
  var scopePath = new URL(self.registration.scope).pathname;
  return url.origin === location.origin && url.pathname.indexOf(scopePath) === 0;
}}

self.addEventListener('fetch', function(event) {{
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (!isSameScope(url)) return;

  // HTML: network-first，网络失败才降级缓存
  if (request.mode === 'navigate' || url.href === INDEX_URL) {{
    event.respondWith(
      fetch(request).then(function(response) {{
        // 网络成功 → 更新缓存 → 返回
        var cloned = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {{
          cache.put(INDEX_URL, cloned).catch(function() {{}});
        }});
        return response;
      }}).catch(function() {{
        // 网络失败 → 尝试缓存
        return caches.match(INDEX_URL);
      }})
    );
    return;
  }}

  // 静态资源: cache-first
  if (IMMUTABLE_URLS.has(url.href)) {{
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {{
        return cache.match(request).then(function(cached) {{
          if (cached) return cached;
          return fetch(request).then(function(response) {{
            if (response && response.ok) {{
              cache.put(request, response.clone()).catch(function() {{}});
            }}
            return response;
          }});
        }});
      }})
    );
  }}
}});
"""

with open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8", newline="\n") as f:
    f.write(sw_js)

# ── 组装 index.html ────────────────────────────────
BODY = """<header id="site-header">
  <img src="{icon}" alt="icon" class="site-icon" width="32" height="32">
  <a href="https://12371.cn/special/zxzc" class="site-title" target="_blank" rel="noopener"><span class="site-title-text">重庆大学</span>入党积极分子练习</a>
  <div class="site-header-right">
    <button class="dark-toggle" id="dark-toggle" aria-label="夜间模式"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"></path></svg></button>
    <span class="site-badge">{version}</span>
  </div>
</header>
<nav id="top-nav">
  <button data-tab="practice" class="active">刷题</button>
  <button data-tab="exam">模拟考试</button>
  <button data-tab="all">总题库</button>
  <button data-tab="wrong">错题集</button>
  <button data-tab="fav">收藏夹</button>
</nav>

<div id="load-progress-wrap"><div id="load-progress-bar"></div><div id="load-progress-text">题库加载中…</div></div>
<main id="app">
  <div class="question-card">
    <div class="q-header"><span class="q-type single">单选题</span></div>
    <div class="skeleton skeleton-text"></div>
    <div class="skeleton skeleton-opt"></div>
    <div class="skeleton skeleton-opt"></div>
    <div class="skeleton skeleton-opt"></div>
    <div class="skeleton skeleton-opt"></div>
    <div class="action-bar">
      <button class="btn primary" disabled>确定</button>
      <button class="btn" disabled>上一题</button>
      <button class="btn" disabled>下一题</button>
    </div>
  </div>
</main>

<footer class="site-footer">
  <div class="footer-notes">
    <p>· 本练习网站由20230537华晓蔚制作，仅供学习参考</p>
    <p>· 如有题目错误或友情建议请联系QQ：1176843521</p>
    <p>· 请使用同一入口使用，否则数据会不同</p>

  </div>
  <a class="footer-sponsor-link" id="footer-sponsor-link" href="#sponsor" aria-label="打开友情赞助页面">
    <span class="footer-sponsor-icon" aria-hidden="true"><span class="footer-sponsor-emoji">💌</span></span>
    <span>友情赞助</span>
  </a>
</footer>
""".format(icon=icon_filename, version=DISPLAY_VERSION)

# ── 最终版本号：纳入 CSS / BODY / icon，确保任何变更都触发更新 ──
_full_version_hash = hashlib.sha256(
    (bank_hash + ai_js + app_js + storage_js + CSS + BODY + icon_hash).encode()
).hexdigest()[:6]
VERSION_STR = f"（正式{_VERSION_MANUAL}.{_full_version_hash}）"

version_str = VERSION_STR
with open(os.path.join(OUT, "version.txt"), "w", encoding="utf-8", newline="\n") as f:
    f.write(version_str)
# 使用 meta 标签让 SW 可稳定解析版本号，避免正则匹配 HTML 正文的脆弱性
version_meta = '<meta name="x-version" content="' + version_str + '">'
# window.__VERSION 直接写入原始字符串（非 json.dumps），避免中文被 unicode-escape
runtime_config_js = '<script>window.__QUESTION_BANK_URL="' + bank_filename + '";window.__VERSION="' + version_str.replace('\\', '\\\\').replace('"', '\\"') + '";(function(u){var l=document.createElement("link");l.rel="prefetch";l.href=u;document.head.appendChild(l);})(window.__QUESTION_BANK_URL);</script>'

index_html = "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n" + \
    "<meta charset=\"UTF-8\">\n" + \
    version_meta + "\n" + \
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" + \
    "<title>重庆大学入党积极分子练习</title>\n" + \
    f"<link rel=\"icon\" href=\"{icon_filename}\" type=\"image/jpeg\">\n" + \
    f"<link rel=\"apple-touch-icon\" href=\"{icon_filename}\">\n" + \
    "<style>\n" + CSS + "\n</style>\n" + \
    "</head>\n<body>\n" + BODY + "\n" + runtime_config_js + "\n" + preload_js + "\n<script>\n" + storage_js + "\n" + app_js + "\n</script>\n<script src=\"" + ai_filename + "\" defer></script>\n</body>\n</html>"

with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
    f.write(index_html)

# ── 报告 ────────────────────────────────────────────
wechat_path = os.path.join(ROOT, "assets", "wechat.png")
wechat_size = 0
if os.path.exists(wechat_path):
    wechat_size = os.path.getsize(wechat_path)
else:
    print("WARNING: wechat.png 未找到，赞助二维码将缺失", file=sys.stderr)

deploy_files = {
    "index.html": len(index_html),
    "sw.js": len(sw_js),
    bank_filename: len(compact_json),
    "questions-compact.json": len(compact_json),
    icon_filename: len(icon_bytes),
    "wechat.png": wechat_size,
    "version.txt": len(version_str.encode("utf-8")),
    ai_filename: len(ai_js),
}
if wechat_size == 0:
    del deploy_files["wechat.png"]
if LOCAL:
    deploy_files["questions.js"] = len(escaped) + 14

def _safe_gzip_size(filepath):
    """读取文件并返回 gzip 压缩大小，文件缺失时返回 0"""
    if not os.path.exists(filepath):
        return 0
    try:
        with open(filepath, "rb") as fh:
            return len(gzip.compress(fh.read(), 9))
    except Exception:
        return 0

_asset_names = {"wechat.png"}

def _deploy_path(name):
    """返回部署文件的实际路径（生成文件在 tmp/，资源文件在 assets/）"""
    if name in _asset_names:
        return os.path.join(ROOT, "assets", name)
    return os.path.join(OUT, name)

total_raw = sum(deploy_files.values())
total_gz = sum(_safe_gzip_size(_deploy_path(f)) for f in deploy_files)

print(f"\n  题目: {len(rows)} 题  |  来源: {len(sources)} 个  |  跳过: {skipped} 题")
print(f"\n  {'文件':<28} {'原始':>7} {'gzip':>7}")
for name, raw_size in deploy_files.items():
    gz_size = _safe_gzip_size(_deploy_path(name))
    print(f"  {name:<28} {raw_size/1024:>5.0f}KB {gz_size/1024:>5.0f}KB")
print(f"  {'─'*42}")
print(f"  {'部署文件 (' + str(len(deploy_files)) + '个)':<28} {total_raw/1024:>5.0f}KB {total_gz/1024:>5.0f}KB")
upload_names = [f for f in deploy_files]
if LOCAL:
    print(f"\n  上传: {' + '.join(upload_names)} + questions.js")
else:
    print(f"\n  上传: {' + '.join(upload_names)}")
    print(f"  (加 --local 额外输出 questions.js 用于本地测试)")

# ── 复制到 final 目录 ────────────────────────────────
final_dir = os.path.join(ROOT, "final")
if os.path.exists(final_dir):
    for name in os.listdir(final_dir):
        os.remove(os.path.join(final_dir, name))
else:
    os.makedirs(final_dir)

copied = 0
for name in deploy_files:
    src_dir = os.path.join(ROOT, "assets") if name in _asset_names else OUT
    src = os.path.join(src_dir, name)
    dst = os.path.join(final_dir, name)
    if os.path.exists(src):
        shutil.copy2(src, dst)
        copied += 1

print(f"  部署文件已复制到 final/ ({copied} 个)")
print(f"  完成。\n")
