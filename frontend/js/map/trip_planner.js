// 行程工作台：逐日编排、真实地图、拖拽调序、重新优化、附近推荐、导入导出。

import { createMapView, loadTencentMap } from './tencent_view.js';
import { bucketForHour, dayColor, insertIndexForDrop } from './trip_utils.js';

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
  const payload = text ? JSON.parse(text) : null;
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

export function createTripPlanner({ onSpeak } = {}) {
  const state = {
    trips: [],
    trip: null,
    dayIndex: 1,
    bucket: bucketForHour(new Date().getHours()),
    pois: [],
    selected: null,
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
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
  }

  function currentDay() {
    if (!state.trip) return null;
    return (state.trip.days || []).find((day) => Number(day.index) === Number(state.dayIndex)) || state.trip.days[0];
  }

  async function ensureTrip(city) {
    state.trips = await api('/api/trips');
    if (state.trips.length) {
      state.trip = await api(`/api/trips/${state.trips[0].id}`);
    } else {
      state.trip = await api('/api/trips', {
        method: 'POST',
        body: { name: city?.name ? `${city.name}行程` : '我的行程', days: 1, city: city || null },
      });
    }
    state.dayIndex = state.trip.days[0]?.index ?? 1;
  }

  async function save(message) {
    state.trip = await api(`/api/trips/${state.trip.id}`, { method: 'PUT', body: state.trip });
    await refreshTripList();
    renderAll();
    if (message) toast(message);
  }

  async function refreshTripList() {
    state.trips = await api('/api/trips');
    const select = $('planner-trip');
    if (!select) return;
    select.innerHTML = '';
    state.trips.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name}（${item.days} 天 · ${item.stops} 点）`;
      select.appendChild(option);
    });
    if (state.trip) select.value = state.trip.id;
  }

  function renderDays() {
    const wrap = $('planner-days');
    if (!wrap || !state.trip) return;
    wrap.innerHTML = '';
    state.trip.days.forEach((day) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `planner-day${Number(day.index) === Number(state.dayIndex) ? ' active' : ''}`;
      button.style.setProperty('--day-color', dayColor(Number(day.index) - 1));
      button.innerHTML = `<span>第 ${day.index} 天</span><small>${day.city?.name || '未选城市'} · ${(day.stops || []).length} 点</small>`;
      button.addEventListener('click', () => {
        state.dayIndex = day.index;
        state.selected = null;
        renderAll();
      });
      wrap.appendChild(button);
    });
  }

  function renderStops() {
    const list = $('planner-stops');
    const day = currentDay();
    if (!list || !day) return;
    list.innerHTML = '';
    if (!day.stops?.length) {
      list.innerHTML = '<li class="planner-empty">还没有点位：用右侧搜索或「附近推荐」加入</li>';
      return;
    }
    day.stops.forEach((stop, index) => {
      const item = document.createElement('li');
      item.className = `planner-stop${state.selected === stop.id ? ' active' : ''}`;
      item.innerHTML = `
        <span class="planner-stop-index">${index + 1}</span>
        <div class="planner-stop-main">
          <strong>${stop.name}</strong>
          <small>${stop.dwell_minutes || 60} 分钟${stop.fixed_time ? ` · 固定 ${stop.fixed_time}` : ''}${stop.open_time ? ` · ${stop.open_time}` : ''}${
            stop.locked ? ' · 已锁定' : ''
          }</small>
        </div>`;
      const tools = document.createElement('div');
      tools.className = 'planner-stop-tools';
      const up = document.createElement('button');
      up.textContent = '↑';
      up.disabled = index === 0;
      up.addEventListener('click', () => moveStop(index, index - 1));
      const down = document.createElement('button');
      down.textContent = '↓';
      down.disabled = index === day.stops.length - 1;
      down.addEventListener('click', () => moveStop(index, index + 1));
      const lock = document.createElement('button');
      lock.textContent = stop.locked ? '🔒' : '🔓';
      lock.title = '锁定后重新优化时保持位置';
      lock.addEventListener('click', () => {
        stop.locked = !stop.locked;
        save('已更新锁定状态');
      });
      const del = document.createElement('button');
      del.textContent = '✕';
      del.addEventListener('click', () => {
        day.stops.splice(index, 1);
        save('已移除点位');
      });
      tools.append(up, down, lock, del);
      item.appendChild(tools);
      item.addEventListener('click', (event) => {
        if (event.target.closest('.planner-stop-tools')) return;
        state.selected = stop.id;
        renderStops();
        renderDetail();
        state.mapView?.setSelected(stop.id);
      });
      list.appendChild(item);
    });
  }

  function renderDetail() {
    const box = $('planner-detail');
    const day = currentDay();
    if (!box || !day) return;
    const stop = (day.stops || []).find((item) => item.id === state.selected);
    if (!stop) {
      box.classList.remove('show');
      return;
    }
    box.classList.add('show');
    box.innerHTML = `
      <header><strong>${stop.name}</strong><button type="button" id="detail-close">✕</button></header>
      <div class="planner-detail-row"><label>停留时长</label>
        <input id="detail-dwell" type="number" min="10" max="600" step="10" value="${stop.dwell_minutes || 60}"> 分钟</div>
      <div class="planner-detail-row"><label>固定时间</label>
        <input id="detail-fixed" type="time" value="${stop.fixed_time || ''}">
        <button type="button" id="detail-fixed-clear">清除</button></div>
      <div class="planner-detail-row muted">${stop.address || ''}</div>
      <div class="planner-detail-row muted">${stop.open_time ? `营业时间：${stop.open_time}` : '（地图服务未提供营业时间）'}</div>
      <div class="planner-detail-row">
        <button type="button" id="detail-set-start">设为当天出发点</button>
        <button type="button" id="detail-remove">移除该点</button>
      </div>`;
    $('detail-close').addEventListener('click', () => {
      state.selected = null;
      renderStops();
      renderDetail();
    });
    $('detail-dwell').addEventListener('change', (event) => {
      stop.dwell_minutes = Math.max(10, Number(event.target.value) || 60);
      save('已更新停留时长');
    });
    $('detail-fixed').addEventListener('change', (event) => {
      stop.fixed_time = event.target.value || null;
      save(stop.fixed_time ? `已设为固定 ${stop.fixed_time}` : '已清除固定时间');
    });
    $('detail-fixed-clear').addEventListener('click', () => {
      stop.fixed_time = null;
      save('已清除固定时间');
    });
    $('detail-set-start').addEventListener('click', () => {
      day.start = { name: stop.name, lng: stop.lng, lat: stop.lat, time: day.day_start || '09:00' };
      save(`已把「${stop.name}」设为出发点`);
    });
    $('detail-remove').addEventListener('click', () => {
      day.stops = (day.stops || []).filter((item) => item.id !== stop.id);
      state.selected = null;
      save('已移除点位');
    });
  }

  function renderPlan() {
    const box = $('planner-plan');
    const day = currentDay();
    if (!box || !day) return;
    const plan = day.plan;
    if (!plan) {
      box.textContent = '还没有优化结果：排好点后点「重新优化」';
      return;
    }
    const lines = [
      `求解器：${plan.solver}${plan.estimated ? '（含估算路段）' : ''}`,
      `出发点 ${plan.start_time} → 结束 ${plan.end_time}，共 ${Math.round(plan.total_minutes)} 分钟`,
      `通勤 ${Math.round(plan.travel_minutes)} 分钟 · 等待 ${Math.round(plan.waiting_minutes)} 分钟`,
      plan.relaxed_windows ? `已放宽 ${plan.relaxed_windows} 个时间窗` : '时间窗全部满足',
      '',
      ...(plan.timeline || []).map((item) => `${item.arrive_text} ${item.name}${item.wait_minutes > 0 ? `（等待 ${item.wait_minutes} 分钟）` : ''}`),
    ];
    box.textContent = lines.join('\n');
  }

  function ensureMap() {
    const container = $('planner-map-canvas');
    if (!container) return null;
    if (state.mapView) return state.mapView;
    state.mapView = createMapView({
      container,
      tmap: state.map,
      onStopClick: (point) => {
        if (point.kind !== 'stop') return;
        state.selected = point.id;
        renderStops();
        renderDetail();
        state.mapView.setSelected(point.id);
      },
    });
    $('planner-mapkind').textContent = state.mapView.kind === 'tencent' ? '腾讯地图' : '示意图（未配置 JS Key）';
    wireMapDrag(container);
    return state.mapView;
  }

  function wireMapDrag(container) {
    let pressTimer = null;
    let dragging = null;
    container.addEventListener('pointerdown', (event) => {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const stops = state.mapView?.stopScreenPositions().filter((item) => item.kind === 'stop') || [];
      const hit = stops.find((item) => Math.hypot(item.x - x, item.y - y) < 24);
      if (!hit) return;
      pressTimer = window.setTimeout(() => {
        dragging = hit;
        container.classList.add('dragging');
        toast('拖动到目标位置松手即可插入');
      }, 400);
    });
    container.addEventListener('pointerup', (event) => {
      window.clearTimeout(pressTimer);
      container.classList.remove('dragging');
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const stops = state.mapView?.stopScreenPositions().filter((item) => item.kind === 'stop') || [];
      const index = insertIndexForDrop(stops, { x, y });
      const day = currentDay();
      const from = (day.stops || []).findIndex((stop) => stop.id === dragging.id);
      if (from >= 0) {
        const [moved] = day.stops.splice(from, 1);
        const target = Math.max(0, Math.min(day.stops.length, index > from ? index - 1 : index));
        day.stops.splice(target, 0, moved);
        day.manual = true;
        save('已手动调整顺序，点「重新优化」可再次求解');
      }
      dragging = null;
    });
    container.addEventListener('pointerleave', () => {
      window.clearTimeout(pressTimer);
      dragging = null;
      container.classList.remove('dragging');
    });
  }

  async function ensureCityOptions() {
    const select = $('planner-city-select');
    if (!select) return;
    if (!state.cityOptions) {
      try {
        const payload = await api('/api/geo/cities');
        state.cityOptions = payload.cities || [];
      } catch (error) {
        state.cityOptions = [];
      }
      select.innerHTML = '';
      state.cityOptions
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .forEach((city) => {
          const option = document.createElement('option');
          option.value = city.adcode || city.name;
          option.textContent = `${city.name}${city.province ? ` · ${city.province}` : ''}`;
          option.dataset.lng = city.lng;
          option.dataset.lat = city.lat;
          option.dataset.adcode = city.adcode || '';
          select.appendChild(option);
        });
    }
    const day = currentDay();
    if (day?.city?.name) {
      const match = Array.from(select.options).find((option) => option.textContent.startsWith(day.city.name));
      if (match) select.value = match.value;
    }
  }

  function renderAll() {
    const day = currentDay();
    $('planner-name').textContent = state.trip?.name || '行程规划';
    $('planner-city').textContent = day?.city?.name ? `第 ${day.index} 天 · ${day.city.name}` : '';
    renderDays();
    renderStops();
    renderDetail();
    renderPlan();
    if (day) {
      day.color = dayColor(Number(day.index) - 1);
      $('planner-day-start').value = day.day_start || '09:00';
      $('planner-day-end').value = day.day_end || '20:00';
      $('planner-start-name').value = day.start?.name && day.start.name !== '出发点' ? day.start.name : '';
      document.querySelectorAll('#planner-mode button').forEach((button) => {
        button.classList.toggle('active', button.dataset.mode === (day.mode || 'taxi'));
      });
      document.querySelectorAll('#planner-objective button').forEach((button) => {
        button.classList.toggle('active', button.dataset.objective === (day.objective || 'makespan'));
      });
      const view = ensureMap();
      view?.setDay(day);
      view?.refresh();
    }
  }

  async function optimize() {
    const day = currentDay();
    if (!day?.stops?.length) {
      toast('先加入至少一个点位', true);
      return;
    }
    toast('正在求解最优顺序…');
    try {
      const result = await api(`/api/trips/${state.trip.id}/days/${day.index}/optimize`, {
        method: 'POST',
        body: {
          mode: day.mode,
          objective: day.objective,
          start: day.start,
          end: day.end,
          keep_locked: true,
        },
      });
      const target = (state.trip.days || []).find((item) => Number(item.index) === Number(day.index));
      if (target) target.plan = result.plan;
      await save();
      const plan = result.plan;
      toast(`已优化：${plan.start_time} → ${plan.end_time}`);
      onSpeak?.(
        `第 ${day.index} 天共 ${day.stops.length} 个点位，预计 ${Math.round(plan.total_minutes)} 分钟，` +
          `从 ${plan.start_time} 出发，${plan.end_time} 结束${plan.estimated ? '（部分路段为估算）' : ''}。`,
      );
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function addPoi(poi) {
    const day = currentDay();
    if (!day) return;
    day.stops = day.stops || [];
    day.stops.push({
      id: `stop-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
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
    if (!day.city?.lng) {
      day.city = { name: poi.city || day.city?.name || '', lng: poi.lng, lat: poi.lat };
    }
    if (!day.start) {
      day.start = { name: '出发点', lng: poi.lng, lat: poi.lat, time: day.day_start || '09:00' };
    }
    await save(`已加入第 ${day.index} 天：${poi.name}`);
  }

  async function searchPois() {
    const keyword = $('planner-search-input').value.trim();
    if (!keyword) return;
    const day = currentDay();
    toast('正在搜索…');
    try {
      const result = await api(`/api/poi/search?keyword=${encodeURIComponent(keyword)}&city=${encodeURIComponent(day?.city?.name || '')}`);
      state.pois = result.items || [];
      renderPois(state.pois, '搜索结果');
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadNearby(bucket) {
    const day = currentDay();
    const anchor = day?.stops?.[day.stops.length - 1] || day?.start || day?.city;
    if (!anchor?.lng) {
      toast('先给当天设置城市或出发点', true);
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
      add.textContent = '加入当天';
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

  function moveStop(from, to) {
    const day = currentDay();
    if (!day || to < 0 || to >= day.stops.length) return;
    const [moved] = day.stops.splice(from, 1);
    day.stops.splice(to, 0, moved);
    day.manual = true;
    save('已手动调整顺序');
  }

  function exportTrip() {
    const blob = new Blob([JSON.stringify(state.trip, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.trip.name || 'trip'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importTrip() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        state.trip = await api('/api/trips/import', { method: 'POST', body: payload });
        state.dayIndex = state.trip.days[0]?.index ?? 1;
        await refreshTripList();
        renderAll();
        toast('已导入行程');
      } catch (error) {
        toast(error.message, true);
      }
    });
    input.click();
  }

  function wireStatic() {
    $('planner-back')?.addEventListener('click', close);
    $('planner-optimize')?.addEventListener('click', optimize);
    $('planner-new')?.addEventListener('click', async () => {
      const city = currentDay()?.city || null;
      state.trip = await api('/api/trips', { method: 'POST', body: { name: '新行程', days: 1, city } });
      state.dayIndex = 1;
      await refreshTripList();
      renderAll();
      toast('已新建行程');
    });
    $('planner-add-day')?.addEventListener('click', async () => {
      const last = state.trip.days[state.trip.days.length - 1];
      const nextIndex = (last?.index || 0) + 1;
      state.trip.days.push({
        index: nextIndex,
        city: last?.city || {},
        mode: last?.mode || 'taxi',
        objective: last?.objective || 'makespan',
        day_start: '09:00',
        day_end: '20:00',
        start: null,
        end: null,
        stops: [],
        manual: false,
        plan: null,
      });
      state.dayIndex = nextIndex;
      await save(`已增加第 ${nextIndex} 天`);
    });
    $('planner-city-select')?.addEventListener('change', async (event) => {
      const option = event.target.selectedOptions[0];
      if (!option) return;
      const day = currentDay();
      day.city = {
        name: option.textContent.split(' · ')[0],
        province: option.textContent.split(' · ')[1] || '',
        adcode: option.dataset.adcode || '',
        lng: Number(option.dataset.lng),
        lat: Number(option.dataset.lat),
      };
      day.start = { name: '出发点', lng: day.city.lng, lat: day.city.lat, time: day.day_start || '09:00' };
      await save(`第 ${day.index} 天城市改为 ${day.city.name}`);
      state.mapView?.refresh?.();
    });

    $('planner-trip')?.addEventListener('change', async (event) => {
      state.trip = await api(`/api/trips/${event.target.value}`);
      state.dayIndex = state.trip.days[0]?.index ?? 1;
      renderAll();
    });
    $('planner-export')?.addEventListener('click', exportTrip);
    $('planner-import')?.addEventListener('click', importTrip);
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
    $('planner-set-start')?.addEventListener('click', async () => {
      const day = currentDay();
      const name = $('planner-start-name').value.trim() || '出发点';
      const anchor = day.stops?.[0] || day.city;
      if (!anchor?.lng) {
        toast('先加入一个点位或选择城市', true);
        return;
      }
      day.start = { name, lng: anchor.lng, lat: anchor.lat, time: day.day_start || '09:00' };
      await save(`已设置出发点：${name}`);
    });
    document.querySelectorAll('#planner-mode button').forEach((button) => {
      button.addEventListener('click', async () => {
        currentDay().mode = button.dataset.mode;
        await save(`出行方式：${button.textContent}`);
      });
    });
    document.querySelectorAll('#planner-objective button').forEach((button) => {
      button.addEventListener('click', async () => {
        currentDay().objective = button.dataset.objective;
        await save(`优化目标：${button.textContent}`);
      });
    });
    $('planner-day-start')?.addEventListener('change', async (event) => {
      const day = currentDay();
      day.day_start = event.target.value;
      if (day.start) day.start.time = event.target.value;
      await save('已更新出发时间');
    });
    $('planner-day-end')?.addEventListener('change', async (event) => {
      currentDay().day_end = event.target.value;
      await save('已更新结束时间');
    });
  }

  async function open(city) {
    root.classList.remove('hidden');
    document.body.classList.add('planner-open');
    try {
      if (!state.trip) await ensureTrip(city);
      else if (city) {
        const day = currentDay();
        if (day && (!day.city?.name || !(day.stops || []).length)) {
          day.city = { name: city.name, adcode: city.adcode, lng: city.lng, lat: city.lat };
          if (!day.start) day.start = { name: '出发点', lng: city.lng, lat: city.lat, time: day.day_start || '09:00' };
          await save();
        } else if (day && day.city?.name !== city.name) {
          const nextIndex = (state.trip.days[state.trip.days.length - 1]?.index || 0) + 1;
          state.trip.days.push({
            index: nextIndex,
            city: { name: city.name, adcode: city.adcode, lng: city.lng, lat: city.lat },
            mode: day.mode || 'taxi',
            objective: day.objective || 'makespan',
            day_start: '09:00',
            day_end: '20:00',
            start: { name: '出发点', lng: city.lng, lat: city.lat, time: '09:00' },
            end: null,
            stops: [],
            manual: false,
            plan: null,
          });
          state.dayIndex = nextIndex;
          await save();
        }
      }
      if (!state.mapTried) {
        state.mapTried = true;
        try {
          const config = await api('/api/config');
          state.map = await loadTencentMap({ key: config.map_js_key });
        } catch (error) {
          state.map = null;
        }
      }
      await refreshTripList();
      await ensureCityOptions();
      renderBuckets();
      renderAll();
      loadNearby(state.bucket);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function close() {
    root.classList.add('hidden');
    document.body.classList.remove('planner-open');
  }

  wireStatic();

  return {
    open,
    close,
    isOpen: () => !root.classList.contains('hidden'),
    reload: async () => {
      if (!state.trip) return;
      state.trip = await api(`/api/trips/${state.trip.id}`);
      state.dayIndex = state.trip.days[0]?.index ?? state.dayIndex;
      await refreshTripList();
      renderAll();
    },
  };
}
