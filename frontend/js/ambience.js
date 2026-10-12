// 环境音：风声 / 水声 / 古琴（有素材就用素材，没有就用 WebAudio 合成风声水声兜底）。
// 与「静音」按钮联动；数字人播报时自动压低环境音（ducking）。

import {
  bellBuffer,
  buildStrikeBuffer,
  chimeBuffer,
  guqinLoop,
  noiseBuffer,
  padLoop,
  whooshBuffer,
} from './audio_assets.js';

// 素材清单由 /api/config 的 ambience 字段下发（服务端扫描 frontend/assets/audio/），
// 没有文件就直接用合成音——不再逐个探测 URL 造成 404 噪音。

export function createAmbience({ manifest = {} } = {}) {
  const state = {
    ctx: null,
    master: null,
    started: false,
    muted: false,
    volume: 0.7,
    sources: [],
    assetUsed: '',
    manifest: { ...manifest },
    stingBuffers: new Map(),
    buildBuffers: new Map(),
    whoosh: null,
    whooshAt: 0,
    pads: [],
    mood: 1,
  };

  /** 运行时更新素材清单（/api/config 到位后调用）。 */
  function setManifest(manifest_) {
    state.manifest = { ...(manifest_ || {}) };
  }

  function ensure() {
    if (state.ctx) return state.ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    state.ctx = new Ctor();
    state.master = state.ctx.createGain();
    state.master.gain.value = 0;
    state.master.connect(state.ctx.destination);
    return state.ctx;
  }

  function loopNoise({ filterType, frequency, gain, wobble = 0.08 }) {
    const ctx = state.ctx;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.6;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05 + Math.random() * 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = frequency * wobble;
    lfo.connect(lfoGain).connect(filter.frequency);
    source.connect(filter).connect(gainNode).connect(state.master);
    source.start();
    lfo.start();
    state.sources.push(source, lfo);
  }

  async function loadLoop(key, { gain, filter = null }) {
    const url = state.manifest[key];
    if (!url) return false;
    let data = null;
    try {
      const response = await fetch(url);
      if (!response.ok) return false;
      data = await response.arrayBuffer();
    } catch (error) {
      return false;
    }
    if (!data) return false;
    try {
      const buffer = await state.ctx.decodeAudioData(data);
      const source = state.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gainNode = state.ctx.createGain();
      gainNode.gain.value = gain;
      if (filter) {
        const node = state.ctx.createBiquadFilter();
        node.type = filter.type;
        node.frequency.value = filter.frequency;
        source.connect(node).connect(gainNode).connect(state.master);
      } else {
        source.connect(gainNode).connect(state.master);
      }
      source.start();
      state.sources.push(source);
      state.assetUsed = `${state.assetUsed}${state.assetUsed ? '+' : ''}${key}`;
      return true;
    } catch (error) {
      return false;
    }
  }

  /** 用户手势后调用：建立音频图并淡入。 */
  async function start() {
    if (state.started) return true;
    const ctx = ensure();
    if (!ctx) return false;
    state.started = true;
    try {
      await ctx.resume();
    } catch (error) {
      /* 忽略 */
    }
    const windLoaded = await loadLoop('wind', { gain: 0.16, filter: { type: 'lowpass', frequency: 420 } });
    const waterLoaded = await loadLoop('water', { gain: 0.1, filter: { type: 'bandpass', frequency: 1100 } });
    if (!windLoaded) loopNoise({ filterType: 'lowpass', frequency: 380, gain: 0.05 });
    if (!waterLoaded) loopNoise({ filterType: 'bandpass', frequency: 1500, gain: 0.024, wobble: 0.2 });
    const guqinLoaded = await loadLoop('guqin', { gain: 0.32, filter: { type: 'lowpass', frequency: 3200 } });
    if (!guqinLoaded) {
      // 没有素材时用程序化古琴（Karplus-Strong 拨弦合成），音色更淡但零授权负担
      const source = ctx.createBufferSource();
      source.buffer = guqinLoop(ctx, 24);
      source.loop = true;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0.5;
      source.connect(gainNode).connect(state.master);
      source.start();
      state.sources.push(source);
      state.assetUsed = `${state.assetUsed}${state.assetUsed ? '+' : ''}synth-guqin`;
    }
    buildPads();
    applyGain(undefined, 2.6);
    return true;
  }

  // ── 朝代氛围 pad（古代 / 帝制 / 近代三段）────────────────────
  const MOOD_ROOTS = [65.41, 73.42, 87.31];

  function buildPads() {
    MOOD_ROOTS.forEach((root, index) => {
      const source = state.ctx.createBufferSource();
      source.buffer = padLoop(state.ctx, { root, seconds: 12 });
      source.loop = true;
      const gainNode = state.ctx.createGain();
      gainNode.gain.value = index === state.mood ? 0.075 : 0.0001;
      source.connect(gainNode).connect(state.master);
      source.start();
      state.sources.push(source);
      state.pads.push(gainNode);
    });
  }

  /** 0=古代（秦—隋）1=帝制（唐—清）2=近代（晚清—今）。 */
  function moodForEra(eraIndex) {
    if (!Number.isFinite(eraIndex)) return 1;
    if (eraIndex <= 4) return 0;
    if (eraIndex <= 9) return 1;
    return 2;
  }

  function setMood(eraIndex) {
    state.mood = moodForEra(eraIndex);
    if (!state.started) return;
    state.pads.forEach((gainNode, index) => {
      const target = index === state.mood ? 0.075 : 0.0001;
      gainNode.gain.cancelScheduledValues(state.ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(target, state.ctx.currentTime + 1.6);
    });
  }

  // ── 跨朝钟磬 + 时光流速 ──────────────────────────────────────
  const STING_SCALE = [130.81, 146.83, 155.56, 174.61, 196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 349.23];

  function stingBuffer(eraIndex) {
    const key = `sting-${eraIndex}`;
    if (state.stingBuffers.has(key)) return state.stingBuffers.get(key);
    const base = STING_SCALE[Math.max(0, Math.min(STING_SCALE.length - 1, eraIndex))];
    const buffer =
      eraIndex <= 5
        ? bellBuffer(state.ctx, { base: base / 2, seconds: 5.5 })
        : chimeBuffer(state.ctx, { base, seconds: 3.4 });
    state.stingBuffers.set(key, buffer);
    return buffer;
  }

  /** 跨过一个朝代时敲一记：早段编钟、后段石磬。 */
  function sting(eraIndex = 0) {
    if (!state.started || state.muted) return;
    const source = state.ctx.createBufferSource();
    source.buffer = stingBuffer(eraIndex);
    const gainNode = state.ctx.createGain();
    gainNode.gain.value = 0.55;
    source.connect(gainNode).connect(state.master);
    source.start();
  }

  /** 快速拖动时间轴时的「时光流速」：强度 0..1，自带节流。 */
  function whoosh(intensity = 0) {
    if (!state.started || state.muted) return;
    const level = Math.min(1, Math.max(0, Number(intensity) || 0));
    const now = performance.now();
    if (level < 0.15 || now - state.whooshAt < 180) return;
    state.whooshAt = now;
    if (!state.whoosh) state.whoosh = whooshBuffer(state.ctx, {});
    const source = state.ctx.createBufferSource();
    source.buffer = state.whoosh;
    const gainNode = state.ctx.createGain();
    gainNode.gain.value = 0.32 * level;
    source.connect(gainNode).connect(state.master);
    source.start();
  }

  /** 地标建造的一声：石凿 / 夯土 / 木构 / 钢构（自带节流，避免连击）。 */
  let lastBuildAt = 0;
  function construction(kind = 'brick') {
    if (!state.started || state.muted) return;
    const now = performance.now();
    if (now - lastBuildAt < 170) return;
    lastBuildAt = now;
    const bufferKind = kind === 'burn' ? 'rammed' : kind;
    if (!state.buildBuffers.has(bufferKind)) {
      state.buildBuffers.set(bufferKind, buildStrikeBuffer(state.ctx, bufferKind));
    }
    const source = state.ctx.createBufferSource();
    source.buffer = state.buildBuffers.get(bufferKind);
    if (kind === 'burn') source.playbackRate.value = 0.62;
    const gainNode = state.ctx.createGain();
    gainNode.gain.value = kind === 'burn' ? 0.75 : 0.5;
    source.connect(gainNode).connect(state.master);
    source.start();
  }

  function applyGain(multiplier, seconds = 0.8) {
    if (!state.master) return;
    const target = state.muted ? 0 : state.volume * (multiplier ?? 1);
    state.master.gain.cancelScheduledValues(state.ctx.currentTime);
    state.master.gain.linearRampToValueAtTime(
      Math.max(0.0001, target),
      state.ctx.currentTime + Math.max(0.05, seconds),
    );
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    applyGain(undefined, 0.5);
  }

  function setVolume(volume) {
    state.volume = Math.min(1, Math.max(0, Number(volume) || 0));
    applyGain(undefined, 0.3);
  }

  /** 数字人说话时把环境音压低。 */
  function duck() {
    if (state.started) applyGain(0.22, 0.4);
  }

  function unduck() {
    if (state.started) applyGain(undefined, 1.6);
  }

  return {
    start,
    setManifest,
    setMuted,
    setVolume,
    duck,
    unduck,
    sting,
    whoosh,
    construction,
    setMood,
    started: () => state.started,
    asset: () => state.assetUsed || '合成风声/水声',
  };
}
