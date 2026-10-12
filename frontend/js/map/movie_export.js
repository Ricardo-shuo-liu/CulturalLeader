// 旅行电影（轻量版）：把整份攻略渲染成一段 30–60 秒的 WebM。
// 画面：沙盘运镜（按天飞过城市）+ 3D 地标升起 + 昼夜随时程扫过 + 日卡 / 字幕 / 封尾二维码；
// 声音：TTS 旁白（逐句解码后按时间轴调度）+ 古琴环境底（无素材时静音）→ WebAudio 混音；
// 录制：WebGL 画布 + 2D 合成画布 → captureStream(30) + 混音流 → MediaRecorder(video/webm)。
// 旁白脚本用模板生成（天 / 城市 / 点位 / 里程），不走大模型。

import { poseForFocus } from '../camera_track.js';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';
import { guqinLoop } from '../audio_assets.js';

const FLIGHT_SECONDS = 2.1;
const HOLD_SECONDS = 3.1;
const HOLD_SECONDS_TIGHT = 2.3;
const END_SECONDS = 4.6;
const MAX_SECONDS = 72;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 「09:30」在当天的北京时间 → Date（和舞台日照同一条时间轴）。 */
function sceneDateForClock(hhmm) {
  const [hours, minutes] = String(hhmm || '')
    .split(':')
    .map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const beijing = new Date(Date.now() + 8 * 3600 * 1000);
  return new Date(
    Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate(), hours - 8, minutes, 0),
  );
}

/**
 * 把「攻略 + 每条流程的完整数据」编译成电影脚本（纯函数，Node 可直接校验）。
 * @returns {{days: Array, totals: object, duration: number}}
 */
export function buildMovieScript(guide, flows = {}) {
  const items = (guide?.items || []).filter((item) => item && item.flowId);
  const hold = items.length > 9 ? HOLD_SECONDS_TIGHT : HOLD_SECONDS;
  const days = items.map((item, index) => {
    const flow = flows[item.flowId] || null;
    const plan = flow?.plan || {};
    const timeline = plan.timeline || [];
    const points = flow?.points || [];
    const byId = new Map();
    points.forEach((point) => {
      byId.set(point.id, point);
      if (point.name) byId.set(point.name, point);
    });
    const stops = timeline
      .map((node) => {
        const source = byId.get(node.id) || byId.get(node.name) || {};
        return {
          name: node.name || source.name || '',
          lng: Number(source.lng ?? flow?.city?.lng ?? 0),
          lat: Number(source.lat ?? flow?.city?.lat ?? 0),
          time: node.arrive_text || '',
        };
      })
      .filter((stop) => stop.name);
    const fallbackStops = points
      .map((point) => ({ name: point.name || '', lng: Number(point.lng) || 0, lat: Number(point.lat) || 0, time: '' }))
      .filter((stop) => stop.name);
    const list = stops.length ? stops : fallbackStops;
    const city = item.flow?.city || flow?.city?.name || '这座城';
    const distance = Number(plan.distance_km ?? item.flow?.distance_km) || 0;
    const spotNames = list.slice(0, 4).map((stop) => stop.name);
    const more = list.length > 4 ? `等 ${list.length} 处` : '';
    return {
      day: item.day ?? index + 1,
      city,
      lng: Number(flow?.city?.lng ?? 0),
      lat: Number(flow?.city?.lat ?? 0),
      stops: list,
      title: `第 ${item.day ?? index + 1} 天 · ${city}`,
      subtitle: spotNames.length ? `${spotNames.join(' → ')}${more}` : '这一天的行程',
      narration: spotNames.length
        ? `第 ${item.day ?? index + 1} 天，${city}。${spotNames.slice(0, 3).join('、')}。${
            distance ? `这一天大约要走 ${Math.round(distance)} 公里。` : ''
          }`
        : `第 ${item.day ?? index + 1} 天，抵达${city}。`,
      duration: FLIGHT_SECONDS + hold,
    };
  });

  const cityCount = new Set(days.map((day) => day.city)).size;
  const distanceKm = Math.round(
    Number(guide?.totals?.distance_km) ||
      days.reduce((sum, day) => sum + (Number(day.distanceKm) || 0), 0) ||
      0,
  );
  const totals = {
    days: days.length,
    cities: cityCount,
    distance_km: distanceKm,
    minutes: Math.round(Number(guide?.totals?.minutes) || 0),
  };
  const duration = days.reduce((sum, day) => sum + day.duration, 0) + END_SECONDS;

  // 太长就压：先缩回落，再砍到 72 秒以内（按比例压 hold）
  let scale = 1;
  if (duration > MAX_SECONDS && days.length) {
    const flights = days.length * FLIGHT_SECONDS;
    const holds = Math.max(0.5, (MAX_SECONDS - END_SECONDS - flights) / days.length);
    scale = clamp(holds / hold, 0.35, 1);
    days.forEach((day) => {
      day.duration = FLIGHT_SECONDS + hold * scale;
    });
  }
  const finalDuration = days.reduce((sum, day) => sum + day.duration, 0) + END_SECONDS;
  return { days, totals, duration: finalDuration };
}

export function movieTimeline(script) {
  // 每段起止（秒）与旁白内容：录制时按绝对时间调度画面与音频
  let cursor = 0;
  const segments = [];
  script.days.forEach((day) => {
    segments.push({ kind: 'day', day, start: cursor, end: cursor + day.duration, narration: day.narration });
    cursor += day.duration;
  });
  segments.push({
    kind: 'end',
    start: cursor,
    end: cursor + END_SECONDS,
    narration: '',
    totals: script.totals,
  });
  return segments;
}

function canRecord(canvas) {
  return Boolean(
    window.MediaRecorder &&
      canvas.captureStream &&
      (window.AudioContext || window.webkitAudioContext),
  );
}

function pickMime() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((mime) => window.MediaRecorder?.isTypeSupported?.(mime)) || '';
}

const $ = (id) => document.getElementById(id);

export function createMovieExport({
  canvas,
  camera,
  controls,
  ui,
  cityBridge,
  setSceneDate,
  setSceneLive,
  onFinish = () => {},
} = {}) {
  const state = {
    active: false,
    script: null,
    segments: [],
    startedAt: 0,
    raf: 0,
    recorder: null,
    chunks: [],
    overlay: null,
    ctx: null,
    audio: null,
    stream: null,
    camFrom: null,
    camTo: null,
    guideId: null,
    title: '',
    qr: null,
    cancelled: false,
  };

  function status(text, progress = null) {
    const node = $('movie-status');
    if (node) node.textContent = text;
    if (progress != null) {
      const bar = $('movie-progress');
      if (bar) bar.style.width = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
    }
  }

  function openModal() {
    $('movie-modal')?.classList.remove('hidden');
    $('movie-result')?.classList.add('hidden');
    $('movie-progress')?.style.setProperty('width', '0%');
  }

  function closeModal() {
    $('movie-modal')?.classList.add('hidden');
  }

  async function fetchFlow(flowId) {
    const response = await fetch(`/api/flows/${encodeURIComponent(flowId)}`);
    if (!response.ok) return null;
    return response.json();
  }

  async function loadNarration(segments) {
    const lines = segments.filter((segment) => segment.kind === 'day' && segment.narration);
    if (!lines.length) return new Map();
    const results = new Map();
    await Promise.all(
      lines.map(async (segment) => {
        try {
          const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: segment.narration }),
          });
          if (!response.ok) return;
          const data = await response.arrayBuffer();
          const buffer = await state.audio.ctx.decodeAudioData(data);
          results.set(segment.start, buffer);
        } catch (error) {
          /* 单句失败不影响整片 */
        }
      }),
    );
    return results;
  }

  async function loadMusic() {
    for (const url of ['/assets/audio/guqin.webm', '/assets/audio/guqin.ogg', '/assets/audio/guqin.mp3']) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const data = await response.arrayBuffer();
        return await state.audio.ctx.decodeAudioData(data);
      } catch (error) {
        /* 试下一个 */
      }
    }
    // 没有素材就用程序化古琴当配乐（同一套合成器，音色淡、不抢旁白）
    try {
      return guqinLoop(state.audio.ctx, 32, { gain: 0.4 });
    } catch (error) {
      return null;
    }
  }

  async function loadQr(guideId) {
    try {
      const response = await fetch(`/api/guides/${encodeURIComponent(guideId)}/share-qr.png`);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await createImageBitmap(blob);
    } catch (error) {
      return null;
    }
  }

  function drawFrame(elapsed) {
    const ctx = state.ctx;
    const overlay = state.overlay;
    if (!ctx || !overlay) return;
    const width = overlay.width;
    const height = overlay.height;
    ctx.clearRect(0, 0, width, height);
    // 1. 沙盘画面
    try {
      ctx.drawImage(canvas, 0, 0, width, height);
    } catch (error) {
      /* 画布还没准备好时跳过这一帧 */
    }
    // 2. 电影黑边 + 暮色渐晕，让画面更像"电影"
    const bar = Math.round(height * 0.055);
    ctx.fillStyle = 'rgba(4, 7, 9, 0.92)';
    ctx.fillRect(0, 0, width, bar);
    ctx.fillRect(0, height - bar, width, bar);
    const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.85);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const segment = state.segments.find((item) => elapsed >= item.start && elapsed < item.end);
    const serif = '"Noto Serif CJK SC", "Songti SC", "Source Han Serif SC", serif';

    if (segment?.kind === 'day') {
      const local = elapsed - segment.start;
      const fadeIn = clamp(local / 0.7, 0, 1);
      const fadeOut = clamp((segment.end - elapsed) / 0.5, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      // 日卡
      ctx.textAlign = 'center';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#f2e7cb';
      ctx.font = `600 ${Math.round(height * 0.058)}px ${serif}`;
      ctx.shadowColor = 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = 18;
      ctx.fillText(segment.day.title, width / 2, height * 0.46);
      ctx.font = `400 ${Math.round(height * 0.026)}px ${serif}`;
      ctx.fillStyle = 'rgba(242, 231, 203, 0.86)';
      ctx.fillText(segment.day.subtitle, width / 2, height * 0.52);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      // 字幕条
      const sub = segment.day.narration;
      if (sub) {
        ctx.font = `400 ${Math.round(height * 0.028)}px ${serif}`;
        const metrics = ctx.measureText(sub);
        const padX = 26;
        const boxW = Math.min(width * 0.86, metrics.width + padX * 2);
        const boxH = Math.round(height * 0.062);
        const boxX = (width - boxW) / 2;
        const boxY = height - bar - boxH - Math.round(height * 0.05);
        ctx.fillStyle = 'rgba(8, 12, 15, 0.62)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = 'rgba(216, 180, 106, 0.35)';
        ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);
        ctx.fillStyle = '#f4ead2';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sub, width / 2, boxY + boxH / 2 + 1);
        ctx.textBaseline = 'alphabetic';
      }
    } else if (segment?.kind === 'end') {
      const local = elapsed - segment.start;
      const alpha = clamp(local / 0.8, 0, 1);
      const totals = segment.totals;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(6, 10, 12, 0.72)';
      ctx.fillRect(0, bar, width, height - bar * 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2e7cb';
      ctx.font = `600 ${Math.round(height * 0.05)}px ${serif}`;
      ctx.fillText('行程概览', width / 2, height * 0.3);
      ctx.font = `400 ${Math.round(height * 0.03)}px ${serif}`;
      ctx.fillStyle = 'rgba(242, 231, 203, 0.9)';
      ctx.fillText(
        `${totals.days} 天 · ${totals.cities} 座城市 · 约 ${totals.distance_km} 公里`,
        width / 2,
        height * 0.38,
      );
      if (state.qr) {
        const size = Math.round(height * 0.26);
        const x = (width - size) / 2;
        const y = height * 0.45;
        ctx.fillStyle = 'rgba(242, 231, 203, 0.96)';
        ctx.fillRect(x - 10, y - 10, size + 20, size + 20);
        ctx.drawImage(state.qr, x, y, size, size);
        ctx.fillStyle = 'rgba(242, 231, 203, 0.8)';
        ctx.font = `400 ${Math.round(height * 0.022)}px ${serif}`;
        ctx.fillText('扫码回看整份攻略', width / 2, y + size + Math.round(height * 0.05));
      } else {
        ctx.fillStyle = 'rgba(242, 231, 203, 0.8)';
        ctx.font = `400 ${Math.round(height * 0.024)}px ${serif}`;
        ctx.fillText('在「我的攻略」里点分享，可生成回看链接', width / 2, height * 0.55);
      }
      ctx.globalAlpha = 1;
    }
  }

  function updateScene(elapsed) {
    const segment = state.segments.find((item) => elapsed >= item.start && elapsed < item.end);
    if (!segment) return;
    if (segment.kind === 'day') {
      const day = segment.day;
      const local = elapsed - segment.start;
      const dayIndex = state.script.days.indexOf(day);
      if (state.currentDay !== dayIndex + 1 && state.poses?.[dayIndex]) {
        // 进入新的一天：从当前机位飞向当天城市的机位
        state.currentDay = dayIndex + 1;
        state.camFrom = { position: camera.position.toArray(), target: controls.target.toArray() };
        state.camTo = state.poses[dayIndex];
      }
      const p = easeInOutCubic(clamp(local / FLIGHT_SECONDS, 0, 1));
      if (state.camFrom && state.camTo) {
        const position = lerp3(state.camFrom.position, state.camTo.position, p);
        const target = lerp3(state.camFrom.target, state.camTo.target, p);
        camera.position.set(position[0], position[1], position[2]);
        controls.target.set(target[0], target[1], target[2]);
        controls.update();
      }
      // 悬停时轻微环绕，画面不死板
      if (local > FLIGHT_SECONDS) {
        const angle = (local - FLIGHT_SECONDS) * 0.0016;
        const offset = camera.position.clone().sub(controls.target);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        offset.set(offset.x * cos + offset.z * sin, offset.y, -offset.x * sin + offset.z * cos);
        camera.position.copy(controls.target.clone().add(offset));
      }
      if (local < 0.4 && !day.__entered) {
        day.__entered = true;
        // 当天第一站的时间：让晨昏线随行程推进
        const firstHour = day.stops.find((stop) => stop.time)?.time || '09:00';
        const date = sceneDateForClock(firstHour);
        if (date) setSceneDate?.(date);
        cityBridge?.show?.(day);
      }
      if (!day.__shown) day.__shown = true;
    } else if (segment.kind === 'end' && !state.__ending) {
      state.__ending = true;
      cityBridge?.hide?.();
    }
  }

  /** 主渲染循环每帧调用：场景更新（渲染前）。 */
  function tick(now) {
    if (!state.active) return;
    const elapsed = (now - state.startedAt) / 1000;
    updateScene(elapsed);
    const done = state.script.days.filter((day) => day.__entered).length;
    status(
      `正在拍摄：第 ${Math.min(state.script.days.length, done || 1)} / ${state.script.days.length} 天`,
      elapsed / state.script.duration,
    );
    if (elapsed >= state.script.duration) stopRecording({ cancelled: false });
  }

  /** 主渲染循环每帧调用：合成并录制（渲染后，同一帧内画布内容可读）。 */
  function capture(now) {
    if (!state.active) return;
    const elapsed = (now - state.startedAt) / 1000;
    drawFrame(Math.min(elapsed, state.script.duration));
  }

  function stopRecording({ cancelled }) {
    if (!state.active) return;
    state.active = false;
    state.cancelled = cancelled;
    controls.enabled = true;
    cityBridge?.hide?.();
    setSceneLive?.();
    document.body.classList.remove('movie-mode');
    $('movie-live')?.classList.add('hidden');
    try {
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    } catch (error) {
      /* 忽略 */
    }
  }

  async function start(guideId) {
    if (state.active) return;
    if (!canRecord(canvas)) {
      ui?.toast?.('这个浏览器不支持视频录制：请用最新版 Chrome / Edge 打开，再导出旅行电影');
      return;
    }
    openModal();
    state.guideId = guideId;
    status('正在把攻略整理成脚本…', 0.02);
    try {
      const guideResponse = await fetch(`/api/guides/${encodeURIComponent(guideId)}`);
      if (!guideResponse.ok) throw new Error('攻略加载失败');
      const guide = await guideResponse.json();
      const flows = {};
      await Promise.all(
        (guide.items || []).map(async (item) => {
          if (!item?.flowId) return;
          const flow = await fetchFlow(item.flowId);
          if (flow) flows[item.flowId] = flow;
        }),
      );
      const script = buildMovieScript(guide, flows);
      if (!script.days.length) throw new Error('这份攻略还没有可以拍成电影的天数');
      state.script = script;
      state.segments = movieTimeline(script);

      // 音频图与素材
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtor();
      // 导出入口本身是一次点击（用户手势）；这里不 await，避免个别浏览器上 resume 悬挂
      ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(dest);
      master.connect(ctx.destination);
      state.audio = { ctx, dest, master };
      status('正在请数字人录音…', 0.08);
      const [narration, music, qr] = await Promise.all([
        loadNarration(state.segments),
        loadMusic(),
        loadQr(guideId),
      ]);
      state.qr = qr;
      state.segments.forEach((segment) => {
        const buffer = narration.get(segment.start);
        if (!buffer) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(master);
        source.start(ctx.currentTime + 0.35 + segment.start + 0.2);
      });
      if (music) {
        const source = ctx.createBufferSource();
        source.buffer = music;
        source.loop = true;
        const musicGain = ctx.createGain();
        musicGain.gain.value = 0.16;
        source.connect(musicGain).connect(master);
        source.start();
      }

      // 画面合成画布
      const overlay = document.createElement('canvas');
      overlay.width = Math.min(1600, canvas.clientWidth || 1280);
      overlay.height = Math.min(900, canvas.clientHeight || 720);
      state.overlay = overlay;
      state.ctx = overlay.getContext('2d');
      const live = $('movie-live');
      if (live) {
        live.innerHTML = '';
        live.appendChild(overlay);
        live.classList.remove('hidden');
      }

      const stream = overlay.captureStream(30);
      dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      state.stream = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5_000_000 } : undefined);
      state.recorder = recorder;
      state.chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) state.chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(state.chunks, { type: 'video/webm' });
        if (state.cancelled) {
          status('已取消导出');
          state.recorder = null;
          state.chunks = [];
          return;
        }
        const url = URL.createObjectURL(blob);
        const video = $('movie-video');
        const download = $('movie-download');
        if (video) video.src = url;
        if (download) {
          download.href = url;
          download.download = `${(guide.name || '我的攻略').replace(/\s+/g, '')}-旅行电影.webm`;
        }
        $('movie-result')?.classList.remove('hidden');
        status(`完成：约 ${Math.round(state.script.duration)} 秒，可下载或重新播放`);
        onFinish?.({ guideId, blob });
        state.chunks = [];
      };

      // 场景准备
      controls.enabled = false;
      document.body.classList.add('movie-mode');
      state.camFrom = { position: camera.position.toArray(), target: controls.target.toArray() };
      state.camTo = null;
      state.__ending = false;
      state.currentDay = 0;
      script.days.forEach((day) => {
        delete day.__entered;
        delete day.__shown;
      });
      // 每天开场的相机位姿：城市上空，略微俯瞰
      state.poses = script.days.map((day) => {
        const target = worldPosition(day.lng || 0, day.lat || 0, RANGES, 0.05);
        return poseForFocus({ target: target.toArray(), direction: [0, 0.86, 0.52], distance: 1.85 });
      });
      state.active = true;
      state.startedAt = performance.now();
      recorder.start(1000);
      status('正在拍摄旅行电影…', 0.15);
    } catch (error) {
      console.warn('[movie] 导出失败', error);
      status(error.message || '导出失败');
      stopRecording({ cancelled: true });
    }
  }

  function cancel() {
    if (!state.active) {
      closeModal();
      return;
    }
    stopRecording({ cancelled: true });
  }

  return {
    start,
    cancel,
    closeModal,
    tick,
    capture,
    isActive: () => state.active,
    debug: () => ({
      active: state.active,
      script: state.script
        ? { days: state.script.days.length, duration: Math.round(state.script.duration) }
        : null,
      recording: state.recorder?.state || null,
    }),
  };
}
