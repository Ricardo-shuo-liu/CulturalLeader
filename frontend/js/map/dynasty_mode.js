// 穿越模式：唐 / 宋 / 明 的示意疆域底图 + 历史地名 + 诗词写作地。
// - 进入时用该朝 outline 重建浮雕与描边，现代光点/地级市/省界/3D 地标整体隐藏
// - 点历史地点或诗词写作地弹卡，卡内可自由阅读并「与数字人讨论」（复用 voice 的 SSE/TTS 链路）
// - 退出后恢复现代底图与全部图层；穿越期间双击不进入流程编辑

import { createCityPoints } from '../citypoints.js';
import { createPoemGlow, poemRingOffsets } from './poem_glow.js';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';
import { STAGE } from '../config.js';
import { smoothstep, sunAltitudeAt } from '../solar.js';

const PLACE_COLOR = '#e6c27a';
const POEM_COLOR = '#8fd8d2';
const HIT_PX = 18;

export function outlineBounds(outline = []) {
  const lngs = outline.map((point) => point[0]);
  const lats = outline.map((point) => point[1]);
  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

/** 供 Node 校验：朝代数据必须是「闭合疆域环 + 足量地名/诗词」的完整结构。 */
export function validateDynastyPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('缺少朝代数据');
  const key = payload.key || '?';
  const outline = payload.outline || [];
  if (outline.length < 40 || outline.length > 130) throw new Error(`${key} 疆域环点数异常：${outline.length}`);
  const first = outline[0];
  const last = outline[outline.length - 1];
  if (!first || !last || Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6) {
    throw new Error(`${key} 疆域环未闭合`);
  }
  outline.forEach(([lng, lat]) => {
    if (lng < 70 || lng > 140 || lat < 15 || lat > 55) throw new Error(`${key} 疆域点越界：${lng},${lat}`);
  });
  const places = payload.places || [];
  const poems = payload.poems || [];
  if (places.length < 12) throw new Error(`${key} 历史地点不足：${places.length}`);
  if (poems.length < 12) throw new Error(`${key} 诗词不足：${poems.length}`);
  const placeIds = new Set();
  places.forEach((place) => {
    if (!place.id || placeIds.has(place.id)) throw new Error(`${key} 地点 id 重复或缺失：${place.id}`);
    placeIds.add(place.id);
  });
  const bounds = outlineBounds(outline);
  places.forEach((place) => {
    if (place.lng < bounds.minLng - 0.5 || place.lng > bounds.maxLng + 0.5) {
      throw new Error(`${key}/${place.id} 落点不在疆域经度范围内`);
    }
    if (place.lat < bounds.minLat - 0.5 || place.lat > bounds.maxLat + 0.5) {
      throw new Error(`${key}/${place.id} 落点不在疆域纬度范围内`);
    }
  });
  const poemIds = new Set();
  poems.forEach((poem) => {
    if (!poem.id || poemIds.has(poem.id)) throw new Error(`${key} 诗词 id 重复或缺失：${poem.id}`);
    poemIds.add(poem.id);
    if (!placeIds.has(poem.place_id)) throw new Error(`${key}/${poem.id} 写作地不存在：${poem.place_id}`);
    if (!poem.text || poem.text.trim().length < 8) throw new Error(`${key}/${poem.id} 正文过短`);
  });
  return { key, outline: outline.length, places: places.length, poems: poems.length, bounds };
}

/**
 * 穿越模式。
 * @param {object} options
 * @param {object} options.applyOutline  (rings|null, {color}) => void 重建底图；null 恢复现代
 * @param {Function} options.flyTo       (position, target, duration) => void
 */
export function createDynastyMode({
  scene,
  camera,
  controls,
  ui,
  voice,
  narrate,
  applyOutline,
  flyTo,
  closeDrawer = () => {},
  onEnter = () => {},
  onExit = () => {},
} = {}) {
  const $ = (id) => document.getElementById(id);
  const markers = { places: null, poems: null };
  const state = {
    listing: [],
    active: null,
    hover: null,
    card: null,
    streaming: false,
    sessionId: null,
    assistant: null,
  };

  const placeById = (dynasty, id) => (dynasty?.places || []).find((place) => place.id === id) || null;

  // ── 数据加载 ────────────────────────────────────────────────

  async function loadList() {
    try {
      const response = await fetch('/api/dynasty/list');
      if (!response.ok) return null;
      const data = await response.json();
      state.listing = data.dynasties || [];
      const select = $('dynasty-select');
      if (select) {
        select.innerHTML = '';
        state.listing.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.key;
          option.textContent = `${item.name} · ${item.period} · ${item.capital}`;
          select.appendChild(option);
        });
      }
      return state.listing;
    } catch (error) {
      console.warn('[dynasty] 朝代清单加载失败', error);
      return null;
    }
  }

  function updateNote(text) {
    const note = $('dynasty-note');
    if (note) note.textContent = text || '';
  }

  // ── 标记（历史地名 / 诗词写作地）────────────────────────────

  function disposeMarkers() {
    markers.glow?.dispose();
    markers.glow = null;
    ['places', 'poems'].forEach((key) => {
      const entry = markers[key];
      if (!entry) return;
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      markers[key] = null;
    });
    state.hover = null;
    const tip = $('dynasty-tip');
    tip?.classList.add('hidden');
  }

  function buildMarkers(dynasty) {
    disposeMarkers();
    const placeCities = dynasty.places.map((place) => ({
      name: place.ancient,
      slug: `dynasty:${dynasty.key}:place:${place.id}`,
      accent_color: PLACE_COLOR,
      lng: place.lng,
      lat: place.lat,
    }));
    const placeWorld = placeCities.map((city) => worldPosition(city.lng, city.lat, RANGES, 0.02));
    markers.places = createCityPoints(placeCities, placeWorld);
    markers.places.mesh.renderOrder = 3;
    markers.places.cities = placeCities;
    scene.add(markers.places.mesh);

    // 诗词写作地：同一地点多首诗词绕成一个很紧的小环，避免和地名光点完全重叠
    const groups = new Map();
    dynasty.poems.forEach((poem) => {
      const list = groups.get(poem.place_id) || [];
      list.push(poem);
      groups.set(poem.place_id, list);
    });
    const poemCities = [];
    const poemWorld = [];
    groups.forEach((list, placeId) => {
      const place = placeById(dynasty, placeId);
      if (!place) return;
      list.forEach((poem, index) => {
        const offset = poemRingOffsets(list.length, index);
        const base = worldPosition(place.lng, place.lat, RANGES, 0.05);
        base.x += offset.x;
        base.z += offset.z;
        poemCities.push({
          name: `《${poem.title}》`,
          slug: `dynasty:${dynasty.key}:poem:${poem.id}`,
          accent_color: POEM_COLOR,
          lng: place.lng,
          lat: place.lat,
        });
        poemWorld.push(base);
      });
    });
    markers.poems = createCityPoints(poemCities, poemWorld);
    markers.poems.mesh.renderOrder = 4;
    markers.poems.cities = poemCities;
    scene.add(markers.poems.mesh);

    // 代表诗词浮起两列竖排的「光字」（无纸面背景），落在与光点同一个位置
    markers.glow = createPoemGlow({
      scene,
      poems: dynasty.poems.filter((poem) => poem.featured),
      places: dynasty.places,
    });
  }

  function hitTest(x, y) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    let best = null;
    const considerGlow = () => {
      if (!markers.glow || !state.active) return;
      markers.glow.screenPositions(camera, width, height).forEach((position) => {
        if (!position.visible) return;
        // 光字是一串竖排字：按屏幕矩形命中（上下各留 10px），比单点半径稳得多
        const margin = 10;
        const dx = Math.abs(position.x - x);
        if (dx > position.halfWidth + margin) return;
        if (y < position.top - margin || y > position.bottom + margin) return;
        const distance = Math.hypot(position.x - x, position.y - y);
        const poemIndex = state.active.poems.findIndex((poem) => poem.id === position.id);
        if (poemIndex < 0) return;
        if (!best || distance < best.distance) {
          best = { kind: 'poem', index: poemIndex, x: position.x, y: position.y, distance, glow: position.id };
        }
      });
    };
    const consider = (entry, kind) => {
      if (!entry) return;
      entry.screenPositions(camera, width, height).forEach((position) => {
        if (!position.visible) return;
        const distance = Math.hypot(position.x - x, position.y - y);
        if (distance > HIT_PX) return;
        if (!best || distance < best.distance) {
          best = { kind, index: position.index, x: position.x, y: position.y, distance };
        }
      });
    };
    // 光字在最上层，其次是诗词光点，最后是地名光点
    considerGlow();
    consider(markers.poems, 'poem');
    consider(markers.places, 'place');
    return best;
  }

  function itemOf(hit) {
    if (!hit || !state.active) return null;
    return (hit.kind === 'place' ? state.active.places : state.active.poems)[hit.index] || null;
  }

  function setHover(hit) {
    const same =
      (state.hover?.kind || null) === (hit?.kind || null) && (state.hover?.index ?? -1) === (hit?.index ?? -1);
    if (same) return;
    markers.places?.setHover(hit && hit.kind === 'place' ? hit.index : -1);
    markers.poems?.setHover(hit && hit.kind === 'poem' ? hit.index : -1);
    markers.glow?.setHover(hit?.glow || null);
    state.hover = hit || null;
    const tip = $('dynasty-tip');
    if (!tip) return;
    const item = itemOf(hit);
    if (!item) {
      tip.classList.add('hidden');
      return;
    }
    tip.textContent =
      hit.kind === 'place' ? `${item.ancient}（今 ${item.modern}）` : `《${item.title}》· ${item.author}`;
    tip.style.transform = `translate3d(${Math.round(hit.x)}px, ${Math.round(hit.y - 24)}px, 0) translate(-50%, -100%)`;
    tip.classList.remove('hidden');
  }

  function pointerMove(event) {
    if (!state.active) return null;
    const hit = hitTest(event.clientX, event.clientY);
    setHover(hit);
    return hit;
  }

  function pointerUp(event) {
    if (!state.active) return;
    const hit = hitTest(event.clientX, event.clientY);
    const item = itemOf(hit);
    if (item) openCard(hit.kind, item);
    else closeCard();
  }

  // ── 卡片（地点 / 诗词 + 与数字人讨论）──────────────────────

  function paragraph(className, text) {
    const node = document.createElement('p');
    node.className = className;
    node.textContent = text;
    return node;
  }

  function knowledgeBlock(entries) {
    const wrap = document.createElement('div');
    wrap.className = 'dc-qa';
    (entries || []).forEach((entry) => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = entry.question;
      details.appendChild(summary);
      details.appendChild(paragraph('dc-answer', entry.answer));
      wrap.appendChild(details);
    });
    return wrap;
  }

  function addLog(role, text) {
    const log = $('dc-log');
    if (!log) return null;
    const item = document.createElement('div');
    item.className = `dc-msg ${role}`;
    item.textContent = text || '';
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  function chatBlock() {
    const wrap = document.createElement('div');
    wrap.className = 'dc-chat';
    const head = document.createElement('div');
    head.className = 'dc-chat-head';
    const subject = state.card?.kind === 'poem' ? `《${state.card.item.title}》` : state.card?.item?.ancient || '本朝';
    head.textContent = `与数字人讨论 · ${state.active.name} · ${subject}`;
    const log = document.createElement('div');
    log.id = 'dc-log';
    log.className = 'dc-log';
    const row = document.createElement('div');
    row.className = 'dc-row';
    const input = document.createElement('input');
    input.id = 'dc-input';
    input.type = 'text';
    input.placeholder = '问点什么，例如：这里当时是什么样子？';
    const send = document.createElement('button');
    send.id = 'dc-send';
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
    wrap.append(head, log, row);
    return wrap;
  }

  function openCard(kind, item) {
    const card = $('dynasty-card');
    if (!card || !state.active || !item) return;
    state.card = { kind, item };
    state.sessionId = null;
    const dynasty = state.active;
    const host = kind === 'poem' ? placeById(dynasty, item.place_id) : null;
    $('dc-title').textContent = kind === 'place' ? item.ancient : `《${item.title}》`;
    $('dc-sub').textContent =
      kind === 'place' ? `今 ${item.modern} · ${item.kind_label}` : `${item.author} · 写作于${host ? host.ancient : '—'}`;
    const body = $('dc-body');
    body.innerHTML = '';

    const kicker = document.createElement('div');
    kicker.className = 'dc-kicker';
    kicker.textContent =
      kind === 'place'
        ? `${dynasty.name} · ${dynasty.period} · ${item.kind_label}`
        : `${dynasty.name} · ${dynasty.period} · ${(item.tags || []).join(' / ') || '诗词'}`;
    body.appendChild(kicker);

    if (kind === 'place') {
      body.appendChild(paragraph('dc-summary', item.summary));
      body.appendChild(paragraph('dc-note', item.narration));
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'dc-play';
      play.textContent = '让数字人讲一段';
      play.addEventListener('click', () => narrate?.(item.narration));
      body.appendChild(play);
      if (item.note) body.appendChild(paragraph('dc-footnote', `备考：${item.note}`));
    } else {
      body.appendChild(paragraph('dc-verse', item.text));
      body.appendChild(paragraph('dc-summary', item.background));
      if (host) {
        body.appendChild(paragraph('dc-place', `写作地：${host.ancient}（今 ${host.modern}）`));
      }
      if (item.place_note) body.appendChild(paragraph('dc-footnote', `一说：${item.place_note}`));
    }
    if ((item.knowledge || []).length) body.appendChild(knowledgeBlock(item.knowledge));
    body.appendChild(chatBlock());
    addLog('system', kind === 'place' ? '可以直接问这座城当年的事。' : '可以直接聊这首诗。');
    card.classList.remove('hidden');
    setTimeout(() => $('dc-input')?.focus(), 200);
  }

  function closeCard() {
    state.card = null;
    state.sessionId = null;
    state.streaming = false;
    state.assistant = null;
    $('dynasty-card')?.classList.add('hidden');
  }

  async function sendChat() {
    const input = $('dc-input');
    const text = (input?.value || '').trim();
    if (!text || !state.active) return;
    input.value = '';
    addLog('user', text);
    state.streaming = true;
    state.assistant = addLog('assistant', '');
    try {
      state.sessionId = await voice.askDynasty(state.active.key, {
        placeId: state.card?.kind === 'place' ? state.card.item.id : null,
        poemId: state.card?.kind === 'poem' ? state.card.item.id : null,
        message: text,
        sessionId: state.sessionId,
      });
    } catch (error) {
      addLog('system', error.message || '提问失败');
    } finally {
      state.streaming = false;
      state.assistant = null;
    }
  }

  // ── SSE 事件分流（main.js 的 voice 回调先问这里）────────────

  function onToken(text) {
    if (!state.streaming) return false;
    if (!state.assistant) state.assistant = addLog('assistant', '');
    state.assistant.textContent += text;
    const log = $('dc-log');
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

  // ── 相机与开关 ──────────────────────────────────────────────

  function focusOn(lng, lat, distance = 2.1) {
    const target = worldPosition(lng, lat, RANGES, 0.05);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const position = target.clone().add(direction.multiplyScalar(distance));
    position.y = Math.max(position.y, target.y + distance * 0.5);
    flyTo?.(position, target, STAGE.transitionMs);
  }

  function renderPoemList(dynasty) {
    const list = $('dynasty-poems');
    if (!list) return;
    list.innerHTML = '';
    dynasty.poems.forEach((poem) => {
      const host = placeById(dynasty, poem.place_id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dynasty-poem';
      const title = document.createElement('span');
      title.className = 'dp-title';
      title.textContent = `《${poem.title}》`;
      const meta = document.createElement('span');
      meta.className = 'dp-meta';
      meta.textContent = `${poem.author} · ${host ? host.ancient : ''}`;
      button.append(title, meta);
      button.addEventListener('click', () => {
        if (host) focusOn(host.lng, host.lat, 1.9);
        openCard('poem', poem);
        closeDrawer();
      });
      list.appendChild(button);
    });
  }

  function updateBar(dynasty) {
    const bar = $('dynasty-bar');
    if (!bar) return;
    if (!dynasty) {
      bar.classList.add('hidden');
      return;
    }
    $('dynasty-bar-name').textContent = dynasty.name;
    $('dynasty-bar-meta').textContent =
      `${dynasty.capital} · ${dynasty.period} · ${dynasty.places.length} 处地名 · ${dynasty.poems.length} 首诗词 · 示意疆域`;
    bar.style.setProperty('--dynasty-color', dynasty.color || '#d8b46a');
    bar.classList.remove('hidden');
  }

  async function enter(key) {
    const wanted = String(key || '').trim().toLowerCase();
    if (!wanted) return null;
    try {
      const response = await fetch(`/api/dynasty/${encodeURIComponent(wanted)}`);
      if (!response.ok) {
        ui?.toast?.('这个朝代的数据暂时不可用');
        return null;
      }
      const { dynasty } = await response.json();
      if (!dynasty?.outline?.length) {
        ui?.toast?.('朝代疆域数据不完整');
        return null;
      }
      if (state.active) exit({ silent: true });

      applyOutline?.(dynasty.outline, { color: dynasty.color });
      buildMarkers(dynasty);
      state.active = dynasty;
      document.body.classList.add('dynasty-mode');
      updateBar(dynasty);
      updateNote(`${dynasty.name} · ${dynasty.period} · 都城${dynasty.capital}：${dynasty.summary}`);
      renderPoemList(dynasty);
      closeCard();
      onEnter?.(dynasty);

      const capital = dynasty.places.find((place) => place.ancient === dynasty.capital) || null;
      const focus = capital || dynasty.places[0];
      if (focus) focusOn(focus.lng, focus.lat, 3.6);
      ui?.toast?.(`已穿越到${dynasty.name}：底图为示意疆域，可点地名或诗词与数字人讨论`);
      narrate?.(dynasty.narration || dynasty.summary || '');
      return dynasty;
    } catch (error) {
      console.warn('[dynasty] 进入失败', error);
      ui?.toast?.('进入穿越模式失败，请稍后重试');
      return null;
    }
  }

  function exit({ silent = false } = {}) {
    if (!state.active && !silent) return;
    disposeMarkers();
    applyOutline?.(null);
    state.active = null;
    state.card = null;
    document.body.classList.remove('dynasty-mode');
    updateBar(null);
    closeCard();
    updateNote('选择朝代后「开始穿越」：底图整体换成该朝示意疆域，现代地名与地标全部收起。');
    const list = $('dynasty-poems');
    if (list) list.innerHTML = '';
    onExit?.();
    if (!silent) {
      ui?.toast?.('已返回现代：现代地图与全部图层恢复');
    }
  }

  function update(time, lighting, date = new Date()) {
    if (!state.active) return;
    ['places', 'poems'].forEach((key) => {
      const entry = markers[key];
      if (!entry) return;
      entry.material.uniforms.uTime.value = time;
      entry.material.uniforms.uNightFactor.value = lighting?.nightFactor || 0;
      // 古地名与诗词标记同样按各自所在地的昼夜独立亮灭
      entry.setNight(entry.cities.map((city) => smoothstep(3, -8, sunAltitudeAt(city.lng, city.lat, date))));
    });
    if (markers.glow) {
      const distance = camera.position.distanceTo(controls.target);
      markers.glow.update(camera, time, {
        nightFactor: lighting?.nightFactor || 0,
        scale: Math.min(1.9, Math.max(0.75, distance / 6)),
      });
    }
  }

  function openPlace(id) {
    const place = placeById(state.active, id);
    if (!place) return null;
    focusOn(place.lng, place.lat, 1.9);
    openCard('place', place);
    return place;
  }

  function openPoem(id) {
    const poem = (state.active?.poems || []).find((item) => item.id === id);
    if (!poem) return null;
    const host = placeById(state.active, poem.place_id);
    if (host) focusOn(host.lng, host.lat, 1.9);
    openCard('poem', poem);
    return poem;
  }

  return {
    loadList,
    enter,
    exit,
    update,
    pointerMove,
    pointerUp,
    onToken,
    onSentence,
    onDone,
    onError,
    openPlace,
    openPoem,
    glowScreen: (id) => {
      if (!markers.glow) return null;
      return (
        markers.glow
          .screenPositions(camera, window.innerWidth, window.innerHeight)
          .find((item) => item.id === id) || null
      );
    },
    closeCard,
    isActive: () => Boolean(state.active),
    streaming: () => state.streaming,
    activeKey: () => state.active?.key || null,
    debug: () => ({
      active: state.active?.key || null,
      name: state.active?.name || null,
      places: state.active?.places.length || 0,
      poems: state.active?.poems.length || 0,
      card: state.card ? `${state.card.kind}:${state.card.item.id}` : null,
      hover: state.hover ? `${state.hover.kind}:${state.hover.index}` : null,
      streaming: state.streaming,
      markers: {
        places: markers.places?.cities.length || 0,
        poems: markers.poems?.cities.length || 0,
        glow: markers.glow?.items.length || 0,
        glowIds: markers.glow?.ids || [],
      },
      visibleLayers: {
        cityPoints: state.active ? false : true,
        cityLayer: state.active ? false : true,
        provinceLayer: state.active ? false : true,
        cityStage: state.active ? false : true,
      },
    }),
  };
}
