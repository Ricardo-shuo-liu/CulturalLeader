// 环境音：风声 / 水声 / 古琴（有素材就用素材，没有就用 WebAudio 合成风声水声兜底）。
// 与「静音」按钮联动；数字人播报时自动压低环境音（ducking）。

import { guqinLoop, noiseBuffer } from './audio_assets.js';

const ASSET_CANDIDATES = {
  // 用可选的 CC0 素材；文件缺失（404）时自动退回合成
  wind: ['/assets/audio/wind.webm', '/assets/audio/wind.ogg', '/assets/audio/wind.mp3'],
  water: ['/assets/audio/water.webm', '/assets/audio/water.ogg', '/assets/audio/water.mp3'],
  guqin: ['/assets/audio/guqin.webm', '/assets/audio/guqin.ogg', '/assets/audio/guqin.mp3'],
};

async function fetchFirst(urls) {
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.arrayBuffer();
    } catch (error) {
      /* 试下一个 */
    }
  }
  return null;
}

export function createAmbience() {
  const state = {
    ctx: null,
    master: null,
    started: false,
    muted: false,
    volume: 0.7,
    sources: [],
    assetUsed: '',
  };

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
    const data = await fetchFirst(ASSET_CANDIDATES[key]);
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
    applyGain(undefined, 2.6);
    return true;
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
    setMuted,
    setVolume,
    duck,
    unduck,
    started: () => state.started,
    asset: () => state.assetUsed || '合成风声/水声',
  };
}
