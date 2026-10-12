// 一块土地的千年（重塑版）：锁定一个地点，让两千年从它身上流过。
// - 连续年份轴（前 221 → 今）：疆域遮罩连续形变 + 边界插值 + 前朝残影
// - 3D 地层柱（层厚 = 朝代年数）、时间之尘、跨朝钟磬、环境音随朝代演变
// - 事件年表 + 数字人解说 +「千年一刻」自动播放

import * as THREE from 'three';
import { createCityPoints } from '../citypoints.js';
import { createPoemGlow } from './poem_glow.js';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';
import { STAGE } from '../config.js';
import { applySolarUniforms } from '../lighting.js';
import { smoothstep, sunAltitudeAt } from '../solar.js';
import { createEraBorders, createMillenniumTerrain } from './millennium_terrain.js';
import { createStrata } from './millennium_strata.js';
import { createRing } from './millennium_ring.js';
import { createLandmarkBuild } from './millennium_landmark.js';
import { createDiorama } from './millennium_diorama.js';
import { bearingOf, interpolateParams, sceneParams } from './millennium_style.js';
import { bandAt, bandMidYear, createTimelineUI, crossedEvents, yearText } from './millennium_timeline.js';
import { createTimeDust } from '../time_dust.js';

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

/** 期代表时刻「06-22T19:40」→ {dayOfYear, minutes}；现代一期为 null（实时）。 */
export function parseLighting(spec) {
  const match = /^(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(spec || ''));
  if (!match) return null;
  const [, month, day, hour, minute] = match.map(Number);
  const leap = 0;
  const daysBefore = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const dayOfYear = daysBefore[month - 1] + day + leap;
  return { dayOfYear, minutes: hour * 60 + minute };
}

/** 按年份在两期代表时刻之间插值，得到舞台时间；返回 null 表示用实时。 */
export function lightingDateForYear(eras, mixA, mixB, mix, year = new Date().getFullYear()) {
  const a = parseLighting(eras?.[mixA]?.lighting);
  const b = parseLighting(eras?.[mixB]?.lighting);
  if (!a && !b) return null;
  const left = a || b;
  const right = b || a;
  const t = a && b ? clamp(mix, 0, 1) : 0;
  const dayOfYear = left.dayOfYear + (right.dayOfYear - left.dayOfYear) * t;
  const minutes = left.minutes + (right.minutes - left.minutes) * t;
  const base = Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000;
  return new Date(base + minutes * 60000 - 8 * 3600000);
}

/** 30km 内、除匹配点之外的历史地名（主地名优先、次级地名随后）。 */
export function nearbyPlaces(places, lng, lat, { km = NEARBY_KM, excludeId = null } = {}) {
  return (places || [])
    .filter((place) => place && place.id !== excludeId && place.lng != null && place.lat != null)
    .map((place) => ({ ...place, distance_km: haversineKm(lng, lat, Number(place.lng), Number(place.lat)) }))
    .filter((place) => place.distance_km <= km)
    .sort((a, b) => Number(Boolean(a.minor)) - Number(Boolean(b.minor)) || a.distance_km - b.distance_km);
}

/** 取名时间线（近旁参考不入选），如「内史 → 长安 → 大兴城 → 奉元路 → 西安」。 */
export function nameChain(eras) {
  return (eras || [])
    .filter((era) => era.matched && era.place && era.source !== 'near')
    .map((era) => era.place.ancient)
    .filter((name, index, list) => name && list.indexOf(name) === index);
}

/** Node 校验：千年 payload 必须是 11 期 + 11 段 + 事件年表完整。 */
export function validateMillenniumPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('缺少千年数据');
  const eras = payload.eras || [];
  if (eras.length !== 11) throw new Error(`时期数量异常：${eras.length}`);
  const bands = payload.bands || [];
  if (bands.length !== 11) throw new Error(`年代分带数量异常：${bands.length}`);
  for (let index = 1; index < bands.length; index += 1) {
    if (bands[index].start !== bands[index - 1].end) throw new Error(`分带 ${bands[index].key} 与上一段不连续`);
    if (bands[index].end <= bands[index].start) throw new Error(`分带 ${bands[index].key} 区间异常`);
  }
  if (!payload.bounds || payload.bounds.end <= payload.bounds.start) throw new Error('时间轴范围异常');
  const events = payload.events || [];
  const years = events.map((event) => event.year);
  if (years.some((year, index) => index && year < years[index - 1])) throw new Error('事件年份未升序');
  eras.forEach((era) => {
    if (!era.name || !era.period) throw new Error(`${era.key} 缺名称/年代`);
    if (era.matched) {
      if (!era.place || !era.place.ancient) throw new Error(`${era.key} 匹配了但没有古名`);
      if (!['exact', 'prefix', 'near', 'curated'].includes(era.source)) throw new Error(`${era.key} 来源异常`);
    } else if (!era.note) {
      throw new Error(`${era.key} 空档没有说明`);
    }
  });
  return { eras: eras.length, bands: bands.length, events: events.length, matched: payload.counts?.matched ?? 0 };
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
  flyTo,
  closeDrawer = () => {},
  onSceneTime = () => {},
  onSceneLive = () => {},
  onEnter = () => {},
  onExit = () => {},
  ambience = null,
  getTerrainGeometry = () => null,
  setModernOutlineVisible = () => {},
} = {}) {
  const state = {
    active: false,
    city: null,
    payload: null,
    year: 0,
    prevYear: 0,
    bandIndex: 0,
    bandFrom: 0,
    lastBandIndex: 0,
    dynastyCache: new Map(),
    visited: [],
    cardOpen: false,
    cardKind: 'anchor',
    sessionId: null,
    streaming: false,
    assistant: null,
    narrateOn: false,
    ghostAll: false,
    strataOn: true,
    screenOn: true,
    dioramaOn: true,
    autoplay: false,
    dustBoost: 0,
    lastNarrateAt: 0,
    lastUserAt: 0,
    lastFrameAt: 0,
    lastEventIndex: -1,
  };
  const markers = { points: null, glow: null, list: [], nearbyList: [] };
  const layers = {
    terrain: null,
    borders: null,
    strata: null,
    dust: null,
    timeline: null,
    ring: null,
    landmark: null,
    diorama: null,
  };
  const raycaster = new THREE.Raycaster();

  // ── 数据 ─────────────────────────────────────────────────────

  async function fetchDynasty(key) {
    if (state.dynastyCache.has(key)) return state.dynastyCache.get(key);
    const response = await fetch(`/api/dynasty/${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error(`朝代数据加载失败：${response.status}`);
    const { dynasty } = await response.json();
    if (!dynasty?.outline?.length) throw new Error('朝代疆域数据不完整');
    state.dynastyCache.set(key, dynasty);
    return dynasty;
  }

  function eraOf(index) {
    return state.payload?.eras?.[clamp(index, 0, 10)] || null;
  }

  // ── 标注（锁定点 + 近旁 + 诗词光字）──────────────────────────

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
    markers.list = [];
    markers.nearbyList = [];
    const layer = $('millennium-labels');
    if (layer) layer.innerHTML = '';
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

  async function buildMarkers(era, dynasty) {
    disposeMarkers();
    const locked = era?.place;
    if (!locked || !dynasty) return;
    const list = [{ ...locked, primary: true }];
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
    const world = list.map((place, index) =>
      worldPosition(place.lng, place.lat, RANGES, index === 0 ? 0.06 : 0.02),
    );
    markers.points = createCityPoints(cities, world);
    markers.points.cities = cities;
    markers.points.mesh.renderOrder = 4;
    scene.add(markers.points.mesh);

    list.forEach((place, index) => {
      place.__label = buildLabel(place, { primary: index === 0 });
    });
    markers.list = list;

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

  function chatBlock(title) {
    const chat = document.createElement('div');
    chat.className = 'dc-chat';
    const head = document.createElement('div');
    head.className = 'dc-chat-head';
    head.textContent = title;
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
    return chat;
  }

  function openEventCard(event) {
    const card = $('millennium-card');
    if (!card || !event) return;
    const era = eraOf(state.bandIndex);
    state.cardOpen = true;
    state.cardKind = 'event';
    state.sessionId = null;
    $('mc-title').textContent = event.title;
    $('mc-sub').textContent = `${yearText(event.year)} · ${era?.name || ''} · ${era?.place?.ancient || ''}`;
    const body = $('mc-body');
    body.innerHTML = '';
    const kicker = document.createElement('div');
    kicker.className = 'dc-kicker';
    kicker.textContent = `${state.city.name} · 千年事件`;
    body.appendChild(kicker);
    const summary = document.createElement('p');
    summary.className = 'dc-summary';
    summary.textContent = event.text;
    body.appendChild(summary);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'dc-play';
    play.textContent = '让当朝人讲一段';
    play.addEventListener('click', () => narrate?.(event.narration));
    body.appendChild(play);
    body.appendChild(chatBlock(`与${era?.name || ''}的人说话`));
    addLog('system', `这是${yearText(event.year)}的事，可以接着问。`);
    card.classList.remove('hidden');
    window.setTimeout(() => $('mc-input')?.focus(), 150);
  }

  function openCard(kind, place) {
    const era = eraOf(state.bandIndex);
    if (!era) return;
    const card = $('millennium-card');
    if (!card) return;
    const target = place || era.place;
    state.cardOpen = true;
    state.cardKind = kind;
    state.sessionId = null;
    if (!target) {
      $('mc-title').textContent = `${era.name} · 未有记载`;
      $('mc-sub').textContent = `${era.period} · ${era.note}`;
      const body = $('mc-body');
      body.innerHTML = '';
      const line = document.createElement('p');
      line.className = 'dc-summary';
      line.textContent = `${era.note}。把时间轴往回拖一点，看看更早的时候这里叫什么。`;
      body.appendChild(line);
      card.classList.remove('hidden');
      return;
    }
    $('mc-title').textContent = target.ancient;
    $('mc-sub').textContent = `${era.name} · ${era.period} · 今 ${state.city.name} · ${SOURCE_LABEL[era.source] || ''}`;
    const body = $('mc-body');
    body.innerHTML = '';
    const kicker = document.createElement('div');
    kicker.className = 'dc-kicker';
    kicker.textContent = `${state.city.name} · ${yearText(Math.round(state.year))} · ${era.place?.kind_label || '史迹'}`;
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
    body.appendChild(chatBlock(`与${era.name}的人说话 · ${target.ancient}`));
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
    const era = eraOf(state.bandIndex);
    if (!era) return null;
    const ancient = era.place?.ancient;
    const where = ancient
      ? `今${state.city.name}，${era.name}时称「${ancient}」（${era.period}）`
      : `今${state.city.name}，${era.name}（${era.period}）`;
    return `${where}。观众锁定了这一个点，把时间从公元前 221 年拖到现在。`;
  }

  async function sendChat() {
    const input = $('mc-input');
    const text = (input?.value || '').trim();
    const era = eraOf(state.bandIndex);
    if (!text || !era || !state.active) return;
    input.value = '';
    addLog('user', text);
    state.streaming = true;
    state.assistant = addLog('assistant', '');
    try {
      state.sessionId = await voice.askDynasty(era.key, {
        placeId:
          state.cardKind !== 'event' && era.place?.id && !String(era.place.id).startsWith('curated-')
            ? era.place.id
            : null,
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

  // ── 事件卡与解说 ─────────────────────────────────────────────

  function showEventToast(event) {
    const node = $('millennium-event');
    if (!node) return;
    node.innerHTML = '';
    const year = document.createElement('div');
    year.className = 'me-year';
    year.textContent = yearText(event.year);
    const title = document.createElement('div');
    title.className = 'me-title';
    title.textContent = event.title;
    const text = document.createElement('div');
    text.className = 'me-text';
    text.textContent = event.text;
    node.append(year, title, text);
    node.classList.remove('hidden');
    node.classList.remove('show');
    // 触发一次水晕入场
    void node.offsetWidth;
    node.classList.add('show');
    clearTimeout(showEventToast.timer);
    showEventToast.timer = window.setTimeout(() => node.classList.remove('show'), 6200);
    node.onclick = () => {
      node.classList.remove('show');
      openEventCard(event);
    };
    // 银幕与地图同帧：屏幕里放这一年的画面，地图上炸一圈光波
    layers.ring?.flash();
  }

  function maybeSpeakEvent(event, { force = false } = {}) {
    const now = performance.now();
    if (!force && !state.narrateOn) return;
    if (now - state.lastNarrateAt < 6000) return;
    state.lastNarrateAt = now;
    narrate?.(event.narration);
  }

  // ── 年份 → 画面 ──────────────────────────────────────────────

  function metaTextFor(era) {
    if (!era) return '';
    return era.place
      ? `${era.period} · ${era.place.ancient}${era.place.modern && era.place.modern !== era.place.ancient ? `（今 ${era.place.modern}）` : ''} · ${SOURCE_LABEL[era.source] || ''}`
      : `${era.period} · ${era.note}`;
  }

  async function bandChanged(index, { previous = null, source = 'step' } = {}) {
    const era = eraOf(index);
    if (!era || !state.payload) return;
    state.bandIndex = index;
    if (!state.visited.includes(index)) state.visited.push(index);
    if (previous != null && previous !== index && state.visited.includes(previous)) {
      layers.borders?.addGhost(previous, state.visited);
    }
    const dynasty = await fetchDynasty(era.key);
    if (!state.active) return;
    await buildMarkers(era, dynasty);
    $('millennium-era-meta').textContent = metaTextFor(era);
    layers.timeline?.setChainActive(era.place?.ancient || '');
    layers.strata?.setActive(index);
    layers.diorama?.setEra(index);
    if (source !== 'init') {
      ambience?.sting(index);
      ambience?.setMood(index);
    }
  }

  function setYear(year, { source = 'step', silent = false } = {}) {
    if (!state.payload) return;
    const clamped = clamp(year, state.payload.bounds.start, state.payload.bounds.end);
    const tl = bandAt(clamped, state.payload.bands, state.payload.bounds.blend_years);
    const previous = state.year;
    state.prevYear = previous;
    state.year = clamped;

    layers.terrain?.setBlend(tl.mixA, tl.mixB, tl.mix);
    layers.borders?.setBlend(tl.mixA, tl.mixB, tl.mix);
    layers.strata?.setActive(tl.index);
    layers.timeline?.setYear(clamped, tl);
    layers.landmark?.setYear(clamped);

    const date = lightingDateForYear(state.payload.eras, tl.mixA, tl.mixB, tl.mix);
    if (date) onSceneTime(date);
    else onSceneLive();

    // 时间之尘：拖得越快越亮
    const velocity = Math.abs(clamped - previous);
    const boost = clamp(velocity / 36, 0, 1);
    if (boost > 0) state.dustBoost = Math.max(state.dustBoost, boost);
    layers.dust?.setIntensity(state.dustBoost);
    ambience?.whoosh(boost);

    // 跨过事件年份 → 事件卡（+ 可选解说）
    const crossed = crossedEvents(state.payload.events, previous, clamped);
    if (crossed.length && !silent) {
      const event = crossed[crossed.length - 1];
      state.lastEventIndex = state.payload.events.indexOf(event);
      showEventToast(event);
      maybeSpeakEvent(event, { force: source === 'auto' });
    }

    if (tl.index !== state.bandIndex) {
      const from = state.bandIndex;
      state.bandIndex = tl.index;
      bandChanged(tl.index, { previous: from, source });
    } else {
      layers.timeline?.setChainActive(eraOf(tl.index)?.place?.ancient || '');
    }

    if (source === 'auto') {
      const span = (state.payload.bounds.end - state.payload.bounds.start) || 1;
      const t = clamp((clamped - state.payload.bounds.start) / span, 0, 1);
      const angle = t * Math.PI * 2;
      const radius = 2.7 + 0.6 * t;
      const height = 1.15 + 1.5 * t;
      const target = controls.target;
      camera.position.set(target.x + Math.cos(angle) * radius, target.y + height, target.z + Math.sin(angle) * radius);
      controls.update();
    }
  }

  function stepBand(delta) {
    if (!state.payload) return;
    const next = clamp(state.bandIndex + delta, 0, state.payload.bands.length - 1);
    const band = state.payload.bands[next];
    setYear(bandMidYear(band), { source: 'step' });
  }

  // ── 进入 / 退出 ──────────────────────────────────────────────

  function wire() {
    $('millennium-prev')?.addEventListener('click', () => stepBand(-1));
    $('millennium-next')?.addEventListener('click', () => stepBand(1));
    $('millennium-exit')?.addEventListener('click', () => close());
    $('millennium-strata-toggle')?.addEventListener('click', () => toggleStrata());
    $('mc-close')?.addEventListener('click', () => closeCard());
    $('millennium-narrate')?.addEventListener('change', (event) => {
      state.narrateOn = Boolean(event.target.checked);
      ui?.toast?.(state.narrateOn ? '解说完开：跨过事件年会讲一句' : '已关闭解说');
    });
    $('millennium-ghosts')?.addEventListener('change', (event) => {
      state.ghostAll = Boolean(event.target.checked);
      layers.borders?.setGhostMode(state.ghostAll ? 'all' : 'recent', state.visited);
      ui?.toast?.(state.ghostAll ? '残影全开：走过的朝代都留在场上' : '只保留最近四朝的残影');
    });
    controls?.addEventListener?.('start', () => {
      state.lastUserAt = performance.now();
    });
    $('millennium-screen-toggle')?.addEventListener('click', () => toggleScreen());
    $('millennium-diorama-toggle')?.addEventListener('click', () => toggleDiorama());
  }
  wire();

  function toggleStrata(open) {
    const want = open ?? !state.strataOn;
    state.strataOn = Boolean(want);
    layers.strata?.setVisible(state.strataOn);
    if (state.strataOn) layers.strata?.grow();
    layers.diorama?.setBase(state.strataOn ? strataTopHeight() : 0.03);
    $('millennium-strata-toggle')?.classList.toggle('on', state.strataOn);
    ui?.toast?.(state.strataOn ? '地层柱：层厚是朝代年数，点一层可跳过去' : '已收起地层柱');
  }

  /** 地层柱顶部高度：城郭就立在这上面。 */
  function strataTopHeight() {
    if (!layers.strata) return 0.03;
    const layout = layers.strata.layout;
    const last = layout[layout.length - 1];
    return last.center + last.thickness / 2 + 0.02;
  }

  function toggleScreen(open) {
    const want = open ?? !state.screenOn;
    state.screenOn = Boolean(want);
    layers.ring?.setVisible(state.screenOn);
    $('millennium-screen-toggle')?.classList.toggle('on', state.screenOn);
    ui?.toast?.(state.screenOn ? '环幕：绕地图一圈看这座城的两千年' : '已收起环幕');
  }

  function toggleDiorama(open) {
    const want = open ?? !state.dioramaOn;
    state.dioramaOn = Boolean(want);
    layers.diorama?.setVisible(state.dioramaOn);
    layers.landmark?.setVisible(state.dioramaOn);
    $('millennium-diorama-toggle')?.classList.toggle('on', state.dioramaOn);
    const what = layers.landmark ? '地标' : '城郭剪影';
    ui?.toast?.(state.dioramaOn ? `${what}：一座城的两千年长这样` : `已收起${what}`);
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
      ui?.toast?.(`正在展开${name}的两千年…`);
      const landmarkQuery = city?.landmark_key
        ? `&landmark_key=${encodeURIComponent(city.landmark_key)}`
        : '';
      const response = await fetch(
        `/api/dynasty/millennium?name=${encodeURIComponent(name)}&lng=${lng}&lat=${lat}${landmarkQuery}`,
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
      state.visited = [];
      state.bandFrom = 0;
      state.bandIndex = 0;
      state.year = payload.bounds.start;
      state.prevYear = payload.bounds.start;

      // 11 期疆域与标注数据（缓存；已经加载过的期不重复请求）
      const dynastyList = [];
      for (const band of payload.bands) {
        dynastyList.push(await fetchDynasty(band.key));
      }
      const rings = dynastyList.map((dynasty) => dynasty.outline);
      const colors = payload.bands.map((band) => band.color);

      const geometry = getTerrainGeometry();
      layers.terrain = createMillenniumTerrain({ geometry, rings, colors });
      scene.add(layers.terrain.mesh);
      layers.borders = createEraBorders({ rings, colors });
      scene.add(layers.borders.group);
      layers.strata = createStrata({ bands: payload.bands, lng, lat });
      layers.strata.grow();
      scene.add(layers.strata.group);
      const origin = worldPosition(lng, lat, RANGES, 0.05);
      layers.dust = createTimeDust({ origin });
      scene.add(layers.dust.points);
      layers.ring = createRing({ scene, bearing: bearingOf(lng, lat) });
      layers.ring.setVisible(state.screenOn);
      if (payload.landmark) {
        // 有真实地标模型的城市：地标随史建造，不再用城郭剪影
        layers.landmark = createLandmarkBuild({
          scene,
          point: origin,
          landmarkKey: payload.landmark.key,
          timeline: payload.landmark,
          onBuildStep: (kind) => ambience?.construction?.(kind),
        });
        layers.landmark.setVisible(state.dioramaOn);
        $('millennium-diorama-toggle')?.classList.add('hidden');
        $('millennium-diorama-toggle').textContent = '地标';
      } else {
        layers.diorama = createDiorama({ scene, point: origin, cityName: name });
        layers.diorama.setVisible(state.dioramaOn);
        layers.diorama.setBase(strataTopHeight());
        $('millennium-diorama-toggle')?.classList.remove('hidden');
        const toggle = $('millennium-diorama-toggle');
        if (toggle) toggle.textContent = '城郭';
      }
      layers.timeline = createTimelineUI({
        bands: payload.bands,
        bounds: payload.bounds,
        events: payload.events,
        chain: nameChain(payload.eras),
        onSeek: (year, source) => setYear(year, { source: source === 'auto' ? 'auto' : 'drag' }),
        onAutoplayBeat: (event) => {
          showEventToast(event);
          maybeSpeakEvent(event, { force: true });
        },
        onAutoplayState: (running) => {
          state.autoplay = running;
          controls.enabled = !running;
          $('millennium-narrate') && ($('millennium-narrate').checked = running || state.narrateOn);
          if (!running) {
            controls.enabled = true;
            const target = controls.target;
            camera.position.set(target.x + 1.6, target.y + 1.7, target.z + 2.1);
            controls.update();
          }
        },
      });
      setModernOutlineVisible(false);
      document.body.classList.add('millennium-mode');
      $('millennium-bar')?.classList.remove('hidden');
      closeDrawer?.();
      onEnter?.(payload);

      const target = worldPosition(lng, lat, RANGES, 0.05);
      const direction = camera.position.clone().sub(controls.target).normalize();
      const position = target.clone().add(direction.multiplyScalar(3.1));
      position.y = Math.max(position.y, target.y + 1.2);
      flyTo?.(position, target, STAGE.transitionMs);

      // 从唐开始（标志性的画面），否则第一段有记载的时期
      const tangIndex = payload.bands.findIndex((band) => band.key === 'tang');
      const startBand = tangIndex >= 0 ? tangIndex : 0;
      await bandChanged(startBand, { previous: null, source: 'init' });
      setYear(bandMidYear(payload.bands[startBand]), { source: 'init', silent: true });

      const chain = nameChain(payload.eras).slice(0, 6).join(' → ');
      ui?.toast?.(chain ? `这块土地的两千年：${chain}` : `${name} · 千年`);
      if (payload.headline) narrate?.(payload.headline);
      return payload;
    } catch (error) {
      console.warn('[millennium] 打开失败', error);
      ui?.toast?.(error.message || '千年模式打开失败');
      close({ silent: true });
      return null;
    }
  }

  function close({ silent = false } = {}) {
    if (!state.active && !silent) return;
    state.active = false;
    state.cardOpen = false;
    disposeMarkers();
    if (layers.terrain) {
      scene.remove(layers.terrain.mesh);
      layers.terrain.dispose();
      layers.terrain = null;
    }
    if (layers.borders) {
      scene.remove(layers.borders.group);
      layers.borders.dispose();
      layers.borders = null;
    }
    if (layers.strata) {
      scene.remove(layers.strata.group);
      layers.strata.dispose();
      layers.strata = null;
    }
    if (layers.dust) {
      scene.remove(layers.dust.points);
      layers.dust.dispose();
      layers.dust = null;
    }
    if (layers.ring) {
      layers.ring.dispose();
      layers.ring = null;
    }
    if (layers.landmark) {
      layers.landmark.dispose();
      layers.landmark = null;
    }
    if (layers.diorama) {
      layers.diorama.dispose();
      layers.diorama = null;
    }
    layers.timeline?.destroy();
    layers.timeline = null;
    setModernOutlineVisible(true);
    onSceneLive();
    document.body.classList.remove('millennium-mode');
    $('millennium-bar')?.classList.add('hidden');
    $('millennium-event')?.classList.remove('show');
    $('millennium-event')?.classList.add('hidden');
    const strataLabel = $('millennium-strata-label');
    if (strataLabel) strataLabel.style.display = 'none';
    closeCard();
    state.payload = null;
    state.city = null;
    onExit?.();
    if (!silent) ui?.toast?.('已返回现代：地图与全部图层恢复');
  }

  // ── 每帧 ─────────────────────────────────────────────────────

  function update(time, lighting, date = new Date()) {
    if (!state.active) return;
    const dt = Math.min(0.1, time - (state.lastFrameAt || time));
    state.lastFrameAt = time;
    if (markers.points) {
      markers.points.material.uniforms.uTime.value = time;
      markers.points.material.uniforms.uNightFactor.value = lighting?.nightFactor || 0;
      markers.points.setNight(
        markers.points.cities.map((city) => smoothstep(3, -8, sunAltitudeAt(city.lng, city.lat, date))),
      );
    }
    if (markers.glow) {
      const distance = camera.position.distanceTo(controls.target);
      markers.glow.update(camera, time, {
        nightFactor: lighting?.nightFactor || 0,
        scale: Math.min(1.6, Math.max(0.7, distance / 5)),
        distance,
      });
    }
    // 锁定点名牌与近旁地名
    const positions = markers.points?.screenPositions(camera, window.innerWidth, window.innerHeight) || [];
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

    layers.strata?.update(dt, time);
    // 地层柱当前层的标签
    const strataLabel = $('millennium-strata-label');
    if (strataLabel && layers.strata) {
      if (state.strataOn) {
        const point = layers.strata.activeScreenPosition(camera, window.innerWidth, window.innerHeight);
        if (point.visible) {
          strataLabel.style.display = '';
          strataLabel.textContent = `${point.band.name} · ${point.band.years} 年`;
          strataLabel.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y)}px, 0) translate(10px, -50%)`;
        } else {
          strataLabel.style.display = 'none';
        }
      } else {
        strataLabel.style.display = 'none';
      }
    }

    // 时间之尘：强度随时间衰减
    state.dustBoost = Math.max(0, state.dustBoost - dt * 1.3);
    const dustLevel = state.autoplay ? Math.max(0.45, state.dustBoost) : state.dustBoost;
    layers.dust?.setIntensity(dustLevel);
    layers.dust?.update(dt, time);

    // 环幕：剪影长卷跟着年份与日照走；亮度洒回沙盘（幕上在建造，地上就跟着亮）
    layers.landmark?.update(dt);
    if (layers.ring && state.payload) {
      const tl = bandAt(state.year, state.payload.bands, state.payload.bounds.blend_years);
      const params = interpolateParams(
        sceneParams(state.city.name, tl.mixA),
        sceneParams(state.city.name, tl.mixB),
        tl.mix,
      );
      const landmarkInfo = layers.landmark?.debug?.() || null;
      const flash = layers.ring.update(dt, {
        params,
        altitude: lighting?.altitude ?? 0,
        azimuth: lighting?.azimuth ?? 180,
        landmark: landmarkInfo ? { state: landmarkInfo.state, progress: landmarkInfo.progress } : null,
        time,
      });
      layers.terrain?.setCinema(Math.max(0, ((flash || 0) - 0.62) * 0.5));
    }
    layers.diorama?.update(dt);

    // 镜头缓慢环绕（用户停手 4 秒后、非自动播放时）
    if (!state.autoplay && performance.now() - state.lastUserAt > 4000) {
      const offset = camera.position.clone().sub(controls.target);
      const angle = dt * 0.02;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      offset.set(offset.x * cos + offset.z * sin, offset.y, -offset.x * sin + offset.z * cos);
      camera.position.copy(controls.target.clone().add(offset));
    }
    // 日照 uniforms 跟着舞台状态走
    if (layers.terrain) {
      applySolarUniforms(layers.terrain.material, lighting);
      layers.terrain.material.uniforms.uTime.value = time;
    }
  }

  function resize(width, height) {
    layers.borders?.resize(width, height);
  }

  function pointerMove(event) {
    if (!state.active || !state.strataOn || !layers.strata) return false;
    raycaster.setFromCamera(
      { x: (event.clientX / window.innerWidth) * 2 - 1, y: -(event.clientY / window.innerHeight) * 2 + 1 },
      camera,
    );
    return layers.strata.pick(raycaster) != null;
  }

  /** 点击地层柱的某一层 → 跳到那一朝。返回是否命中。 */
  function pointerUp(event) {
    if (!state.active || !state.strataOn || !layers.strata) return false;
    raycaster.setFromCamera(
      { x: (event.clientX / window.innerWidth) * 2 - 1, y: -(event.clientY / window.innerHeight) * 2 + 1 },
      camera,
    );
    const index = layers.strata.pick(raycaster);
    if (index == null) return false;
    const band = state.payload.bands[index];
    setYear(bandMidYear(band), { source: 'step' });
    ui?.toast?.(`${band.name} · ${band.period}`);
    return true;
  }

  return {
    open,
    close,
    setYear,
    setEra: (index) => {
      const band = state.payload?.bands?.[clamp(Math.round(index || 0), 0, 10)];
      if (band) setYear(bandMidYear(band), { source: 'step' });
    },
    step: stepBand,
    update,
    resize,
    pointerUp,
    pointerMove,
    toggleStrata,
    onToken,
    onSentence,
    onDone,
    onError,
    streaming: () => state.streaming,
    isActive: () => state.active,
    autoplay: () => state.autoplay,
    debug: () => ({
      active: state.active,
      city: state.city?.name || null,
      matched: state.payload?.counts?.matched ?? 0,
      year: Math.round(state.year),
      yearText: yearText(Math.round(state.year)),
      band: state.payload?.bands?.[state.bandIndex]?.key || null,
      bandIndex: state.bandIndex,
      bands: state.payload?.bands?.length || 0,
      eraA: state.payload?.bands?.[layers.terrain?.debug?.().a ?? 0]?.key || null,
      eraB: state.payload?.bands?.[layers.terrain?.debug?.().b ?? 0]?.key || null,
      mix: layers.terrain?.debug?.().mix ?? 0,
      ghosts: layers.borders?.debug?.() || null,
      strata: layers.strata?.debug?.() || null,
      ring: layers.ring?.debug?.() || null,
      landmark: layers.landmark?.debug?.() || null,
      diorama: layers.diorama?.debug?.() || null,
      terrainCinema: layers.terrain?.material?.uniforms?.uCinema?.value ?? 0,
      dust: layers.dust?.debug?.() || null,
      autoplay: state.autoplay,
      narrateOn: state.narrateOn,
      headline: state.payload?.headline || '',
      events: state.payload?.events?.length || 0,
      chain: nameChain(state.payload?.eras || []),
      card: state.cardOpen,
      streaming: state.streaming,
      markers: {
        points: markers.points?.cities.length || 0,
        glow: markers.glow?.items.length || 0,
        nearby: markers.nearbyList.length,
      },
    }),
  };
}
