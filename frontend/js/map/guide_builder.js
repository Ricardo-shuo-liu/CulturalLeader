// 「我的攻略」：把多座城市的游玩流程组合成一份逐日攻略（总里程 / 总时长 / 每日结束时间），
// 支持调整顺序、替换某城流程、导出 JSON 与生成只读分享链接。

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
    throw new Error(message);
  }
  return payload;
}

function minutesText(minutes) {
  const value = Math.round(Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours} 小时 ${rest} 分钟` : `${rest} 分钟`;
}

export function createGuideBuilder({ onSpeak, onPlay } = {}) {
  const state = { guides: [], guide: null, flows: [], toastTimer: null };
  const root = $('guide');

  function toast(message, isError = false) {
    const element = $('guide-toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
    element.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
  }

  async function loadLibrary() {
    const [flows, guides] = await Promise.all([api('/api/flows'), api('/api/guides')]);
    state.flows = flows.flows || [];
    state.guides = guides.guides || [];
  }

  function flowSummary(flowId) {
    return state.flows.find((item) => item.id === flowId) || null;
  }

  function renderGuideSelect() {
    const select = $('guide-select');
    if (!select) return;
    select.innerHTML = '';
    state.guides.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      const cities = (item.cities || []).filter(Boolean).join(' → ');
      option.textContent = `${item.name}${cities ? `（${cities}）` : ''}`;
      select.appendChild(option);
    });
    if (state.guide) select.value = state.guide.id;
  }

  function renderLibrary() {
    const box = $('guide-library');
    if (!box) return;
    box.innerHTML = '';
    if (!state.flows.length) {
      box.innerHTML = '<div class="planner-empty">还没有城市流程：先在沙盘上双击城市做一条流程</div>';
      return;
    }
    state.flows.forEach((flow) => {
      const row = document.createElement('div');
      row.className = 'guide-library-item';
      row.innerHTML = `<strong>${flow.name}</strong>
        <small>${flow.city || '未选城市'} · ${flow.points} 点${flow.end_time ? ` · ${flow.end_time} 结束` : ' · 未优化'}</small>`;
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = '加入下一天';
      add.addEventListener('click', () => addDay(flow.id));
      row.appendChild(add);
      box.appendChild(row);
    });
  }

  function renderItems() {
    const box = $('guide-items');
    const guide = state.guide;
    if (!box || !guide) return;
    box.innerHTML = '';
    if (!(guide.items || []).length) {
      box.innerHTML = '<div class="planner-empty">还没有选择城市流程：从下面「流程库」加入</div>';
      return;
    }
    guide.items.forEach((item, index) => {
      const flow = flowSummary(item.flowId) || item.flow || {};
      const row = document.createElement('li');
      row.className = 'guide-item';
      row.innerHTML = `
        <span class="planner-stop-index">${item.day}</span>
        <div class="planner-stop-main">
          <strong>${flow.city || '未选城市'} · ${flow.name || item.flowId}</strong>
          <small>${flow.points ?? 0} 点${flow.end_time ? ` · ${flow.end_time} 结束` : ''}${
        Number.isFinite(flow.distance_km) ? ` · ${flow.distance_km} km` : ''
      }</small>
          <input class="guide-notes" type="text" placeholder="备注（可选）" value="${item.notes || ''}">
        </div>`;
      const tools = document.createElement('div');
      tools.className = 'planner-stop-tools';
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.disabled = index === 0;
      up.addEventListener('click', () => moveItem(index, index - 1));
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.disabled = index === guide.items.length - 1;
      down.addEventListener('click', () => moveItem(index, index + 1));
      const replace = document.createElement('select');
      replace.className = 'guide-replace';
      replace.title = '替换成另一条流程';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '替换…';
      replace.appendChild(placeholder);
      state.flows.forEach((candidate) => {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = `${candidate.city || ''} ${candidate.name}`.trim();
        replace.appendChild(option);
      });
      replace.addEventListener('change', () => {
        if (!replace.value) return;
        replaceItem(index, replace.value);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '✕';
      del.addEventListener('click', () => removeItem(index));
      tools.append(up, down, replace, del);
      row.appendChild(tools);
      const notes = row.querySelector('.guide-notes');
      notes.addEventListener('change', () => {
        item.notes = notes.value;
        saveGuide('已保存备注');
      });
      box.appendChild(row);
    });
  }

  function renderTotals() {
    const box = $('guide-totals');
    const guide = state.guide;
    if (!box || !guide) return;
    const totals = guide.totals || {};
    const lines = [
      `共 ${(guide.items || []).length} 天 · 总里程 ${totals.distance_km || 0} 公里 · 总时长 ${minutesText(totals.minutes)}`,
    ];
    (guide.items || []).forEach((item) => {
      const flow = flowSummary(item.flowId) || item.flow || {};
      const leg = item.leg ? `（城际 ${Math.round(item.leg.minutes)} 分钟 / ${item.leg.distance_km} km${item.leg.estimated ? ' 估算' : ''}）` : '';
      lines.push(
        `第 ${item.day} 天 · ${flow.city || ''} ${flow.name || ''}｜${flow.points ?? 0} 点｜${
          flow.end_time ? `${flow.end_time} 结束` : '未优化'
        }${flow.distance_km ? `｜${flow.distance_km} km` : ''}${leg}${item.notes ? `｜${item.notes}` : ''}`,
      );
    });
    box.textContent = lines.join('\n');
  }

  function renderAll() {
    renderGuideSelect();
    renderLibrary();
    renderItems();
    renderTotals();
    const nameInput = $('guide-name');
    if (nameInput && state.guide) nameInput.value = state.guide.name || '';
  }

  async function saveGuide(message) {
    if (!state.guide) return;
    const payload = { name: state.guide.name, items: state.guide.items };
    state.guide = state.guide.id
      ? await api(`/api/guides/${state.guide.id}`, { method: 'PUT', body: payload })
      : await api('/api/guides', { method: 'POST', body: payload });
    await loadLibrary();
    renderAll();
    if (message) toast(message);
  }

  async function openGuide(guideId) {
    state.guide = await api(`/api/guides/${guideId}`);
    renderAll();
  }

  async function addDay(flowId) {
    if (!state.guide) state.guide = { id: null, name: '我的攻略', items: [] };
    state.guide.items = state.guide.items || [];
    state.guide.items.push({ day: state.guide.items.length + 1, flowId, notes: '' });
    await saveGuide('已加入一天');
  }

  function moveItem(from, to) {
    const items = state.guide?.items;
    if (!items || to < 0 || to >= items.length) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    items.forEach((item, index) => {
      item.day = index + 1;
    });
    saveGuide('已调整顺序并重新计算里程');
  }

  function removeItem(index) {
    state.guide.items.splice(index, 1);
    state.guide.items.forEach((item, order) => {
      item.day = order + 1;
    });
    saveGuide('已移除一天');
  }

  function replaceItem(index, flowId) {
    state.guide.items[index].flowId = flowId;
    saveGuide('已替换该天流程');
  }

  function exportGuide() {
    if (!state.guide) return;
    const blob = new Blob([JSON.stringify(state.guide, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.guide.name || 'guide'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function share() {
    if (!state.guide?.id) {
      await saveGuide();
    }
    if (!state.guide?.id) return;
    const result = await api(`/api/guides/${state.guide.id}/share`, { method: 'POST' });
    const url = `${window.location.origin}${result.path}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`分享链接已复制：${url}`);
    } catch (error) {
      toast(`分享链接：${url}`);
    }
  }

  function wireStatic() {
    $('guide-back')?.addEventListener('click', close);
    $('guide-name')?.addEventListener('change', (event) => {
      if (!state.guide) return;
      state.guide.name = event.target.value.trim() || state.guide.name;
      saveGuide('已重命名攻略');
    });
    $('guide-new')?.addEventListener('click', async () => {
      state.guide = { id: null, name: '我的攻略', items: [] };
      renderAll();
      toast('已新建攻略：从流程库加入城市');
    });
    $('guide-select')?.addEventListener('change', (event) => {
      if (event.target.value) openGuide(event.target.value);
    });
    $('guide-save')?.addEventListener('click', () => saveGuide('已重新计算里程与时长'));
    $('guide-play')?.addEventListener('click', () => {
      if (!state.guide?.id) {
        toast('先选一份攻略，或从流程库加入几天', true);
        return;
      }
      onPlay?.(state.guide.id);
    });
    $('guide-export')?.addEventListener('click', exportGuide);
    $('guide-share')?.addEventListener('click', () => share().catch((error) => toast(error.message, true)));
    $('guide-delete')?.addEventListener('click', async () => {
      if (!state.guide?.id) return;
      await api(`/api/guides/${state.guide.id}`, { method: 'DELETE' });
      state.guide = null;
      await loadLibrary();
      if (state.guides[0]) await openGuide(state.guides[0].id);
      else renderAll();
      toast('已删除攻略');
    });
    $('guide-speak')?.addEventListener('click', () => {
      const guide = state.guide;
      if (!guide) return;
      const cities = (guide.items || [])
        .map((item) => (flowSummary(item.flowId) || item.flow || {}).city || '')
        .filter(Boolean);
      const totals = guide.totals || {};
      onSpeak?.(
        `这份攻略共 ${(guide.items || []).length} 天，途经 ${cities.join('、')}，` +
          `总里程约 ${totals.distance_km || 0} 公里，总时长约 ${Math.round(Number(totals.minutes) || 0)} 分钟。`,
      );
    });
  }

  async function open() {
    root?.classList.remove('hidden');
    document.body.classList.add('planner-open');
    try {
      await loadLibrary();
      if (!state.guide) {
        if (state.guides[0]) await openGuide(state.guides[0].id);
        else {
          state.guide = { id: null, name: '我的攻略', items: [] };
          renderAll();
        }
      } else {
        await openGuide(state.guide.id);
      }
    } catch (error) {
      toast(error.message, true);
    }
  }

  function close() {
    root?.classList.add('hidden');
    document.body.classList.remove('planner-open');
  }

  wireStatic();

  return {
    open,
    close,
    openGuide,
    isOpen: () => Boolean(root) && !root.classList.contains('hidden'),
    reload: async () => {
      await loadLibrary();
      if (state.guide?.id) await openGuide(state.guide.id);
      else renderAll();
    },
  };
}
