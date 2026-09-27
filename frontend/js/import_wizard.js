// 「抄作业」导入向导：链接 / 正文 / 截图 → 解析 → 地图确认 → 生成计划块与草稿攻略。

import { createMapView, loadTencentMap } from './map/tmap_view.js';

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
    throw error;
  }
  return payload;
}

export function createImportWizard({ onCommitted } = {}) {
  const state = {
    record: null,
    step: 1,
    engine: 'auto',
    selected: new Set(),
    locating: null,
    map: null,
    mapView: null,
    mapTried: false,
    toastTimer: null,
  };
  const root = $('import-wizard');

  function toast(message, isError = false) {
    const element = $('import-toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
    element.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => element.classList.remove('show'), 3600);
  }

  function stepNodes() {
    return {
      1: $('import-step1'),
      2: $('import-step2'),
      3: $('import-step3'),
    };
  }

  function showStep(step) {
    state.step = step;
    Object.entries(stepNodes()).forEach(([key, node]) => {
      if (node) node.classList.toggle('hidden', Number(key) !== step);
    });
    document.querySelectorAll('#import-steps span').forEach((node) => {
      node.classList.toggle('active', Number(node.dataset.step) <= step);
    });
    if (step === 3) ensureMap();
  }

  // ── 第一步：来源输入 ──
  async function startParse() {
    const url = $('import-url')?.value.trim() || '';
    const text = $('import-text')?.value.trim() || '';
    if (!url && !text) {
      toast('粘贴一个链接，或把攻略正文贴进来', true);
      return;
    }
    toast('正在解析攻略…');
    try {
      const payload = await api('/api/imports', { method: 'POST', body: { url, text, engine: state.engine } });
      applyRecord(payload.import);
      toast(`解析出 ${state.record.days.length} 天、${countPlaces()} 个地点`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function parseImages(files) {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).slice(0, 4).forEach((file) => form.append('files', file));
    toast('正在识别截图…');
    try {
      const response = await fetch('/api/imports/image', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || '截图解析失败');
      }
      applyRecord(payload.import);
      toast(`识别出 ${state.record.days.length} 天、${countPlaces()} 个地点`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function countPlaces() {
    return (state.record?.days || []).reduce((sum, day) => sum + (day.places?.length || 0), 0);
  }

  function applyRecord(record) {
    state.record = record;
    state.selected = new Set();
    (record.days || []).forEach((day) => {
      (day.places || []).forEach((place) => state.selected.add(`${day.day}|${place.name}`));
    });
    renderReview();
    renderConfirm();
    showStep(2);
  }

  // ── 第二步：预览与勾选 ──
  function renderReview() {
    const box = $('import-review');
    if (!box || !state.record) return;
    box.innerHTML = '';
    $('import-title').value = state.record.title || '导入攻略';
    state.record.days.forEach((day) => {
      const card = document.createElement('section');
      card.className = 'import-day';
      card.innerHTML = `<header><strong>第 ${day.day} 天</strong>
        <input class="import-city" type="text" value="${day.city || ''}" placeholder="城市（如：西安）" />
        <span class="import-count">${(day.places || []).length} 个地点</span></header>`;
      const list = document.createElement('div');
      list.className = 'import-places';
      (day.places || []).forEach((place) => {
        const key = `${day.day}|${place.name}`;
        const row = document.createElement('div');
        row.className = 'import-place';
        const confirmed = place.status === 'confirmed';
        row.innerHTML = `
          <label><input type="checkbox" ${state.selected.has(key) ? 'checked' : ''} /></label>
          <input class="ip-name" type="text" value="${place.name}" />
          <input class="ip-time" type="time" value="${place.time || ''}" />
          <input class="ip-dwell" type="number" min="15" max="600" step="15" value="${place.dwell_minutes || 60}" />
          <span class="ip-status ${confirmed ? 'ok' : 'pending'}">${confirmed ? '已定位' : '待定位'}</span>`;
        const checkbox = row.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) state.selected.add(key);
          else state.selected.delete(key);
          updateSummary();
        });
        row.querySelector('.ip-name').addEventListener('change', (event) => {
          place.name = event.target.value.trim() || place.name;
        });
        row.querySelector('.ip-time').addEventListener('change', (event) => {
          place.time = event.target.value;
        });
        row.querySelector('.ip-dwell').addEventListener('change', (event) => {
          place.dwell_minutes = Math.max(15, Number(event.target.value) || 60);
        });
        list.appendChild(row);
      });
      card.appendChild(list);
      const cityInput = card.querySelector('.import-city');
      cityInput.addEventListener('change', async () => {
        day.city = cityInput.value.trim();
        try {
          const payload = await api(`/api/imports/${state.record.id}/resolve`, {
            method: 'POST',
            body: { day: day.day },
          });
          applyRecord(payload.import);
          toast(`第 ${day.day} 天按「${day.city || '未知城市'}」重新定位`);
        } catch (error) {
          toast(error.message, true);
        }
      });
      box.appendChild(card);
    });
    updateSummary();
  }

  function selectedPlaces() {
    return state.record.days
      .map((day) => ({
        day,
        places: (day.places || []).filter((place) => state.selected.has(`${day.day}|${place.name}`)),
      }))
      .filter((entry) => entry.places.length);
  }

  function updateSummary() {
    const summary = $('import-summary');
    if (!summary) return;
    const groups = selectedPlaces();
    const places = groups.reduce((sum, entry) => sum + entry.places.length, 0);
    const pending = groups.reduce(
      (sum, entry) => sum + entry.places.filter((place) => place.status !== 'confirmed').length,
      0,
    );
    summary.textContent = `已选 ${groups.length} 天 · ${places} 个地点 · 其中待定位 ${pending} 个`;
  }

  // ── 第三步：地图确认 ──
  async function ensureMap() {
    const container = $('import-map');
    if (!container || state.mapView) {
      renderConfirm();
      return;
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
    state.mapView = createMapView({
      container,
      tmap: state.map,
      onStopClick: (point) => {
        if (state.locating) {
          placeAt(point.lng, point.lat);
          return;
        }
        toast(`${point.name || '点位'}（${Number(point.lng).toFixed(4)}, ${Number(point.lat).toFixed(4)}）`);
      },
      onMapClick: (point) => {
        if (!state.locating) {
          toast('先点右侧「在地图上定位」，再点地图落位');
          return;
        }
        placeAt(point.lng, point.lat);
      },
    });
    renderConfirm();
    refreshMapPoints();
  }

  async function placeAt(lng, lat) {
    const target = state.locating;
    if (!target) return;
    target.place.lng = lng;
    target.place.lat = lat;
    target.place.status = 'confirmed';
    target.place.confidence = 1;
    state.locating = null;
    renderConfirm();
    refreshMapPoints();
    try {
      await api(`/api/imports/${state.record.id}/resolve`, {
        method: 'POST',
        body: {
          day: target.day.day,
          names: [target.place.name],
          confirmed: { [target.place.name]: { lng, lat } },
        },
      });
      toast(`已把「${target.place.name}」定位到地图上`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function refreshMapPoints() {
    if (!state.mapView) return;
    const points = [];
    selectedPlaces().forEach((entry) => {
      entry.places.forEach((place) => {
        if (place.status === 'confirmed' && Number.isFinite(place.lng)) {
          points.push({ id: `${entry.day.day}-${place.name}`, name: place.name, lng: place.lng, lat: place.lat, kind: 'stop' });
        }
      });
    });
    if (!points.length) {
      state.mapView.setPoints({ points: [], city: null });
      return;
    }
    state.mapView.setPoints({ points, color: '#d8b46a', city: { adcode: '' } });
  }

  function renderConfirm() {
    const box = $('import-pending');
    if (!box) return;
    const pending = [];
    selectedPlaces().forEach((entry) => {
      entry.places.forEach((place) => {
        if (place.status !== 'confirmed') pending.push({ day: entry.day, place });
      });
    });
    box.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'import-pending-head';
    head.textContent = pending.length ? `待定位 ${pending.length} 个（点「定位」后在地图上点一下）` : '全部地点都已定位 ✅';
    box.appendChild(head);
    pending.forEach(({ day, place }) => {
      const row = document.createElement('div');
      row.className = 'import-pending-item';
      row.innerHTML = `<span>第 ${day.day} 天 · ${place.name}</span>`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = state.locating?.place === place ? '请点地图…' : '在地图上定位';
      button.addEventListener('click', () => {
        state.locating = { day, place };
        renderConfirm();
        toast(`在地图上点一下「${place.name}」的位置`);
      });
      row.appendChild(button);
      box.appendChild(row);
    });
    if (state.mapView) refreshMapPoints();
  }

  // ── 生成 ──
  async function commit() {
    if (!state.record) return;
    const groups = selectedPlaces();
    if (!groups.length) {
      toast('至少勾选一个地点', true);
      return;
    }
    try {
      // 先把未勾选的点从记录里移除，再生成计划块
      state.record.days.forEach((day) => {
        day.places = day.places.filter((place) => state.selected.has(`${day.day}|${place.name}`));
      });
      state.record.days = state.record.days.filter((day) => day.places.length);
      const payload = await api(`/api/imports/${state.record.id}/commit`, { method: 'POST' });
      toast(`已生成 ${payload.flowIds.length} 个计划块`);
      onCommitted?.(payload);
      close();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function wire() {
    $('import-close')?.addEventListener('click', close);
    $('import-parse')?.addEventListener('click', startParse);
    $('import-file')?.addEventListener('change', (event) => parseImages(event.target.files));
    $('import-review-next')?.addEventListener('click', () => showStep(3));
    $('import-review-back')?.addEventListener('click', () => showStep(1));
    $('import-confirm-back')?.addEventListener('click', () => showStep(2));
    $('import-commit')?.addEventListener('click', commit);
    document.querySelectorAll('#import-engine button').forEach((button) => {
      button.addEventListener('click', () => {
        state.engine = button.dataset.engine;
        document.querySelectorAll('#import-engine button').forEach((node) => {
          node.classList.toggle('active', node.dataset.engine === state.engine);
        });
      });
    });
  }

  function open() {
    root?.classList.remove('hidden');
    document.body.classList.add('planner-open');
    showStep(state.record ? 2 : 1);
  }

  function close() {
    root?.classList.add('hidden');
    document.body.classList.remove('planner-open');
  }

  wire();

  return {
    open,
    close,
    isOpen: () => Boolean(root) && !root.classList.contains('hidden'),
    get record() {
      return state.record;
    },
  };
}
