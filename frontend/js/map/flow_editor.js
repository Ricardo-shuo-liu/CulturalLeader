// 城市「游玩流程」编辑器：双击城市进入，在这里编排点位顺序、停留时长与交通方式。
// 地图为腾讯 GL（可连续拖拽/缩放/双击放大），并支持长按点位拖拽调序、LKH TSPTW 重新优化。

import { createMapView, loadTencentMap } from './tmap_view.js';
import { bucketForHour, insertIndexForDrop } from './trip_utils.js';

const BUCKETS = [
  ['breakfast', '早餐'],
  ['lunch', '午餐'],
  ['coffee', '咖啡'],
  ['dinner', '晚餐'],
  ['night', '夜宵'],
  ['shop', '小店'],
  ['spot', '打卡'],
];

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message || `请求失败：${response.status}`;
    const error = new Error(message);
    error.code = typeof detail === 'object' ? detail?.code : undefined;
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function createFlowEditor({ onSpeak } = {}) {
  const state = {
    flows: [],
    flow: null,
    bucket: bucketForHour(new Date().getHours()),
    pois: [],
    selected: null,
    pickStart: false,
    mapView: null,
    map: null,
    mapTried: false,
    toastTimer: null,
  };

  const root = $('planner');

  function toast(message, isError = false) {
    const element = $('planner-toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
    element.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
  }

  /** 地图上的点：出发点 + 点位 + 结束点（顺序即编排顺序）。 */
  function mapPoints() {
    const flow = state.flow;
    if (!flow) return [];
    const list = [];
    if (flow.start?.lng != null) list.push({ ...flow.start, kind: 'start', id: '__start' });
    (flow.points || []).forEach((point) => list.push({ ...point, kind: 'stop' }));
    if (flow.end?.lng != null) list.push({ ...flow.end, kind: 'end', id: '__end' });
    // 段匹配：先按 id，再按名称；同名时取「还没被用过的那一个」
    // （起点名和某个点位重名很常见，例如出发点是「洛阳博物馆」，不能把两者的段混在一起）
    const byId = new Map();
    const byName = new Map();
    list.forEach((item, index) => {
      byId.set(item.id, index);
      if (!item.name) return;
      if (!byName.has(item.name)) byName.set(item.name, []);
      byName.get(item.name).push(index);
    });
    const legs = (flow.plan || {}).legs || [];
    const used = new Set();
    legs.forEach((leg) => {
      let index = byId.has(leg.from) ? byId.get(leg.from) : null;
      if (index == null && byName.has(leg.from)) {
        index = byName.get(leg.from).find((candidate) => !used.has(candidate)) ?? null;
      }
      if (index == null || used.has(index)) return;
      used.add(index);
      list[index].leg = leg;
    });
    // 兜底：还有没配上的段（名字完全对不上时），按顺序补给还没有段的前几个点
    const leftovers = legs.filter((leg) => !list.some((item) => item.leg === leg));
    list.slice(0, -1).forEach((item) => {
      if (item.leg || !leftovers.length) return;
      item.leg = leftovers.shift();
    });
    return list;
  }

  async function refreshFlowList() {
    const payload = await api('/api/flows');
    state.flows = payload.flows || [];
    const select = $('planner-flow');
    if (!select) return;
    select.innerHTML = '';
    state.flows.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      const city = item.city ? `${item.city} · ` : '';
      const plan = item.end_time ? ` · ${item.end_time} 结束` : '';
      option.textContent = `${city}${item.name}（${item.points} 点${plan}）`;
      select.appendChild(option);
    });
    if (state.flow) select.value = state.flow.id;
  }

  async function save(message) {
    if (!state.flow) return;
    state.flow = await api(`/api/flows/${state.flow.id}`, { method: 'PUT', body: state.flow });
    await refreshFlowList();
    renderAll();
    if (message) toast(message);
  }

  function ensureMap() {
    const container = $('planner-map-canvas');
    if (!container) return null;
    if (state.mapView) return state.mapView;
    state.mapView = createMapView({
      container,
      tmap: state.map,
      onStopClick: (point) => {
        if (point.kind !== 'stop') {
          // 起点/终点标记也要有反馈，否则点了像没反应
          toast(
            point.kind === 'start'
              ? `出发点是「${point.name}」（${Number(point.lng).toFixed(4)}, ${Number(point.lat).toFixed(4)}）· 可在左侧改起点`
              : `结束点是「${point.name}」`,
          );
          return;
        }
        state.selected = point.id;
        renderPoints();
        renderDetail();
        state.mapView.setSelected(point.id);
      },
      // 在真实地图上随手点一个位置 → 直接加进这条流程；「点选起点」模式下则设为出发点
      onMapClick: (point) => {
        if (state.pickStart) {
          applyStartFromMap(point);
          return;
        }
        openPicker(point);
      },
    });
    $('planner-mapkind').textContent = state.mapView.kind === 'tencent' ? '腾讯地图' : '离线矢量底图（未配置 JS Key）';
    wireMapDrag(container);
    return state.mapView;
  }

  // ── 「在地图上点一下加点位」弹窗 ──
  const picker = { el: null, point: null, token: 0 };

  function closePicker(options = {}) {
    if (picker.el) picker.el.classList.add('hidden');
    picker.point = null;
    // 取消/确认后短时间内忽略地图点击：否则那一下点击会又弹出一个新的取点卡片
    state.mapView?.ignoreClicks?.(options.ignoreMs ?? 650);
  }

  function ensurePicker() {
    if (picker.el) return picker.el;
    const container = $('planner-map-canvas');
    if (!container) return null;
    const box = document.createElement('div');
    box.className = 'map-picker hidden';
    box.innerHTML = `
      <div class="map-picker-title">在这里加一个点位</div>
      <input id="map-picker-name" type="text" placeholder="点位名称" />
      <div id="map-picker-address" class="map-picker-address">—</div>
      <div class="map-picker-actions">
        <button type="button" id="map-picker-add" class="primary">加入流程</button>
        <button type="button" id="map-picker-start">设为出发点</button>
      </div>
      <div class="map-picker-actions">
        <button type="button" id="map-picker-cancel">取消</button>
      </div>`;
    container.appendChild(box);
    // 弹窗上的操作不要冒泡成地图点击
    ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach((type) => {
      box.addEventListener(type, (event) => event.stopPropagation());
    });
    box.querySelector('#map-picker-cancel').addEventListener('click', () => {
      closePicker();
      toast('已取消，没有加入任何点位');
    });
    box.querySelector('#map-picker-add').addEventListener('click', () => addFromPicker());
    box.querySelector('#map-picker-start').addEventListener('click', () => setStartFromPicker());
    picker.el = box;
    return box;
  }

  async function openPicker(point) {
    const flow = state.flow;
    if (!flow || !Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) return;
    const box = ensurePicker();
    const container = $('planner-map-canvas');
    if (!box || !container) return;
    const rect = container.getBoundingClientRect();
    picker.point = { lng: point.lng, lat: point.lat };
    picker.token += 1;
    const token = picker.token;
    const nameInput = box.querySelector('#map-picker-name');
    nameInput.value = '';
    nameInput.placeholder = '定位中…';
    box.querySelector('#map-picker-address').textContent = `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
    box.style.left = `${Math.min(Math.max(12, (point.x ?? rect.width / 2) - 110), Math.max(12, rect.width - 250))}px`;
    box.style.top = `${Math.min(Math.max(12, (point.y ?? rect.height / 2) - 60), Math.max(12, rect.height - 176))}px`;
    box.classList.remove('hidden');
    try {
      const info = await api(`/api/poi/reverse?lng=${point.lng}&lat=${point.lat}`);
      if (token !== picker.token || !picker.point) return;
      picker.point.info = info;
      nameInput.value = info.name && info.name !== '地图取点' ? info.name : '';
      nameInput.placeholder = info.estimated ? '地图取点（可自己起名）' : '点位名称';
      box.querySelector('#map-picker-address').textContent =
        info.address || `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
    } catch (error) {
      if (token !== picker.token) return;
      nameInput.placeholder = '点位名称';
    }
    nameInput.focus();
  }

  /** 把「在地图上点选」的位置设为出发点。 */
  async function applyStartFromMap(point) {
    const flow = state.flow;
    if (!flow || !Number.isFinite(point?.lng)) return;
    state.pickStart = false;
    const name = $('planner-start-name')?.value.trim() || '出发点';
    flow.start = { name, lng: point.lng, lat: point.lat, time: flow.day_start || '09:00' };
    await save(`已把出发点定在地图的这个位置：${point.lng.toFixed(4)}, ${point.lat.toFixed(4)}`);
  }

  /** 取点卡片上的「设为出发点」：位置即出发点，不加入点位列表。 */
  async function setStartFromPicker() {
    const target = picker.point;
    if (!target) return;
    const box = picker.el;
    const info = target.info || {};
    const typed = (box?.querySelector('#map-picker-name')?.value || '').trim();
    const flow = state.flow;
    const name = typed || info.name || '出发点';
    closePicker();
    flow.start = { name, lng: target.lng, lat: target.lat, time: flow.day_start || '09:00' };
    await save(`已把出发点设为「${name}」`);
  }

  async function addFromPicker() {
    const flow = state.flow;
    const target = picker.point;
    if (!flow || !target) return;
    const box = picker.el;
    const info = target.info || {};
    const name = (box?.querySelector('#map-picker-name')?.value || '').trim() || info.name || '地图取点';
    flow.points = flow.points || [];
    flow.points.push({
      id: `pt-${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`,
      poi_id: info.poi_id || '',
      name,
      lng: target.lng,
      lat: target.lat,
      address: info.address || '',
      open_time: '',
      dwell_minutes: 60,
      fixed_time: null,
      locked: false,
    });
    if (!flow.start) {
      flow.start = { name: '出发点', lng: target.lng, lat: target.lat, time: flow.day_start || '09:00' };
    }
    closePicker();
    await save(`已在地图上加入：${name}`);
  }

  function wireMapDrag(container) {
    let pressTimer = null;
    let dragging = null;
    container.addEventListener('pointerdown', (event) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const stops = (state.mapView?.screenPositions() || []).filter((item) => item.kind === 'stop');
      const hit = stops.find((item) => Math.hypot(item.x - x, item.y - y) < 24);
      if (!hit) return;
      pressTimer = window.setTimeout(() => {
        dragging = hit;
        container.classList.add('dragging');
        toast('拖动到目标位置松手即可插入');
      }, 400);
    });
    const cancel = () => {
      window.clearTimeout(pressTimer);
      if (!dragging) return;
      dragging = null;
      container.classList.remove('dragging');
      state.map?.setStatus?.({ dragEnable: true });
    };
    container.addEventListener('pointerup', async (event) => {
      window.clearTimeout(pressTimer);
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const stopList = (state.mapView?.screenPositions() || []).filter((item) => item.kind === 'stop');
      const index = insertIndexForDrop(stopList, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      const points = state.flow?.points || [];
      const from = points.findIndex((point) => point.id === dragging.id);
      container.classList.remove('dragging');
      state.map?.setStatus?.({ dragEnable: true });
      dragging = null;
      if (from < 0) return;
      const [moved] = points.splice(from, 1);
      const target = Math.max(0, Math.min(points.length, index > from ? index - 1 : index));
      points.splice(target, 0, moved);
      await save('已手动调整顺序，点「重新优化」可再次求解');
    });
    container.addEventListener('pointerleave', cancel);
    container.addEventListener('pointercancel', cancel);
  }

  function renderPoints() {
    const list = $('planner-stops');
    const flow = state.flow;
    if (!list || !flow) return;
    list.innerHTML = '';
    if (!(flow.points || []).length) {
      list.innerHTML = '<li class="planner-empty">还没有点位：用右侧搜索或「附近推荐」加入</li>';
      return;
    }
    flow.points.forEach((point, index) => {
      const item = document.createElement('li');
      item.className = `planner-stop${state.selected === point.id ? ' active' : ''}`;
      item.innerHTML = `
        <span class="planner-stop-index">${index + 1}</span>
        <div class="planner-stop-main">
          <strong>${point.name}</strong>
          <small>${point.dwell_minutes || 60} 分钟${point.fixed_time ? ` · 固定 ${point.fixed_time}` : ''}${
        point.open_time ? ` · ${point.open_time}` : ''
      }${point.locked ? ' · 已锁定' : ''}</small>
        </div>`;
      const tools = document.createElement('div');
      tools.className = 'planner-stop-tools';
      const up = document.createElement('button');
      up.textContent = '↑';
      up.disabled = index === 0;
      up.addEventListener('click', () => movePoint(index, index - 1));
      const down = document.createElement('button');
      down.textContent = '↓';
      down.disabled = index === flow.points.length - 1;
      down.addEventListener('click', () => movePoint(index, index + 1));
      const startBtn = document.createElement('button');
      startBtn.textContent = '起';
      startBtn.title = '把这里设为出发点';
      startBtn.addEventListener('click', () => {
        flow.start = { name: point.name, lng: point.lng, lat: point.lat, time: flow.day_start || '09:00' };
        save(`已把「${point.name}」设为出发点`);
      });
      const lock = document.createElement('button');
      lock.textContent = point.locked ? '🔒' : '🔓';
      lock.title = '锁定后重新优化时保持位置';
      lock.addEventListener('click', () => {
        point.locked = !point.locked;
        save('已更新锁定状态');
      });
      const del = document.createElement('button');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        flow.points.splice(index, 1);
        save('已移除点位');
      });
      tools.append(up, down, startBtn, lock, del);
      item.appendChild(tools);
      item.addEventListener('click', (event) => {
        if (event.target.closest('.planner-stop-tools')) return;
        state.selected = point.id;
        renderPoints();
        renderDetail();
        state.mapView?.setSelected(point.id);
      });
      list.appendChild(item);
    });
  }

  function renderDetail() {
    const box = $('planner-detail');
    const flow = state.flow;
    if (!box || !flow) return;
    const point = (flow.points || []).find((item) => item.id === state.selected);
    if (!point) {
      box.classList.remove('show');
      return;
    }
    box.classList.add('show');
    box.innerHTML = `
      <header><strong>${point.name}</strong><button type="button" id="detail-close">✕</button></header>
      <div class="planner-detail-row"><label>停留时长</label>
        <input id="detail-dwell" type="number" min="10" max="720" step="10" value="${point.dwell_minutes || 60}"> 分钟</div>
      <div class="planner-detail-row"><label>固定时间</label>
        <input id="detail-fixed" type="time" value="${point.fixed_time || ''}">
        <button type="button" id="detail-fixed-clear">清除</button></div>
      <div class="planner-detail-row muted">${point.address || ''}</div>
      <div class="planner-detail-row muted">${point.open_time ? `营业时间：${point.open_time}` : '（地图服务未提供营业时间）'}</div>
      <div class="planner-detail-row">
        <button type="button" id="detail-set-start">设为出发点</button>
        <button type="button" id="detail-remove">移除该点</button>
      </div>`;
    $('detail-close').addEventListener('click', () => {
      state.selected = null;
      renderPoints();
      renderDetail();
    });
    $('detail-dwell').addEventListener('change', (event) => {
      point.dwell_minutes = Math.max(10, Number(event.target.value) || 60);
      save('已更新停留时长');
    });
    $('detail-fixed').addEventListener('change', (event) => {
      point.fixed_time = event.target.value || null;
      save(point.fixed_time ? `已设为固定 ${point.fixed_time}` : '已清除固定时间');
    });
    $('detail-fixed-clear').addEventListener('click', () => {
      point.fixed_time = null;
      save('已清除固定时间');
    });
    $('detail-set-start').addEventListener('click', () => {
      flow.start = { name: point.name, lng: point.lng, lat: point.lat, time: flow.day_start || '09:00' };
      save(`已把「${point.name}」设为出发点`);
    });
    $('detail-remove').addEventListener('click', () => {
      flow.points = (flow.points || []).filter((item) => item.id !== point.id);
      state.selected = null;
      save('已移除点位');
    });
  }

  function renderPlan() {
    const box = $('planner-plan');
    const flow = state.flow;
    if (!box || !flow) return;
    const plan = flow.plan;
    if (!plan) {
      box.textContent =
        '还没有优化结果：排好点后点「重新优化」。\n目标默认「结束最早」（含营业时间与固定预约），可切换「通勤最短」。';
      return;
    }
    const lines = [
      `求解器：${plan.solver}${plan.estimated ? '（含估算路段）' : ''}`,
      `出发点 ${plan.start_time} → 结束 ${plan.end_time}，共 ${Math.round(plan.total_minutes)} 分钟`,
      `通勤 ${Math.round(plan.travel_minutes)} 分钟 · 等待 ${Math.round(plan.waiting_minutes)} 分钟`,
      plan.relaxed_windows ? `已放宽 ${plan.relaxed_windows} 个时间窗` : '时间窗全部满足',
      '',
      ...(plan.timeline || []).map(
        (item) => `${item.arrive_text} ${item.name}${item.wait_minutes > 0 ? `（等待 ${item.wait_minutes} 分钟）` : ''}`,
      ),
    ];
    box.textContent = lines.join('\n');
  }

  function renderAll() {
    const flow = state.flow;
    if ($('planner-name')) $('planner-name').value = flow?.name || '';
    if ($('planner-city')) {
      const city = flow?.city || {};
      $('planner-city').textContent = city.name
        ? `${city.name}${city.province ? ` · ${city.province}` : ''}${city.adcode ? ` · ${city.adcode}` : ''}`
        : '';
    }
    renderPoints();
    renderDetail();
    renderPlan();
    if (!flow) return;
    $('planner-day-start').value = flow.day_start || '09:00';
    $('planner-day-end').value = flow.day_end || '20:00';
    $('planner-start-name').value = flow.start?.name && flow.start.name !== '出发点' ? flow.start.name : '';
    const startInfo = $('planner-start-info');
    if (startInfo) {
      startInfo.textContent = flow.start
        ? `出发点：${flow.start.name}（${Number(flow.start.lng).toFixed(4)}, ${Number(flow.start.lat).toFixed(4)}）· ${flow.start.time || flow.day_start || '09:00'} 出发`
        : '出发点：—（点「在地图上点选起点」或把某个点位设为起点）';
    }
    const pickBtn = $('planner-pick-start');
    if (pickBtn) {
      pickBtn.textContent = state.pickStart ? '等待你在图上点选…' : '在地图上点选起点';
      pickBtn.classList.toggle('active', state.pickStart);
    }
    document.querySelectorAll('#planner-mode button').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === (flow.transport || 'taxi'));
    });
    document.querySelectorAll('#planner-objective button').forEach((button) => {
      button.classList.toggle('active', button.dataset.objective === (flow.objective || 'makespan'));
    });
    const view = ensureMap();
    view?.setPoints({ points: mapPoints(), color: '#f2c879', city: flow.city });
  }

  async function openFlow(flowId) {
    state.flow = await api(`/api/flows/${flowId}`);
    state.selected = null;
    state.pickStart = false;
    closePicker({ ignoreMs: 0 });
    renderAll();
  }

  async function open(city) {
    root.classList.remove('hidden');
    document.body.classList.add('planner-open');
    try {
      if (!state.mapTried) {
        state.mapTried = true;
        // ?map=canvas 可强制走自建矢量底图（离线/排障/验收用）
        const forced = new URLSearchParams(window.location.search).get('map');
        try {
          if (forced === 'canvas') state.map = null;
          else {
            const config = await api('/api/config');
            state.map = await loadTencentMap({ key: config.map_js_key });
          }
        } catch (error) {
          state.map = null;
        }
      }
      await refreshFlowList();
      const wanted = String(city?.name || '').replace(/市$/, '');
      // 同城有多条流程时优先打开「已经排过点位的」，避免落到空壳流程上
      const candidates = wanted
        ? state.flows.filter((item) => String(item.city || '').replace(/市$/, '') === wanted)
        : [];
      let target = candidates.find((item) => (item.points || 0) > 0) || candidates[0] || null;
      if (!target && city?.name) {
        const created = await api('/api/flows', {
          method: 'POST',
          body: {
            name: `${city.name}游玩流程`,
            city: {
              name: city.name,
              province: city.province || '',
              adcode: city.adcode || '',
              lng: city.lng,
              lat: city.lat,
            },
          },
        });
        await refreshFlowList();
        target = { id: created.id };
      }
      if (!target) target = state.flows[0];
      if (!target) {
        toast('还没有流程：先双击一座城市', true);
        return;
      }
      await openFlow(target.id);
      renderBuckets();
      loadNearby(state.bucket);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function optimize() {
    const flow = state.flow;
    if (!flow?.points?.length) {
      toast('先加入至少一个点位', true);
      return;
    }
    toast('正在求解最优顺序…');
    try {
      const result = await api(`/api/flows/${flow.id}/optimize`, {
        method: 'POST',
        body: {
          transport: flow.transport,
          objective: flow.objective,
          day_start: flow.day_start,
          day_end: flow.day_end,
          start: flow.start,
          end: flow.end,
          keep_locked: true,
        },
      });
      state.flow = result.flow;
      await refreshFlowList();
      renderAll();
      const plan = result.plan;
      toast(`已优化：${plan.start_time} → ${plan.end_time}`);
      onSpeak?.(
        `${flow.city?.name || ''}这条流程共 ${flow.points.length} 个点位，预计 ${Math.round(plan.total_minutes)} 分钟，` +
          `从 ${plan.start_time} 出发，${plan.end_time} 结束${plan.estimated ? '（部分路段为估算）' : ''}。`,
      );
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function addPoi(poi) {
    const flow = state.flow;
    if (!flow) return;
    flow.points = flow.points || [];
    flow.points.push({
      id: `pt-${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`,
      poi_id: poi.poi_id || '',
      name: poi.name,
      lng: poi.lng,
      lat: poi.lat,
      address: poi.address || '',
      open_time: poi.open_time || '',
      dwell_minutes: 60,
      fixed_time: null,
      locked: false,
    });
    if (!flow.city?.lng) {
      flow.city = { ...(flow.city || {}), name: poi.city || flow.city?.name || '', lng: poi.lng, lat: poi.lat };
    }
    if (!flow.start) {
      flow.start = { name: '出发点', lng: poi.lng, lat: poi.lat, time: flow.day_start || '09:00' };
    }
    await save(`已加入：${poi.name}`);
  }

  async function searchPois() {
    const keyword = $('planner-search-input')?.value.trim();
    if (!keyword) return;
    const flow = state.flow;
    toast('正在搜索…');
    try {
      const result = await api(
        `/api/poi/search?keyword=${encodeURIComponent(keyword)}&city=${encodeURIComponent(flow?.city?.name || '')}`,
      );
      state.pois = result.items || [];
      renderPois(state.pois, '搜索结果');
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadNearby(bucket) {
    const flow = state.flow;
    const anchor = flow?.points?.[flow.points.length - 1] || flow?.start || flow?.city;
    if (!anchor?.lng) {
      toast('先给这条流程设置城市或出发点', true);
      return;
    }
    state.bucket = bucket;
    document.querySelectorAll('#planner-buckets button').forEach((button) => {
      button.classList.toggle('active', button.dataset.bucket === bucket);
    });
    toast('正在找附近推荐…');
    try {
      const result = await api(`/api/poi/around?lng=${anchor.lng}&lat=${anchor.lat}&bucket=${bucket}`);
      state.pois = result.items || [];
      renderPois(state.pois, `附近推荐 · ${bucket}`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderPois(items, title) {
    const box = $('planner-poi');
    if (!box) return;
    box.innerHTML = `<div class="planner-poi-title">${title}（${items.length}）</div>`;
    if (!items.length) {
      box.innerHTML += '<div class="planner-empty">没有结果：检查关键词，或在腾讯位置服务控制台确认 Key 与配额</div>';
      return;
    }
    items.forEach((poi) => {
      const row = document.createElement('div');
      row.className = 'planner-poi-item';
      row.innerHTML = `<strong>${poi.name}</strong>
        <small>${poi.type || ''}${poi.distance_m ? ` · ${Math.round(poi.distance_m)} m` : ''}${
        poi.rating ? ` · 评分 ${poi.rating}` : ''
      }</small>`;
      const add = document.createElement('button');
      add.textContent = '加入流程';
      add.addEventListener('click', () => addPoi(poi));
      row.appendChild(add);
      box.appendChild(row);
    });
  }

  function renderBuckets() {
    const wrap = $('planner-buckets');
    if (!wrap) return;
    wrap.innerHTML = '';
    BUCKETS.forEach(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.bucket = key;
      button.textContent = label;
      button.classList.toggle('active', key === state.bucket);
      button.addEventListener('click', () => loadNearby(key));
      wrap.appendChild(button);
    });
  }

  function movePoint(from, to) {
    const points = state.flow?.points;
    if (!points || to < 0 || to >= points.length) return;
    const [moved] = points.splice(from, 1);
    points.splice(to, 0, moved);
    save('已手动调整顺序，点「重新优化」可再次求解');
  }

  function exportFlow() {
    if (!state.flow) return;
    const blob = new Blob([JSON.stringify(state.flow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.flow.name || 'flow'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function wireStatic() {
    $('planner-back')?.addEventListener('click', close);
    $('planner-optimize')?.addEventListener('click', optimize);
    $('planner-name')?.addEventListener('change', async (event) => {
      state.flow.name = event.target.value.trim() || state.flow.name;
      await save('已重命名流程');
    });
    $('planner-flow')?.addEventListener('change', async (event) => {
      await openFlow(event.target.value);
    });
    $('planner-new')?.addEventListener('click', async () => {
      const city = state.flow?.city || {};
      const created = await api('/api/flows', {
        method: 'POST',
        body: { name: `${city.name || '新'}游玩流程`, city },
      });
      await refreshFlowList();
      await openFlow(created.id);
      toast('已新建流程');
    });
    $('planner-copy')?.addEventListener('click', async () => {
      if (!state.flow) return;
      const copy = await api(`/api/flows/${state.flow.id}/duplicate`, { method: 'POST', body: {} });
      await refreshFlowList();
      await openFlow(copy.id);
      toast('已另存为副本');
    });
    $('planner-delete')?.addEventListener('click', async () => {
      if (!state.flow) return;
      const id = state.flow.id;
      await api(`/api/flows/${id}`, { method: 'DELETE' });
      state.flow = null;
      await refreshFlowList();
      if (state.flows[0]) await openFlow(state.flows[0].id);
      else renderAll();
      toast('已删除流程');
    });
    $('planner-export')?.addEventListener('click', exportFlow);
    $('planner-import')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const created = await api('/api/flows/import', { method: 'POST', body: JSON.parse(await file.text()) });
          await refreshFlowList();
          await openFlow(created.id);
          toast('已导入流程');
        } catch (error) {
          toast(error.message, true);
        }
      });
      input.click();
    });
    $('planner-selftest')?.addEventListener('click', async () => {
      toast('正在自检地图服务 Key…');
      try {
        const result = await api('/api/map/selftest');
        const lines = (result.checks || []).map((item) => `${item.ok ? '✅' : '❌'} ${item.name}：${item.hint}`);
        toast(result.ok ? '地图服务配置正常' : '地图服务配置有问题，详见提示');
        const box = $('planner-plan');
        if (box) box.textContent = `地图服务自检结果\n${lines.join('\n')}`;
      } catch (error) {
        toast(error.message, true);
      }
    });
    $('planner-search-btn')?.addEventListener('click', searchPois);
    $('planner-search-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchPois();
    });
    // 起点：① 在地图上点选 ② 用第一个点位 ③ 回到城市中心
    $('planner-pick-start')?.addEventListener('click', () => {
      state.pickStart = !state.pickStart;
      renderAll();
      toast(
        state.pickStart ? '在地图上点一下，那一点就会成为出发点（不会新增点位）' : '已退出点选起点模式',
        false,
      );
    });
    $('planner-set-start')?.addEventListener('click', async () => {
      const flow = state.flow;
      const name = $('planner-start-name').value.trim() || '出发点';
      const anchor = flow?.points?.[0] || flow?.city;
      if (!anchor?.lng) {
        toast('先加入一个点位或选择城市', true);
        return;
      }
      flow.start = { name, lng: anchor.lng, lat: anchor.lat, time: flow.day_start || '09:00' };
      await save(`已设置出发点：${name}`);
    });
    $('planner-reset-start')?.addEventListener('click', async () => {
      const flow = state.flow;
      if (!flow?.city?.lng) {
        toast('这条流程还没有城市中心，先双击一座城市', true);
        return;
      }
      flow.start = { name: '出发点', lng: flow.city.lng, lat: flow.city.lat, time: flow.day_start || '09:00' };
      await save('出发点已改回城市中心');
    });
    $('planner-start-name')?.addEventListener('change', async (event) => {
      const flow = state.flow;
      if (!flow) return;
      const name = event.target.value.trim() || '出发点';
      if (flow.start) flow.start.name = name;
      await save(`出发点名称：${name}`);
    });
    document.querySelectorAll('#planner-mode button').forEach((button) => {
      button.addEventListener('click', async () => {
        state.flow.transport = button.dataset.mode;
        await save(`出行方式：${button.textContent}`);
      });
    });
    document.querySelectorAll('#planner-objective button').forEach((button) => {
      button.addEventListener('click', async () => {
        state.flow.objective = button.dataset.objective;
        await save(`优化目标：${button.textContent}`);
      });
    });
    $('planner-day-start')?.addEventListener('change', async (event) => {
      state.flow.day_start = event.target.value;
      if (state.flow.start) state.flow.start.time = event.target.value;
      await save('已更新出发时间');
    });
    $('planner-day-end')?.addEventListener('change', async (event) => {
      state.flow.day_end = event.target.value;
      await save('已更新结束时间');
    });
  }

  function close() {
    state.pickStart = false;
    closePicker({ ignoreMs: 0 });
    root.classList.add('hidden');
    document.body.classList.remove('planner-open');
  }

  wireStatic();

  return {
    open,
    close,
    isOpen: () => !root.classList.contains('hidden'),
    openFlow,
    reload: async () => {
      if (!state.flow) return;
      await refreshFlowList();
      await openFlow(state.flow.id);
    },
    get current() {
      return state.flow;
    },
    /** 回到全览（指北针同款动作，自动化验收也会用到）。 */
    fit: () => state.mapView?.fit?.(),
    /** 腾讯地图实例（自动化验收 / 排障用）。 */
    mapInstance: () => state.mapView?.map || null,
    /** 自动化验收用：地图引擎、缩放、中心点与点位数量。 */
    debug: () => {
      const map = state.mapView?.debugState?.() || {};
      return {
        ...map,
        flowId: state.flow?.id || null,
        city: state.flow?.city?.name || '',
        points: (state.flow?.points || []).length,
        mapPoints: map.points ?? 0,
        kind: state.mapView?.kind || (state.map ? 'tencent' : 'canvas'),
        hasTMap: Boolean(window.TMap),
      };
    },
  };
}
