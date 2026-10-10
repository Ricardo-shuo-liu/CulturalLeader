// 行程「播放推演」内核：把计划块/整体攻略编译成时间轨，并按真实时间推进。
// 这里是纯逻辑（不碰 DOM、不碰地图），可以在 Node 里直接单测。

import { clamp, smoothstep, sunAltitudeAt } from '../solar.js';

/** 1× 速度 = 每秒推进 6 模拟分钟（10 小时的行程约 100 秒播完）。 */
export const BASE_MINUTES_PER_SECOND = 6;
export const SPEED_OPTIONS = [1, 2, 4, 8];
/** 城际过渡：按 4× 快进，最长 6 秒；过夜固定 2 秒（都会再除以倍速）。 */
export const TRANSFER_SPEED_FACTOR = 4;
export const TRANSFER_MAX_SECONDS = 6;
export const TRANSFER_MIN_SECONDS = 1.2;
export const NIGHT_SECONDS = 2;

const MODE_LABEL = { walking: '步行', taxi: '驾车', driving: '驾车', transit: '公交', bicycling: '骑行' };

export function clockText(minutes) {
  const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function modeLabel(mode) {
  return MODE_LABEL[mode] || '出行';
}

function secondsToMinutes(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number / 60;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 按北京时间把「绝对分钟」换算成真实 Date（day 0 = 客户端当天）。 */
export function dateForAbsoluteMinutes(absoluteMinutes, now = new Date()) {
  const beijingNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const dayOffset = Math.floor(absoluteMinutes / 1440);
  const minuteOfDay = ((Math.round(absoluteMinutes) % 1440) + 1440) % 1440;
  return new Date(
    Date.UTC(
      beijingNow.getUTCFullYear(),
      beijingNow.getUTCMonth(),
      beijingNow.getUTCDate() + dayOffset,
      Math.floor(minuteOfDay / 60) - 8,
      minuteOfDay % 60,
      0,
    ),
  );
}

/**
 * 把一条 flow（已优化的计划块）编译成当天时间轨。
 * 以 plan.timeline 的到达/离开时间为准，legs 提供每段通勤分钟、公里与方式。
 */
export function buildDayTrack(flow, { dayIndex = 1 } = {}) {
  const plan = flow?.plan || {};
  const timeline = plan.timeline || [];
  const legs = plan.legs || [];
  const points = flow?.points || [];
  const byId = new Map();
  points.forEach((point) => {
    byId.set(point.id, point);
    if (point.name) byId.set(point.name, point);
  });
  const lookup = (item) => byId.get(item?.id) || byId.get(item?.name) || null;

  const nodes = timeline.map((item, index) => {
    const source = lookup(item) || {};
    return {
      index,
      kind: item.kind || (index === 0 ? 'start' : 'stop'),
      id: item.id || source.id || `node-${index}`,
      name: item.name || source.name || `第 ${index + 1} 站`,
      lng: source.lng ?? flow?.city?.lng ?? null,
      lat: source.lat ?? flow?.city?.lat ?? null,
      arrive: secondsToMinutes(item.arrive),
      depart: secondsToMinutes(item.depart, secondsToMinutes(item.arrive)),
      wait: Number(item.wait_minutes) || 0,
    };
  });
  if (!nodes.length) {
    return { dayIndex, flowId: flow?.id || null, city: flow?.city || {}, name: flow?.name || '', nodes: [], legs: [], startMinutes: 0, endMinutes: 0, empty: true };
  }

  const segments = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const from = nodes[i - 1];
    const to = nodes[i];
    const leg = legs[i - 1] || {};
    const minutes = Number.isFinite(Number(leg.minutes))
      ? Number(leg.minutes)
      : Math.max(1, Math.round(to.arrive - from.depart));
    segments.push({
      from,
      to,
      minutes,
      distance_km: Number(leg.distance_km) || 0,
      mode: leg.mode || flow?.transport || 'taxi',
      estimated: Boolean(leg.estimated),
      start: from.depart,
      end: to.arrive,
    });
  }

  const startMinutes = nodes[0].arrive;
  const endMinutes = nodes[nodes.length - 1].depart;
  return {
    dayIndex,
    flowId: flow?.id || null,
    city: flow?.city || {},
    name: flow?.name || '',
    transport: flow?.transport || 'taxi',
    nodes,
    legs: segments,
    startMinutes,
    endMinutes,
    durationMinutes: Math.max(1, endMinutes - startMinutes),
    empty: false,
  };
}

/** 当天某个绝对分钟（0..1440，客户端当天）的快照：旅行者位置、状态、日志、已走路径。 */
export function snapshotDay(track, minutes) {
  const empty = { traveler: null, status: 'idle', entries: [], travelled: [], legIndex: -1, stopIndex: -1, progress: 0 };
  if (!track || track.empty) return empty;
  const clamped = Math.min(Math.max(minutes, track.startMinutes), track.endMinutes);
  const entries = [];
  const travelled = [];
  let traveler = null;
  let status = 'waiting';
  let legIndex = -1;
  let stopIndex = -1;

  const first = track.nodes[0];
  if (first?.lng != null) {
    traveler = { lng: first.lng, lat: first.lat };
    travelled.push({ lng: first.lng, lat: first.lat });
  }
  if (clamped <= first.arrive) {
    entries.push({ time: clockText(first.arrive), kind: 'start', text: `从「${first.name}」出发` });
  } else {
    entries.push({ time: clockText(first.arrive), kind: 'start', text: `从「${first.name}」出发` });
  }

  for (let i = 0; i < track.legs.length; i += 1) {
    const leg = track.legs[i];
    const travelText = `${modeLabel(leg.mode)} ${Math.round(leg.minutes)} 分钟 · ${leg.distance_km.toFixed(1)} km${
      leg.estimated ? '（估算）' : ''
    }`;
    if (clamped >= leg.end) {
      entries.push({ time: clockText(leg.start), kind: 'leg', text: `启程前往「${leg.to.name}」：${travelText}` });
      entries.push({ time: clockText(leg.end), kind: 'arrive', text: `抵达「${leg.to.name}」` });
      if (leg.to.lng != null) travelled.push({ lng: leg.to.lng, lat: leg.to.lat });
      const stay = Math.round(leg.to.depart - leg.to.arrive);
      if (stay > 0) {
        entries.push({ time: clockText(leg.to.depart), kind: 'stay', text: `停留 ${stay} 分钟，离开「${leg.to.name}」` });
      }
      if (leg.to.lng != null) {
        traveler = { lng: leg.to.lng, lat: leg.to.lat };
        status = 'staying';
        stopIndex = leg.to.index;
      }
      continue;
    }
    if (clamped >= leg.start) {
      const ratio = leg.end > leg.start ? (clamped - leg.start) / (leg.end - leg.start) : 1;
      entries.push({ time: clockText(leg.start), kind: 'leg', text: `启程前往「${leg.to.name}」：${travelText}` });
      if (ratio <= 0) {
        // 刚好在出发时刻：仍算「待出发」，旅行者停在上一站
        legIndex = i;
        stopIndex = leg.from.index;
        break;
      }
      if (leg.from.lng != null && leg.to.lng != null) {
        traveler = { lng: lerp(leg.from.lng, leg.to.lng, ratio), lat: lerp(leg.from.lat, leg.to.lat, ratio) };
        travelled.push({ ...traveler });
      }
      status = 'moving';
      legIndex = i;
      stopIndex = leg.to.index;
      break;
    }
  }

  const last = track.nodes[track.nodes.length - 1];
  if (clamped >= track.endMinutes && last) {
    entries.push({ time: clockText(track.endMinutes), kind: 'end', text: `当天行程结束（${last.name}）` });
    status = 'done';
    traveler = last.lng != null ? { lng: last.lng, lat: last.lat } : traveler;
    if (last.lng != null) travelled.push({ lng: last.lng, lat: last.lat });
  }

  return {
    traveler,
    status,
    entries,
    travelled,
    legIndex,
    stopIndex,
    progress: track.durationMinutes ? (clamped - track.startMinutes) / track.durationMinutes : 0,
  };
}

function transferSeconds(minutes, speed) {
  const base = (minutes / BASE_MINUTES_PER_SECOND) / TRANSFER_SPEED_FACTOR;
  return clamp(base, TRANSFER_MIN_SECONDS, TRANSFER_MAX_SECONDS) / Math.max(1, speed);
}

/**
 * 把整份攻略编译成播放列表：第 N 天 → 城际过渡 → 夜间休整 → 第 N+1 天……
 * flowsById：{ [flowId]: flow }，未优化的天会被标记 optimized:false（由 UI 决定是否先优化）。
 */
export function buildGuidePlaylist(guide, flowsById = {}, { speed = 1 } = {}) {
  const items = guide?.items || [];
  const segments = [];
  let absolute = 0;
  let dayOffset = 0;
  let previousCity = null;
  items.forEach((item, index) => {
    const flow = flowsById[item.flowId] || item.flowDetail || null;
    const track = flow ? buildDayTrack(flow, { dayIndex: item.day || index + 1 }) : null;
    const optimized = Boolean(track && !track.empty);
    const dayBase = Math.max(0, (Number(item.day) || index + 1) - 1) * 1440;
    if (index > 0 && item.leg) {
      const minutes = Number(item.leg.minutes) || 0;
      const real = transferSeconds(minutes, speed);
      segments.push({
        kind: 'transfer',
        day: item.day || index + 1,
        from: item.leg.from || previousCity?.name || '',
        to: item.leg.to || flow?.city?.name || '',
        minutes,
        distance_km: Number(item.leg.distance_km) || 0,
        mode: item.leg.mode || 'driving',
        estimated: Boolean(item.leg.estimated),
        startAbs: absolute,
        endAbs: absolute + minutes,
        simDuration: minutes,
        realDuration: real,
      });
      absolute += minutes;
      dayOffset = Math.max(dayOffset, 0);
    }
    if (!optimized) {
      segments.push({
        kind: 'day',
        day: item.day || index + 1,
        flowId: item.flowId,
        optimized: false,
        startAbs: absolute,
        endAbs: absolute,
        simDuration: 0,
        realDuration: 0.4,
        track: null,
      });
      return;
    }
    const startAbs = dayBase + track.startMinutes;
    const endAbs = dayBase + track.endMinutes;
    // 夜间/日间空档：如果上一天结束早于今天开始，插一张「夜间休整」卡（第一天不插）
    if (index > 0 && absolute < startAbs) {
      const gap = startAbs - absolute;
      segments.push({
        kind: 'night',
        day: item.day || index + 1,
        from: previousCity?.name || '',
        to: track.city?.name || '',
        minutes: gap,
        startAbs: absolute,
        endAbs: startAbs,
        simDuration: gap,
        realDuration: NIGHT_SECONDS / Math.max(1, speed),
      });
    }
    segments.push({
      kind: 'day',
      day: item.day || index + 1,
      flowId: item.flowId,
      optimized: true,
      startAbs,
      endAbs,
      simDuration: track.durationMinutes,
      realDuration: track.durationMinutes / (BASE_MINUTES_PER_SECOND * Math.max(1, speed)),
      track,
    });
    absolute = endAbs;
    previousCity = track.city;
  });
  const totalSim = segments.length ? segments[segments.length - 1].endAbs : 0;
  return { segments, totalSim, totalReal: segments.reduce((sum, item) => sum + item.realDuration, 0) };
}

/** 播放器：按真实秒推进，自动在段之间切换（含过渡卡快进与跨夜压缩）。 */
export function createPlayer(playlist, { speed = 1 } = {}) {
  const state = {
    speed: SPEED_OPTIONS.includes(speed) ? speed : 1,
    playing: false,
    elapsed: 0,
    totalReal: playlist?.totalReal || 0,
  };

  function locate(elapsed) {
    const segments = playlist?.segments || [];
    let cursor = 0;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (elapsed < cursor + segment.realDuration || i === segments.length - 1) {
        const ratio = segment.realDuration > 0 ? clamp((elapsed - cursor) / segment.realDuration, 0, 1) : 1;
        const absoluteMinutes = segment.startAbs + segment.simDuration * ratio;
        return { index: i, segment, ratio, absoluteMinutes, elapsedAt: cursor };
      }
      cursor += segment.realDuration;
    }
    return { index: 0, segment: segments[0], ratio: 0, absoluteMinutes: 0, elapsedAt: 0 };
  }

  function snapshotAtAbsolute(absoluteMinutes) {
    const segments = playlist?.segments || [];
    let index = segments.length - 1;
    for (let i = 0; i < segments.length; i += 1) {
      if (absoluteMinutes < segments[i].endAbs) {
        index = i;
        break;
      }
    }
    const segment = segments[index] || null;
    if (!segment) return null;
    const ratio = segment.simDuration > 0 ? clamp((absoluteMinutes - segment.startAbs) / segment.simDuration, 0, 1) : 1;
    // 用「夹住之后」的有效时间，seek(0) 要显示当天出发时刻而不是 00:00
    const effective = segment.startAbs + segment.simDuration * ratio;
    const base = {
      segmentIndex: index,
      kind: segment.kind,
      day: segment.day,
      flowId: segment.flowId || null,
      absoluteMinutes: effective,
      clockText: clockText(effective),
      date: dateForAbsoluteMinutes(effective),
      segment,
      ratio,
    };
    if (segment.kind === 'day' && segment.track) {
      const dayMinutes = ((absoluteMinutes % 1440) + 1440) % 1440;
      const inner = snapshotDay(segment.track, dayMinutes);
      return { ...base, ...inner, track: segment.track, city: segment.track.city };
    }
    const point = segment.kind === 'transfer' ? null : null;
    return { ...base, traveler: point, status: segment.kind, entries: [], travelled: [], track: null };
  }

  return {
    get state() {
      return { ...state };
    },
    get playlist() {
      return playlist;
    },
    play() {
      state.playing = true;
    },
    pause() {
      state.playing = false;
    },
    toggle() {
      state.playing = !state.playing;
    },
    setSpeed(next) {
      const value = SPEED_OPTIONS.includes(Number(next)) ? Number(next) : 1;
      const position = this.snapshot();
      state.speed = value;
      if (position) this.seekAbsolute(position.absoluteMinutes);
    },
    /** 真实秒推进；返回最新快照。 */
    tick(realDeltaSeconds) {
      if (state.playing) state.elapsed = Math.min(state.totalReal, state.elapsed + Math.max(0, realDeltaSeconds));
      if (state.elapsed >= state.totalReal) state.playing = false;
      return this.snapshot();
    },
    snapshot() {
      const located = locate(state.elapsed);
      const snapshot = snapshotAtAbsolute(located.absoluteMinutes);
      if (!snapshot) return null;
      return {
        ...snapshot,
        playing: state.playing,
        speed: state.speed,
        elapsed: state.elapsed,
        totalReal: state.totalReal,
        totalSim: playlist.totalSim,
        realProgress: state.totalReal ? state.elapsed / state.totalReal : 0,
      };
    },
    /** 按绝对分钟定位（进度条拖动/跳站用）。 */
    seekAbsolute(absoluteMinutes) {
      const segments = playlist?.segments || [];
      const target = clamp(absoluteMinutes, 0, playlist.totalSim);
      let cursor = 0;
      for (const segment of segments) {
        if (target <= segment.endAbs || segment === segments[segments.length - 1]) {
          const ratio = segment.simDuration > 0 ? clamp((target - segment.startAbs) / segment.simDuration, 0, 1) : 1;
          state.elapsed = cursor + segment.realDuration * ratio;
          return this.snapshot();
        }
        cursor += segment.realDuration;
      }
      return this.snapshot();
    },
    /** 跳到下一个「抵达」或下一段开始。 */
    skipNext() {
      const snapshot = this.snapshot();
      if (!snapshot) return null;
      const { track, absoluteMinutes, segment } = snapshot;
      if (segment.kind === 'day' && track) {
        const dayMinutes = ((absoluteMinutes % 1440) + 1440) % 1440;
        const next = track.legs.find((leg) => leg.end > dayMinutes + 0.01);
        // 段起点不一定等于当天 0 点（多天时含日期偏移），所以按「离开段的起点」加上当天的分钟差
        if (next) return this.seekAbsolute(segment.startAbs + (next.end - track.startMinutes));
      }
      return this.seekAbsolute(segment.endAbs + 0.01);
    },
  };
}

/** 昼夜层：给定太阳高度角返回夜景遮罩透明度与暮光强度。 */
export function nightAlphaAt(altitude) {
  if (!Number.isFinite(altitude)) return 0;
  // 高度角 +6° 以上完全白天；-6° 以下最暗；中间是暮光过渡
  // 注意别用「反向边」的 smoothstep：显式算 t 更稳，也不会把白天涂黑
  const t = clamp((6 - altitude) / 12, 0, 1);
  return 0.46 * t * t * (3 - 2 * t);
}

export function twilightAt(altitude) {
  if (!Number.isFinite(altitude)) return 0;
  return 1 - Math.min(1, Math.abs(altitude) / 8);
}

/** 采样一屏网格的太阳高度角（给地图昼夜层用，也给单测用）。 */
export function sampleAltitudes(bounds, date, { cols = 64, rows = 40 } = {}) {
  const grid = new Float32Array(cols * rows);
  if (!bounds || !date) return { cols, rows, grid };
  const { minLng, maxLng, minLat, maxLat } = bounds;
  for (let row = 0; row < rows; row += 1) {
    const lat = maxLat + ((minLat - maxLat) * (row + 0.5)) / rows;
    for (let col = 0; col < cols; col += 1) {
      const lng = minLng + ((maxLng - minLng) * (col + 0.5)) / cols;
      grid[row * cols + col] = sunAltitudeAt(lng, lat, date);
    }
  }
  return { cols, rows, grid };
}

/** 晨昏线：给每个经度找高度角过零的纬度（用于在地图上画那条线）。 */
export function terminatorPoints(bounds, date, { rows = 32, steps = 72 } = {}) {
  if (!bounds || !date) return [];
  const points = [];
  const { minLng, maxLng, minLat, maxLat } = bounds;
  // 中国纬度的晨昏线接近竖直：固定纬度、沿经度找高度角过零点更准
  for (let row = 0; row <= rows; row += 1) {
    const lat = minLat + ((maxLat - minLat) * row) / rows;
    let previous = null;
    for (let step = 0; step <= steps; step += 1) {
      const lng = minLng + ((maxLng - minLng) * step) / steps;
      const altitude = sunAltitudeAt(lng, lat, date);
      if (previous && Math.sign(previous.altitude) !== Math.sign(altitude)) {
        const ratio = Math.abs(previous.altitude) / (Math.abs(previous.altitude) + Math.abs(altitude) || 1);
        points.push({ lat, lng: previous.lng + (lng - previous.lng) * ratio });
        break;
      }
      previous = { lng, altitude };
    }
  }
  return points;
}
