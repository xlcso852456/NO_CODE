const W = 960;
const H = 540;
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16'];
const DRAW_COLOR = '#facc15';
const GLOBAL_COLOR = '#2563eb';
const GLOBAL_REGION = { name: '全域', points: [[0, 0], [W, 0], [W, H], [0, H]] };

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const stage = $('#stage');
const equipmentDialog = $('#equipmentDialog');

const state = {
  options: { functions: [], equipment: [] },
  projects: [],
  editingId: null,
  bg: null,             // 960x540 的背景 canvas
  pendingImage: null,   // 尚未上傳的新圖片 Promise<Blob>
  scope: 'global',      // global：整張畫面（不可框選）；region：自行框選
  regions: [],          // [{ name, points: [[x, y], ...] }]，切到全域時保留，切回區域可繼續用
  current: [],          // 繪製中的頂點
  mouse: null,
  drag: null,           // 拖曳中：{ type: 'vertex', ri, pi } 或 { type: 'region', ri, ... }
  hoverRegion: -1,
  equipment: [],        // 已選的裝備 id
};

// ---------- 工具 ----------

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const colorOf = (i) => COLORS[i % COLORS.length];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function toCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    clamp(Math.round((e.clientX - rect.left) * W / rect.width), 0, W),
    clamp(Math.round((e.clientY - rect.top) * H / rect.height), 0, H),
  ];
}

// 以螢幕上約 9px 為點擊判定範圍，換算成 960x540 座標
function hitRadius() {
  return 9 * W / canvas.getBoundingClientRect().width;
}

function findVertex(pt) {
  const r = hitRadius();
  for (let ri = state.regions.length - 1; ri >= 0; ri--) {
    const pts = state.regions[ri].points;
    for (let pi = 0; pi < pts.length; pi++) {
      if (dist(pts[pi], pt) <= r) return { ri, pi };
    }
  }
  return null;
}

function pointInPolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 取最上層（最後畫的）包含該點的區域
function findRegionAt(pt) {
  for (let ri = state.regions.length - 1; ri >= 0; ri--) {
    if (pointInPolygon(pt, state.regions[ri].points)) return ri;
  }
  return -1;
}

function nextRegionName() {
  const used = new Set(state.regions.map((r) => r.name));
  let n = 1;
  while (used.has(`區域${n}`)) n++;
  return `區域${n}`;
}

// ---------- 繪圖 ----------

function render() {
  ctx.clearRect(0, 0, W, H);
  if (state.bg) {
    ctx.drawImage(state.bg, 0, 0);
  } else {
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, W, H);
  }

  if (isGlobal()) {
    drawGlobal();
  } else {
    state.regions.forEach((r, i) => drawRegion(r, colorOf(i), i === state.hoverRegion || i === state.drag?.ri));
    drawCurrent();
  }
  updateControls();
}

function drawGlobal() {
  ctx.fillStyle = hexAlpha(GLOBAL_COLOR, 0.12);
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 4;
  ctx.strokeStyle = GLOBAL_COLOR;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  const label = '全域偵測（整張畫面）';
  ctx.font = '600 15px "Microsoft JhengHei", sans-serif';
  const w = ctx.measureText(label).width + 20;
  ctx.fillStyle = hexAlpha(GLOBAL_COLOR, 0.9);
  ctx.fillRect(12, 12, w, 30);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 22, 28);
}

function drawRegion(region, color, active) {
  const pts = region.points;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = hexAlpha(color, active ? 0.4 : 0.22);
  ctx.fill();
  ctx.lineWidth = active ? 3 : 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  pts.forEach(([x, y]) => drawVertex(x, y, color, 4));

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  ctx.font = '600 13px "Microsoft JhengHei", sans-serif';
  const w = ctx.measureText(region.name).width + 12;
  ctx.fillStyle = hexAlpha(color, 0.9);
  ctx.fillRect(cx - w / 2, cy - 11, w, 22);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region.name, cx, cy + 1);
}

function drawVertex(x, y, color, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawCurrent() {
  const pts = state.current;
  if (!pts.length) return;

  const snapping = pts.length >= 3 && state.mouse && dist(state.mouse, pts[0]) <= hitRadius();

  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (state.mouse) ctx.lineTo(...(snapping ? pts[0] : state.mouse));
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = DRAW_COLOR;
  ctx.stroke();
  ctx.setLineDash([]);

  pts.forEach(([x, y], i) => drawVertex(x, y, DRAW_COLOR, i === 0 && snapping ? 8 : 4));
}

function updateControls() {
  const n = state.current.length;
  const locked = isGlobal();
  $('#finishBtn').disabled = locked || n < 3;
  $('#undoBtn').disabled = locked || n === 0;
  $('#cancelBtn').disabled = locked || n === 0;
  $('#clearBtn').disabled = locked || (!state.regions.length && !n);
  $('#copyBtn').disabled = !activeRegions().length;
}

// ---------- 偵測範圍 ----------

const isGlobal = () => state.scope === 'global';
const activeRegions = () => (isGlobal() ? [GLOBAL_REGION] : state.regions);

function setScope(scope) {
  state.scope = scope;
  document.querySelectorAll('input[name="scope"]').forEach((r) => (r.checked = r.value === scope));
  if (isGlobal()) {
    state.current = [];
    state.drag = null;
    state.hoverRegion = -1;
    canvas.classList.remove('grab', 'move', 'grabbing');
  }
  canvas.classList.toggle('locked', isGlobal());
  $('#stageCard').classList.toggle('scope-global', isGlobal());
  $('#scopeHint').textContent = isGlobal()
    ? '整張畫面都偵測，座標固定為 (0,0)–(960,540)，不需框選'
    : '在畫面上框選要偵測的區域，可框多個';
  updateRegionUI();
  render();
}

document.querySelectorAll('input[name="scope"]').forEach((r) =>
  r.addEventListener('change', () => setScope(r.value)));

// ---------- 區域操作 ----------

function finishRegion() {
  if (state.current.length < 3) {
    toast('區域至少需要 3 個點', 'error');
    return;
  }
  state.regions.push({ name: nextRegionName(), points: state.current });
  state.current = [];
  updateRegionUI();
  render();
}

function undoPoint() {
  state.current.pop();
  render();
}

function cancelDraw() {
  state.current = [];
  render();
}

function clearRegions() {
  if (state.regions.length && !confirm('確定清除所有已框選的區域？')) return;
  state.regions = [];
  state.current = [];
  state.hoverRegion = -1;
  updateRegionUI();
  render();
}

function coordsText() {
  const regions = activeRegions();
  if (!regions.length) return '';
  const lines = regions.map((r) => '  ' + JSON.stringify({ name: r.name, points: r.points }));
  return `[\n${lines.join(',\n')}\n]`;
}

const pointsText = (pts) => pts.map(([x, y]) => `(${x},${y})`).join(' ');

function updateRegionUI() {
  const list = $('#regionList');
  if (isGlobal()) {
    list.replaceChildren(el('li', {}, [
      el('span', { className: 'swatch', style: `background:${GLOBAL_COLOR}` }),
      el('strong', { textContent: '全域（整張畫面）' }),
      el('span', { className: 'pts', textContent: `4 點：${pointsText(GLOBAL_REGION.points)}` }),
    ]));
  } else if (!state.regions.length) {
    list.replaceChildren(el('li', { className: 'empty-row', textContent: '尚未框選區域，請在畫面上點擊建立多邊形' }));
  } else {
    list.replaceChildren(...state.regions.map((r, i) => {
      const nameInput = el('input', { type: 'text', value: r.name, maxLength: 50 });
      nameInput.addEventListener('input', () => {
        r.name = nameInput.value.trim() || `區域${i + 1}`;
        $('#coordsOutput').value = coordsText();
        render();
      });
      const del = el('button', { type: 'button', className: 'btn link danger', textContent: '刪除' });
      del.addEventListener('click', () => {
        state.regions.splice(i, 1);
        state.hoverRegion = -1;
        updateRegionUI();
        render();
      });
      const li = el('li', {}, [
        el('span', { className: 'swatch', style: `background:${colorOf(i)}` }),
        nameInput,
        el('span', {
          className: 'pts',
          textContent: `${r.points.length} 點：${pointsText(r.points)}`,
          title: pointsText(r.points),
        }),
        del,
      ]);
      li.addEventListener('mouseenter', () => { state.hoverRegion = i; li.classList.add('active'); render(); });
      li.addEventListener('mouseleave', () => { state.hoverRegion = -1; li.classList.remove('active'); render(); });
      return li;
    }));
  }
  $('#coordsOutput').value = coordsText();
  $('#coordsOutput').placeholder = '框選完成後，這裡會顯示所有區域的座標 (960×540)';
}

// ---------- 畫面事件 ----------

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !state.bg || isGlobal()) return;
  const pt = toCanvasPoint(e);
  const cur = state.current;

  if (!cur.length) {
    const hit = findVertex(pt);
    if (hit) {
      state.drag = { type: 'vertex', ...hit };
      canvas.classList.add('grabbing');
      return;
    }
    // 按在區域內：拖動則整塊移動，沒拖動放開則當作一般點擊（開始新區域）
    const ri = findRegionAt(pt);
    if (ri !== -1) {
      const orig = state.regions[ri].points.map(([x, y]) => [x, y]);
      const xs = orig.map((p) => p[0]);
      const ys = orig.map((p) => p[1]);
      state.drag = {
        type: 'region',
        ri,
        start: pt,
        screenStart: [e.clientX, e.clientY],
        orig,
        moved: false,
        // 位移上下限，確保整個區域留在 960x540 內
        dx: [-Math.min(...xs), W - Math.max(...xs)],
        dy: [-Math.min(...ys), H - Math.max(...ys)],
      };
      return;
    }
  }
  if (cur.length >= 3 && dist(pt, cur[0]) <= hitRadius()) {
    finishRegion();
    return;
  }
  const last = cur[cur.length - 1];
  if (!last || last[0] !== pt[0] || last[1] !== pt[1]) cur.push(pt);
  render();
});

canvas.addEventListener('mousemove', (e) => {
  const pt = toCanvasPoint(e);
  state.mouse = pt;
  $('#coordReadout').textContent = `x: ${pt[0]}, y: ${pt[1]}`;
  const d = state.drag;
  if (d?.type === 'vertex') {
    state.regions[d.ri].points[d.pi] = pt;
  } else if (d?.type === 'region') {
    if (d.moved || Math.hypot(e.clientX - d.screenStart[0], e.clientY - d.screenStart[1]) >= 4) {
      d.moved = true;
      canvas.classList.add('grabbing');
      const dx = clamp(pt[0] - d.start[0], ...d.dx);
      const dy = clamp(pt[1] - d.start[1], ...d.dy);
      state.regions[d.ri].points = d.orig.map(([x, y]) => [x + dx, y + dy]);
    }
  } else if (!isGlobal()) {
    const idle = !state.current.length;
    const onVertex = idle && !!findVertex(pt);
    canvas.classList.toggle('grab', onVertex);
    canvas.classList.toggle('move', idle && !onVertex && findRegionAt(pt) !== -1);
  }
  render();
});

canvas.addEventListener('mouseleave', () => {
  state.mouse = null;
  $('#coordReadout').textContent = 'x: –, y: –';
  render();
});

window.addEventListener('mouseup', () => {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  canvas.classList.remove('grabbing');
  if (d.type === 'region' && !d.moved) {
    state.current.push(d.start);
    canvas.classList.remove('move');
  } else {
    updateRegionUI();
  }
  render();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  undoPoint();
});

document.addEventListener('keydown', (e) => {
  if (equipmentDialog.open || (e.target instanceof Element && e.target.closest('input, textarea, select'))) return;
  if (e.key === 'Enter') {
    if (state.current.length) { e.preventDefault(); finishRegion(); }
  } else if (e.key === 'Escape') {
    cancelDraw();
  } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
    if (state.current.length) { e.preventDefault(); undoPoint(); }
  }
});

$('#finishBtn').addEventListener('click', finishRegion);
$('#undoBtn').addEventListener('click', undoPoint);
$('#cancelBtn').addEventListener('click', cancelDraw);
$('#clearBtn').addEventListener('click', clearRegions);

$('#copyBtn').addEventListener('click', async () => {
  const text = coordsText();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    $('#coordsOutput').select();
    document.execCommand('copy');
  }
  toast('座標已複製', 'success');
});

// ---------- 圖片 ----------

function setBackground(img) {
  const c = el('canvas', { width: W, height: H });
  c.getContext('2d').drawImage(img, 0, 0, W, H);
  state.bg = c;
  stage.classList.add('has-image');
  render();
  return c;
}

function setImageInfo(text, warn = false) {
  const info = $('#imageInfo');
  info.textContent = text;
  info.classList.toggle('warn', warn);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// 請伺服器用 OpenCV 從 RTSP 擷取一張 960x540 的畫面
async function grabFrame() {
  const rtsp = $('#rtsp').value.trim();
  if (!/^rtsps?:\/\//i.test(rtsp)) {
    toast('請輸入以 rtsp:// 開頭的網址', 'error');
    return;
  }
  const btn = $('#grabBtn');
  btn.disabled = true;
  stage.classList.add('loading-on');
  try {
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rtsp }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast(errorText(body, res.status, '讀取畫面失敗'), 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
      setBackground(await loadImage(url));
    } finally {
      URL.revokeObjectURL(url);
    }
    state.pendingImage = Promise.resolve(blob);

    const w = Number(res.headers.get('X-Source-Width'));
    const h = Number(res.headers.get('X-Source-Height'));
    const stretched = Math.abs(w / h - W / H) > 0.01;
    setImageInfo(
      `已從 RTSP 擷取畫面（${new Date().toLocaleTimeString()}）：原始 ${w}×${h} → 已縮放為 ${W}×${H}`
        + (stretched ? '（原始比例非 16:9，畫面已拉伸）' : ''),
      stretched,
    );
    toast('畫面讀取成功', 'success');
  } catch (err) {
    toast(err?.name === 'TimeoutError' ? '連線逾時，請確認 RTSP 是否可用' : '無法連線到伺服器', 'error');
  } finally {
    btn.disabled = false;
    stage.classList.remove('loading-on');
  }
}

$('#grabBtn').addEventListener('click', grabFrame);
$('#rtsp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    grabFrame();
  }
});

// ---------- 功能 / 裝備 ----------

const funcInputs = () => [...document.querySelectorAll('input[name="function"]')];
const selectedFunction = () => funcInputs().find((i) => i.checked)?.value ?? null;

// 功能為單選：選了一項後其他項目鎖住，取消勾選才能改選
function syncFuncCards() {
  const selected = selectedFunction();
  funcInputs().forEach((input) => {
    input.disabled = selected !== null && input.value !== selected;
    const card = input.closest('.func');
    card.classList.toggle('on', input.checked);
    card.classList.toggle('disabled', input.disabled);
  });
}

funcInputs().forEach((input) => input.addEventListener('change', () => {
  syncFuncCards();
  if (input.value === 'equipment' && input.checked && !state.equipment.length) openEquipmentDialog();
}));

const equipmentOf = (id) => state.options.equipment.find((e) => e.id === id);
const equipmentName = (id) => equipmentOf(id)?.name ?? id;
const functionName = (id) => state.options.functions.find((f) => f.id === id)?.name ?? id;

// 裝備圖片；沒有圖或圖片載入失敗時以名稱首字代替
function equipmentThumb(eq, cls) {
  const fallback = () => el('span', { className: `${cls} thumb-fallback`, textContent: eq?.name?.[0] ?? '?' });
  if (!eq?.image) return fallback();
  const img = el('img', { className: cls, src: eq.image, alt: eq.name, draggable: false });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

function renderChips() {
  const box = $('#equipmentChips');
  box.replaceChildren(...(state.equipment.length
    ? state.equipment.map((id) => el('span', { className: 'chip' }, [
      equipmentThumb(equipmentOf(id), 'chip-img'),
      equipmentName(id),
    ]))
    : [el('span', { className: 'none', textContent: '尚未選擇裝備' })]));
}

function buildEquipmentGrid() {
  $('#equipmentGrid').replaceChildren(...state.options.equipment.map((eq) =>
    el('label', { className: 'equip-item' }, [
      el('input', { type: 'checkbox', value: eq.id }),
      equipmentThumb(eq, 'equip-img'),
      el('span', { className: 'equip-name', textContent: eq.name }),
    ])));
}

const equipChecks = () => [...$('#equipmentGrid').querySelectorAll('input')];

function openEquipmentDialog() {
  equipChecks().forEach((c) => (c.checked = state.equipment.includes(c.value)));
  equipmentDialog.showModal();
}

$('#openEquipmentBtn').addEventListener('click', openEquipmentDialog);
$('#equipAllBtn').addEventListener('click', () => equipChecks().forEach((c) => (c.checked = true)));
$('#equipNoneBtn').addEventListener('click', () => equipChecks().forEach((c) => (c.checked = false)));
$('#equipCancelBtn').addEventListener('click', () => equipmentDialog.close());
$('#equipOkBtn').addEventListener('click', () => {
  state.equipment = equipChecks().filter((c) => c.checked).map((c) => c.value);
  renderChips();
  equipmentDialog.close();
});

// ---------- 表單 ----------

function intValue(sel) {
  const v = $(sel).value.trim();
  return v === '' ? NaN : Number(v);
}

function collectPayload() {
  const func = selectedFunction();
  const has = (f) => func === f;
  const payload = {
    project_name: $('#projectName').value.trim(),
    rtsp: $('#rtsp').value.trim(),
    function: func,
    scope: state.scope,
    regions: activeRegions().map((r) => ({ name: r.name, points: r.points })),
    detection_time: { start: $('#timeStart').value, end: $('#timeEnd').value },
    fence: has('fence') ? { enter_seconds: intValue('#fenceSeconds') } : null,
    crowd: has('crowd') ? { people: intValue('#crowdPeople'), enter_seconds: intValue('#crowdSeconds') } : null,
    equipment: has('equipment') ? state.equipment : [],
  };

  const isInt = (v, min) => Number.isInteger(v) && v >= min;
  let error = null;
  if (!payload.project_name) error = '請輸入專案名稱';
  else if (!payload.rtsp) error = '請輸入 RTSP 網址';
  else if (!/^rtsps?:\/\//i.test(payload.rtsp)) error = 'RTSP 網址須以 rtsp:// 開頭';
  else if (!payload.detection_time.start || !payload.detection_time.end) error = '請填寫偵測時段';
  else if (!func) error = '請選擇一項偵測功能';
  else if (state.current.length) error = '還有未完成的區域，請按「完成區域」或「取消繪製」';
  else if (!isGlobal() && !payload.regions.length) error = '偵測範圍為「區域」時，請至少框選一個區域';
  else if (has('fence') && !isInt(payload.fence.enter_seconds, 0)) error = '電子圍籬進入時間須為 0 以上的整數秒';
  else if (has('crowd') && !isInt(payload.crowd.people, 2)) error = '群聚人數須為 2 以上的整數';
  else if (has('crowd') && !isInt(payload.crowd.enter_seconds, 0)) error = '群聚進入時間須為 0 以上的整數秒';
  else if (has('equipment') && !payload.equipment.length) error = '請至少選擇一項要偵測的裝備';
  else if (!state.editingId && !state.bg) error = '請先按「讀取畫面」擷取 RTSP 畫面';
  return { payload, error };
}

function errorText(body, status, fallback = '儲存失敗') {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x.msg.replace(/^Value error, /, '')).join('；');
  return `${fallback}（${status}）`;
}

$('#projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { payload, error } = collectPayload();
  if (error) {
    toast(error, 'error');
    return;
  }

  const fd = new FormData();
  fd.append('data', JSON.stringify(payload));
  if (state.pendingImage) {
    const blob = await state.pendingImage;
    if (blob) fd.append('image', blob, 'frame.jpg');
  }

  const btn = $('#saveBtn');
  btn.disabled = true;
  try {
    const editing = state.editingId;
    const res = await fetch(editing ? `/api/projects/${editing}` : '/api/projects', {
      method: editing ? 'PUT' : 'POST',
      body: fd,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      toast(errorText(body, res.status), 'error');
      return;
    }
    state.editingId = body.id;
    state.pendingImage = null;
    $('#modeLabel').textContent = `編輯中：${body.project_name}`;
    toast(editing ? '專案已更新' : '專案已建立', 'success');
    await loadProjects();
  } catch {
    toast('無法連線到伺服器', 'error');
  } finally {
    btn.disabled = false;
  }
});

function resetForm() {
  state.editingId = null;
  state.bg = null;
  state.pendingImage = null;
  state.regions = [];
  state.current = [];
  state.hoverRegion = -1;
  state.equipment = [];
  document.querySelectorAll('#projectForm input, #rtsp').forEach((input) => {
    if (input.type === 'checkbox') input.checked = false;
    else input.value = input.defaultValue;
  });
  syncFuncCards();
  renderChips();
  stage.classList.remove('has-image');
  setImageInfo('');
  $('#modeLabel').textContent = '新增專案';
  setScope('global');
  highlightEditingRow();
}

function fillForm(p) {
  state.editingId = p.id;
  state.pendingImage = null;
  const scope = p.scope ?? (p.regions.length ? 'region' : 'global');
  // 全域專案存的是整張畫面座標，不當成可編輯的框選區域
  state.regions = scope === 'region'
    ? p.regions.map((r) => ({ name: r.name, points: r.points.map(([x, y]) => [x, y]) }))
    : [];
  state.current = [];
  state.hoverRegion = -1;
  // 已從清單移除的裝備不帶入，避免儲存時驗證失敗
  state.equipment = p.equipment.filter((id) => equipmentOf(id));

  $('#projectName').value = p.project_name;
  $('#rtsp').value = p.rtsp;
  $('#timeStart').value = p.detection_time.start;
  $('#timeEnd').value = p.detection_time.end;
  funcInputs().forEach((i) => (i.checked = i.value === p.function));
  $('#fenceSeconds').value = p.fence?.enter_seconds ?? $('#fenceSeconds').defaultValue;
  $('#crowdPeople').value = p.crowd?.people ?? $('#crowdPeople').defaultValue;
  $('#crowdSeconds').value = p.crowd?.enter_seconds ?? $('#crowdSeconds').defaultValue;
  syncFuncCards();
  renderChips();

  state.bg = null;
  stage.classList.remove('has-image');
  setImageInfo('');
  if (p.image) {
    const img = new Image();
    img.onload = () => {
      if (state.editingId !== p.id) return;
      setBackground(img);
      setImageInfo('使用已儲存的畫面（可按「讀取畫面」重新擷取）');
    };
    img.onerror = () => setImageInfo('找不到已儲存的畫面，請按「讀取畫面」重新擷取', true);
    img.src = `/images/${encodeURIComponent(p.image)}?v=${encodeURIComponent(p.updated_at)}`;
  }

  $('#modeLabel').textContent = `編輯中：${p.project_name}`;
  setScope(scope);
  highlightEditingRow();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#newProjectBtn').addEventListener('click', () => {
  const dirty = state.regions.length || state.current.length || $('#projectName').value.trim();
  if (dirty && !confirm('確定要放棄目前的編輯內容，建立新專案？')) return;
  resetForm();
});

// ---------- 專案列表 ----------

function downloadJson(p) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = el('a', {
    href: URL.createObjectURL(blob),
    download: `${p.project_name.replace(/[\\/:*?"<>|]/g, '_')}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

async function deleteProject(p) {
  if (!confirm(`確定刪除專案「${p.project_name}」？此動作無法復原。`)) return;
  const res = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
  if (!res.ok) {
    toast('刪除失敗', 'error');
    return;
  }
  if (state.editingId === p.id) resetForm();
  toast('已刪除', 'success');
  loadProjects();
}

function highlightEditingRow() {
  document.querySelectorAll('#projectRows tr').forEach((tr) =>
    tr.classList.toggle('editing', tr.dataset.id === state.editingId));
}

function projectRow(p) {
  const action = (text, fn, cls = '') => {
    const b = el('button', { type: 'button', className: `btn link ${cls}`, textContent: text });
    b.addEventListener('click', fn);
    return b;
  };
  const tr = el('tr', {}, [
    el('td', { textContent: p.project_name }),
    el('td', { className: 'rtsp', textContent: p.rtsp, title: p.rtsp }),
    el('td', {}, p.function ? [el('span', { className: 'badge', textContent: functionName(p.function) })] : []),
    el('td', { textContent: p.scope === 'global' ? '全域' : `${p.regions.length} 個區域` }),
    el('td', { textContent: `${p.detection_time.start}–${p.detection_time.end}` }),
    el('td', { textContent: p.updated_at.replace('T', ' ') }),
    el('td', { className: 'actions' }, [
      action('編輯', () => fillForm(p)),
      action('下載 JSON', () => downloadJson(p)),
      action('刪除', () => deleteProject(p), 'danger'),
    ]),
  ]);
  tr.dataset.id = p.id;
  return tr;
}

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    state.projects = await res.json();
  } catch {
    toast('無法載入專案列表', 'error');
    return;
  }
  $('#projectRows').replaceChildren(...state.projects.map(projectRow));
  $('#emptyProjects').hidden = state.projects.length > 0;
  highlightEditingRow();
}

$('#refreshBtn').addEventListener('click', loadProjects);

// ---------- 初始化 ----------

(async function init() {
  try {
    state.options = await (await fetch('/api/options')).json();
  } catch {
    toast('無法連線到伺服器', 'error');
  }
  buildEquipmentGrid();
  renderChips();
  setScope(state.scope);
  loadProjects();
})();
