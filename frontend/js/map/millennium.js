// 一块土地的千年：锁定一个地点，让时间在这个点上流动。
// - 从城市卡/城市面板进入，镜头飞低并锁定该经纬度（可环绕，不移焦）
// - 底部时间轴 11 期：拖动时疆域淡出重建淡入、该点的古名/讲解/诗词随期切换、日照随代表时刻变化
// - 「历史地层」抽屉：一期一层，点击跳期
// - 与当朝数字人聊天：复用 SSE/TTS 链路，anchor 写进当前点与该期古名

import { createCityPoints } from '../citypoints.js';
import { createPoemGlow } from './poem_glow.js';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';
import { STAGE } from '../config.js';
import { smoothstep, sunAltitudeAt } from '../solar.js';

const NEARBY_KM = 30;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function haversineKm(lng1, lat1, lng2, lat2) {
  const radius = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 「06-22T19:40」+ 年份 → 北京时间 Date；现代一期没有代表时刻（用实时）。 */
export function eraLightingDate(spec, now = new Date()) {
  const match = /^(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(spec || ''));
  if (!match) return null;
  const [, month, day, hour, minute] = match.map(Number);
  const year = now.getFullYear();
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, 0));
}

/** 30km 内、除匹配点之外的历史地名（主地名优先、次级地名随后）。 */
export function nearbyPlaces(places, lng, lat, { km = NEARBY_KM, excludeId = null } = {}) {
  return (places || [])
    .filter((place) => place && place.id !== excludeId && place.lng != null && place.lat != null)
    .map((place) => ({ ...place, distance_km: haversineKm(lng, lat, Number(place.lng), Number(place.lat)) }))
    .filter((place) => place.distance_km <= km)
    .sort((a, b) => Number(Boolean(a.minor)) - Number(Boolean(b.minor)) || a.distance_km - b.distance_km);
}

/** 取名时间线（近旁参考不入选），如「栎阳 → 长安 → 大兴城 → 奉元路 → 西安」。 */
export function nameChain(eras) {
  return (eras || [])
    .filter((era) => era.matched && era.place && era.source !== "near")
    .map((era) => era.place.ancient)
    .filter((name, index, list) => name && list.indexOf(name) === index);
}

/** Node 校验：千年 payload 必须是 11 期完整结构。 */
export function validateMillenniumPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('缺少千年数据');
  const eras = payload.eras || [];
  if (eras.length !== 11) throw new Error(`时期数量异常：${eras.length}`);
  const keys = eras.map((era) => era.key);
  if (new Set(keys).size !== keys.length) throw new Error('时期 key 重复');
  eras.forEach((era) => {
    if (!era.name || !era.period) throw new Error(`${era.key} 缺名称/年代`);
    if (era.matched) {
      if (!era.place || !era.place.ancient) throw new Error(`${era.key} 匹配了但没有古名`);
      if (!['exact', 'prefix', 'near', 'curated'].includes(era.source)) throw new Error(`${era.key} 来源异常`);
    } else if (!era.note) {
      throw new Error(`${era.key} 空档没有说明`);
    }
  });
  return { eras: eras.length, matched: payload.counts?.matched ?? 0 };
}

const $ = (id) => document.getElementById(id);

const SOURCE_LABEL = {
  exact: '当朝地名',
  prefix: '当朝地名',
  near: '就近参考',
  curated: '策展补注',
};

export function createMillenniumMode({
  scene,
  camera,
  controls,
  ui,
  voice,
  narrate,
  applyOutline,
  flyTo,
  onSceneTime = () => {},
  onSceneLive = () => {},
  onEnter = () => {},
  onExit = () => {},
  closeDrawer = () => {},
} = {}) {
  const markers = { points: null, glow: null, labelEl: null, nearbyList: [], list: [] };
  const state = {
    active: false,
    city: null,
    payload: null,
    index: 0,
    dynastyCache: new Map(),
    switching: false,
    cardOpen: false,
    sessionId: null,
    streaming: false,
    assistant: null,
    lastChain: [],
  };

  async function fetchDynasty(key) {
    if (state.dynastyCache.has(key)) return state.dynastyCache.get(key);
    const response = await fetch(`/api/dynasty/${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error(`朝代数据加载失败：${response.status}`);
    const { dynasty } = await response.json();
    if (!dynasty?.outline?.length) throw new Error('朝代疆域数据不完整');
    state.dynastyCache.set(key, dynasty);
    return dynasty;
  }

  function disposeMarkers() {
    if (markers.points) {
      scene.remove(markers.points.mesh);
      markers.points.mesh.geometry.dispose();
      markers.points.material.dispose();
      markers.points = null;
    }
    if (markers.glow) {
      markers.glow.dispose();
      markers.glow = null;
    }
    markers.nearbyList = [];
    const layer = $('millennium-labels');
    if (layer) layer.innerHTML = '';
    markers.labelEl = null;
  }

  function buildLabel(place, { primary = false } = {}) {
    const layer = $('millennium-labels');
    if (!layer) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `millennium-label${primary ? ' primary' : ''}${place.minor && !primary ? ' minor' : ''}`;
    const name = document.createElement('span');
    name.className = 'ml-name';
    name.textContent = place.ancient || '';
    const modern = document.createElement('span');
    modern.className = 'ml-modern';
    modern.textContent = place.modern && place.modern !== place.ancient ? place.modern : '';
    button.append(name, modern);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openCard(primary ? 'anchor' : 'nearby', place);
    });
    layer.appendChild(button);
    return button;
  }

  function buildMarkers(era, dynasty) {
    disposeMarkers();
    const locked = era.place;
    if (!locked) return;

    const list = [];
    if (locked.ancient) list.push({ ...locked, primary: true });
    const nearby = nearbyPlaces(
      [...(dynasty.places || []), ...(dynasty.minor || [])],
      state.city.lng,
      state.city.lat,
      { excludeId: locked.id },
    ).slice(0, 4);
    markers.nearbyList = nearby;
    nearby.forEach((place) => list.push(place));

    const cities = list.map((place) => ({
      name: place.ancient,
      slug: `millennium:${era.key}:${place.id}`,
      accent_color: place.primary ? '#f2cd84' : place.minor ? '#9fb0b8' : '#e6dcc4',
      lng: place.lng,
      lat: place.lat,
    }));
    // 锁定点略有抬升，和附近地名的光点区分开
    const world = list.map((place, index) =>
      worldPosition(place.lng, place.lat, RANGES, index === 0 ? 0.06 : 0.02),
    );
    markers.points = createCityPoints(cities, world);
    markers.points.cities = cities;
    markers.points.mesh.renderOrder = 4;
    scene.add(markers.points.mesh);

    list.forEach((place, index) => {
      const element = buildLabel(place, { primary: index === 0 });
      if (index === 0) markers.labelEl = element;
      place.__label = element;
    });
    markers.list = list;

    // 诗词光字：只保留写作地落在锁定点附近的诗
    const hostPlaces = dynasty.places || [];
    const inRange = new Set(
      hostPlaces
        .filter((place) => haversineKm(state.city.lng, state.city.lat, Number(place.lng), Number(place.lat)) <= NEARBY_KM)
        .map((place) => place.id),
    );
    const poems = (dynasty.poems || []).filter((poem) => inRange.has(poem.place_id));
    if (poems.length) {
      markers.glow = createPoemGlow({
        scene,
        poems,
        places: hostPlaces,
        distance: camera.position.distanceTo(controls.target),
      });
    }
  }

  function updateBar() {
    const payload = state.payload;
    if (!payload) return;
    const era = payload.eras[state.index];
    const bar = $('millennium-bar');
    if (bar) {
      bar.classList.remove('hidden');
      bar.style.setProperty('--era-color', era.color || '#d8b46a');
    }
    $('millennium-era-name').textContent = era.name;
    const place = era.place;
    const counts = `${state.index + 1} / ${payload.eras.length}`;
    $('millennium-era-meta').textContent = place
      ? `${era.period} · ${place.ancient}${place.modern && place.modern !== place.ancient ? `（今 ${place.modern}）` : ''} · ${SOURCE_LABEL[era.source] || ''}`
      : `${era.period} · ${era.note}`;
    const position = $('millennium-position');
    if (position) position.textContent = counts;
    document.querySelectorAll('#millennium-timeline button').forEach((button, index) => {
      button.classList.toggle('active', index === state.index);
      button.classList.toggle('empty', Boolean(payload.eras[index]?.empty));
    });
    renderStrata();
  }

  function renderStrata() {
    const list = $('millennium-strata-list');
    if (!list || !state.payload) return;
    list.innerHTML = '';
    state.payload.eras.forEach((era, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `millennium-layer${index === state.index ? ' active' : ''}${era.empty ? ' empty' : ''}`;
      const title = document.createElement('span');
      title.className = 'mlr-title';
      title.textContent = `${era.name} · ${era.period}`;
      const name = document.createElement('span');
      name.className = 'mlr-name';
      name.textContent = era.place ? era.place.ancient : '未有记载';
      const line = document.createElement('span');
      line.className = 'mlr-line';
      line.textContent = era.place ? era.place.summary : era.note;
      item.append(title, name, line);
      item.addEventListener('click', () => {
        toggleStrata(false);
        setEra(index);
      });
      list.appendChild(item);
    });
  }

  function toggleStrata(open) {
    const drawer = $('millennium-strata');
    if (!drawer) return;
    const want = open ?? drawer.classList.contains('hidden');
    drawer.classList.toggle('hidden', !want);
    $('millennium-strata-toggle')?.classList.toggle('on', want);
  }

  async function renderEra({ speak = false } = {}) {
    if (!state.active || state.switching) return;
    const era = state.payload.eras[state.index];
    state.switching = true;
    const veil = $('millennium-veil');
    veil?.classList.add('show');
    try {
      const dynasty = await fetchDynasty(era.key);
      applyOutline?.(dynasty.outline, { color: dynasty.color });
      buildMarkers(era, dynasty);
      if (era.lighting) {
        const date = eraLightingDate(era.lighting);
        if (date) onSceneTime(date);
      } else {
        onSceneLive();
      }
      updateBar();
      if (state.cardOpen) openCard('anchor', era.place);
      if (speak && era.place) {
        narrate?.(
          `${era.name}，${era.place.ancient}。${era.place.summary}`.slice(0, 120),
        );
      }
    } catch (error) {
      console.warn('[millennium] 切换失败', error);
      ui?.toast?.('这一时期的资料没有展开，稍后再试');
    } finally {
      window.setTimeout(() => veil?.classList.remove('show'), 160);
      state.switching = false;
    }
  }

  function setEra(index, { speak = false } = {}) {
    if (!state.payload) return;
    const next = clamp(Number(index) || 0, 0, state.payload.eras.length - 1);
    if (next === state.index) return;
    state.index = next;
    closeCard();
    renderEra({ speak });
  }

  function step(delta) {
    setEra(state.index + delta);
  }

  // ── 卡片与对话 ────────────────────────────────────────────────

  function addLog(role, text) {
    const log = $('mc-log');
    if (!log) return null;
    const item = document.createElement('div');
    item.className = `dc-msg ${role}`;
    item.textContent = text || '';
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function openCard(kind, place) {
    const era = state.payload?.eras[state.index];
    if (!era) return;
    const card = $('millennium-card');
    if (!card) return;
    const target = place || era.place;
    if (!target) {
      // 空档期：也给一张说明卡，告诉用户此朝此地没有记载
      $('mc-title').textContent = `${era.name} · 未有记载`;
      $('mc-sub').textContent = `${era.period} · ${era.note}`;
      const body = $('mc-body');
      body.innerHTML = '';
      const kicker = document.createElement('div');
      kicker.className = 'dc-kicker';
      kicker.textContent = `${state.city.name} · 时间轴第 ${state.index + 1} 格`;
      body.appendChild(kicker);
      const line = document.createElement('p');
      line.className = 'dc-summary';
      line.textContent = `${era.note}。可以把时间轴往回拖一格，看看更早的时候这里叫什么。`;
      body.appendChild(line);
      card.classList.remove('hidden');
      state.cardOpen = true;
      return;
    }
    state.cardOpen = true;
    state.sessionId = null;
    $('mc-title').textContent = target.ancient;
    $('mc-sub').textContent = `${era.name} · ${era.period} · 今 ${state.city.name} · ${SOURCE_LABEL[era.source] || ''}`;
    const body = $('mc-body');
    body.innerHTML = '';

    const kicker = document.createElement('div');
    kicker.className = 'dc-kicker';
    kicker.textContent = `${state.city.name} · 时间轴第 ${state.index + 1} 格 · ${era.place?.kind_label || '史迹'}`;
    body.appendChild(kicker);

    const summary = document.createElement('p');
    summary.className = 'dc-summary';
    summary.textContent = target.summary || '';
    body.appendChild(summary);
    if (target.narration && target.narration !== target.summary) {
      const narration = document.createElement('p');
      narration.className = 'dc-note';
      narration.textContent = target.narration;
      body.appendChild(narration);
    }
    if (kind === 'nearby' && place) {
      const foot = document.createElement('p');
      foot.className = 'dc-footnote';
      foot.textContent = `这里离锁定点约 ${Math.round(place.distance_km)} 公里。`;
      body.appendChild(foot);
    }
    if (era.note) {
      const note = document.createElement('p');
      note.className = 'dc-footnote';
      note.textContent = era.note;
      body.appendChild(note);
    }
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'dc-play';
    play.textContent = '让当朝人讲一段';
    play.addEventListener('click', () => narrate?.(target.narration || target.summary || ''));
    body.appendChild(play);

    if (era.poems?.length) {
      const wrap = document.createElement('div');
      wrap.className = 'dc-poems';
      era.poems.slice(0, 4).forEach((poem) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dynasty-poem';
        const title = document.createElement('span');
        title.className = 'dp-title';
        title.textContent = `《${poem.title}》`;
        const meta = document.createElement('span');
        meta.className = 'dp-meta';
        meta.textContent = poem.author;
        button.append(title, meta);
        button.addEventListener('click', () => narrate?.(`${poem.title}，${poem.author}。${poem.text}`.slice(0, 120)));
        wrap.appendChild(button);
      });
      body.appendChild(wrap);
    }

    const chat = document.createElement('div');
    chat.className = 'dc-chat';
    const head = document.createElement('div');
    head.className = 'dc-chat-head';
    head.textContent = `与${era.name}的人说话 · ${target.ancient}`;
    const log = document.createElement('div');
    log.id = 'mc-log';
    log.className = 'dc-log';
    const row = document.createElement('div');
    row.className = 'dc-row';
    const input = document.createElement('input');
    input.id = 'mc-input';
    input.type = 'text';
    input.placeholder = '问点什么，例如：这里当年热闹吗？';
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = '发送';
    send.addEventListener('click', sendChat);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendChat();
      }
    });
    row.append(input, send);
    chat.append(head, log, row);
    body.appendChild(chat);
    addLog('system', `这里是${era.name}的${target.ancient}，可以问当朝人这里的事。`);
    card.classList.remove('hidden');
    window.setTimeout(() => $('mc-input')?.focus(), 150);
  }

  function closeCard() {
    state.cardOpen = false;
    state.sessionId = null;
    state.streaming = false;
    state.assistant = null;
    $('millennium-card')?.classList.add('hidden');
  }

  function anchorText() {
    const era = state.payload?.eras[state.index];
    if (!era) return null;
    const ancient = era.place?.ancient;
    const where = ancient
      ? `今${state.city.name}，${era.name}时称「${ancient}」（${era.period}）`
      : `今${state.city.name}，${era.name}（${era.period}）`;
    return `${where}。观众锁定了这一个点看时间流动。`;
  }

  async function sendChat() {
    const input = $('mc-input');
    const text = (input?.value || '').trim();
    const era = state.payload?.eras[state.index];
    if (!text || !era || !state.active) return;
    input.value = '';
    addLog('user', text);
    state.streaming = true;
    state.assistant = addLog('assistant', '');
    try {
      state.sessionId = await voice.askDynasty(era.key, {
        placeId: era.place?.id && !String(era.place.id).startsWith('curated-') ? era.place.id : null,
        message: text,
        sessionId: state.sessionId,
        anchor: anchorText(),
      });
    } catch (error) {
      addLog('system', error.message || '提问失败');
    } finally {
      state.streaming = false;
      state.assistant = null;
    }
  }

  function onToken(text) {
    if (!state.streaming) return false;
    if (!state.assistant) state.assistant = addLog('assistant', '');
    state.assistant.textContent += text;
    const log = $('mc-log');
    if (log) log.scrollTop = log.scrollHeight;
    return true;
  }

  function onSentence(text) {
    if (!state.streaming) return false;
    narrate?.(text);
    return true;
  }

  function onDone() {
    if (!state.streaming) return false;
    state.assistant = null;
    return true;
  }

  function onError(message) {
    if (!state.streaming) return false;
    addLog('system', message);
    return true;
  }

  // ── 进入与退出 ────────────────────────────────────────────────

  // 模块内的固定控件（时间轴左右、地层、退出、关卡片）在这里一次性接线
  function wire() {
    $('millennium-prev')?.addEventListener('click', () => step(-1));
    $('millennium-next')?.addEventListener('click', () => step(1));
    $('millennium-exit')?.addEventListener('click', () => close());
    $('millennium-strata-toggle')?.addEventListener('click', () => toggleStrata());
    $('millennium-strata-close')?.addEventListener('click', () => toggleStrata(false));
    $('mc-close')?.addEventListener('click', () => closeCard());
  }
  wire();

  function buildTimeline() {
    const strip = $('millennium-timeline');
    if (!strip || !state.payload) return;
    strip.innerHTML = '';
    state.payload.eras.forEach((era, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.setProperty('--era-color', era.color || '#d8b46a');
      const name = document.createElement('span');
      name.className = 'mt-name';
      name.textContent = era.name;
      const ancient = document.createElement('span');
      ancient.className = 'mt-ancient';
      ancient.textContent = era.place ? era.place.ancient : '—';
      button.append(name, ancient);
      button.addEventListener('click', () => setEra(index));
      strip.appendChild(button);
    });
  }

  async function open(city) {
    const name = String(city?.name || '').trim();
    const lng = Number(city?.lng);
    const lat = Number(city?.lat);
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      ui?.toast?.('这座城市缺少坐标，暂时进不了千年模式');
      return null;
    }
    try {
      ui?.toast?.(`正在翻开${name}的地方志…`);
      const response = await fetch(
        `/api/dynasty/millennium?name=${encodeURIComponent(name)}&lng=${lng}&lat=${lat}`,
      );
      if (!response.ok) throw new Error(`千年数据加载失败：${response.status}`);
      const payload = await response.json();
      validateMillenniumPayload(payload);
      if (payload.counts.matched < 2 && !payload.featured) {
        ui?.toast?.(`${name}在现有史料里只有 ${payload.counts.matched} 期记载，先换一座城市看看`);
        return null;
      }
      if (state.active) close({ silent: true });
      state.active = true;
      state.city = payload.city;
      state.payload = payload;
      // 从「唐」开场（最有画面感的一格），没有就退到第一个有记载的时期
      const tangIndex = payload.eras.findIndex((era) => era.key === 'tang' && era.matched);
      state.index = tangIndex >= 0 ? tangIndex : Math.max(0, payload.eras.findIndex((era) => era.matched));
      state.lastChain = nameChain(payload.eras);
      buildTimeline();
      document.body.classList.add('millennium-mode');
      closeDrawer?.();
      onEnter?.(payload);

      const target = worldPosition(lng, lat, RANGES, 0.05);
      const direction = camera.position.clone().sub(controls.target).normalize();
      const position = target.clone().add(direction.multiplyScalar(3.1));
      position.y = Math.max(position.y, target.y + 1.2);
      flyTo?.(position, target, STAGE.transitionMs);

      await renderEra({ speak: false });
      const chain = state.lastChain.slice(0, 6).join(' → ');
      ui?.toast?.(chain ? `这块土地的两千年：${chain}` : `${name} · 千年`);
      const era = payload.eras[state.index];
      if (era?.place?.summary) {
        narrate?.(`这里是${name}，${era.name}时叫${era.place.ancient}。${era.place.summary}`);
      }
      return payload;
    } catch (error) {
      console.warn('[millennium] 打开失败', error);
      ui?.toast?.(error.message || '千年模式打开失败');
      return null;
    }
  }

  function close({ silent = false } = {}) {
    if (!state.active && !silent) return;
    state.active = false;
    state.cardOpen = false;
    disposeMarkers();
    applyOutline?.(null);
    onSceneLive();
    document.body.classList.remove('millennium-mode');
    $('millennium-bar')?.classList.add('hidden');
    toggleStrata(false);
    closeCard();
    state.payload = null;
    state.city = null;
    onExit?.();
    if (!silent) ui?.toast?.('已返回现代：地图与全部图层恢复');
  }

  /** 每帧：光点、光字与锁定点标签的位置刷新。 */
  function update(time, lighting, date = new Date()) {
    if (!state.active || !markers.points) return;
    markers.points.material.uniforms.uTime.value = time;
    markers.points.material.uniforms.uNightFactor.value = lighting?.nightFactor || 0;
    markers.points.setNight(
      markers.points.cities.map((city) => smoothstep(3, -8, sunAltitudeAt(city.lng, city.lat, date))),
    );
    if (markers.glow) {
      const distance = camera.position.distanceTo(controls.target);
      markers.glow.update(camera, time, {
        nightFactor: lighting?.nightFactor || 0,
        scale: Math.min(1.6, Math.max(0.7, distance / 5)),
        distance,
      });
    }
    // 标签：锁定点名牌挂在光点下方；近旁小名牌同理
    const positions = markers.points.screenPositions(camera, window.innerWidth, window.innerHeight);
    (markers.list || []).forEach((place, index) => {
      const element = place.__label;
      if (!element) return;
      const position = positions[index];
      if (!position || !position.visible) {
        element.style.display = 'none';
        return;
      }
      element.style.display = '';
      element.style.transform = `translate3d(${Math.round(position.x)}px, ${Math.round(position.y)}px, 0) translate(-50%, 0) translateY(6px)`;
    });
  }

  return {
    open,
    close,
    setEra,
    step,
    update,
    isActive: () => state.active,
    toggleStrata,
    onToken,
    onSentence,
    onDone,
    onError,
    streaming: () => state.streaming,
    debug: () => ({
      active: state.active,
      city: state.city?.name || null,
      index: state.index,
      era: state.payload?.eras[state.index]?.key || null,
      ancient: state.payload?.eras[state.index]?.place?.ancient || null,
      chain: state.lastChain,
      matched: state.payload?.counts?.matched ?? 0,
      markers: {
        points: markers.points?.cities.length || 0,
        glow: markers.glow?.items.length || 0,
        nearby: markers.nearbyList.length,
      },
      card: state.cardOpen,
      streaming: state.streaming,
    }),
  };
}
