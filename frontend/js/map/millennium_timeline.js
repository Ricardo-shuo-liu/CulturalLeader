// 千年模式的时间轴：连续纪年、朝代色带、事件刻点、HUD 与「千年一刻」自动播放。
// 纯函数（bandAt / yearText / 事件刻度）在这一层导出，Node 校验直接引用。

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const BLEND_WINDOW = 12; // 跨段形变窗口（年），与后端 bounds.blend_years 一致

/** 「前 210 年」「公元 750 年」「2026 年」——按纪年惯例显示。 */
export function yearText(year) {
  const value = Math.round(year);
  if (value < 0) return `前 ${Math.abs(value)} 年`;
  if (value === 0) return '前 1 年';
  if (value >= 1912) return `${value} 年`;
  return `公元 ${value} 年`;
}

/** 朝代时长（年）：地层柱的层厚按它成比例。 */
export function yearsOfBand(band) {
  return Math.max(1, (band?.end ?? 0) - (band?.start ?? 0));
}

/**
 * 年份 → 时间轴状态：
 * - index：语义上的当期（边界年算后一段）
 * - mixA / mixB / mix：渲染时的两段混合（跨段 12 年窗口内 mix 从 0 走到 1）
 */
export function bandAt(year, bands, blend = BLEND_WINDOW) {
  const n = bands.length;
  const y = clamp(year, bands[0].start, bands[n - 1].end);
  let index = n - 1;
  for (let i = 0; i < n - 1; i += 1) {
    if (y < bands[i].end) {
      index = i;
      break;
    }
  }
  let mixA = index;
  let mixB = index;
  let mix = 0;
  const startBoundary = bands[index].start;
  if (index > 0 && y < startBoundary + blend / 2) {
    mixA = index - 1;
    mixB = index;
    mix = clamp((y - (startBoundary - blend / 2)) / blend, 0, 1);
  } else if (index < n - 1) {
    const endBoundary = bands[index].end;
    if (y > endBoundary - blend / 2) {
      mixA = index;
      mixB = index + 1;
      mix = clamp((y - (endBoundary - blend / 2)) / blend, 0, 1);
    }
  }
  return { index, band: bands[index], mixA, mixB, mix };
}

/** 事件在时间轴上的横向位置（0..1）。 */
export function eventTickLayout(events, bounds) {
  const span = (bounds?.end ?? 1) - (bounds?.start ?? 0) || 1;
  return (events || []).map((event, index) => ({
    index,
    year: event.year,
    ratio: clamp((event.year - bounds.start) / span, 0, 1),
    title: event.title,
  }));
}

/** 拖动 [from, to] 之间跨过的事件（含端点年份）。 */
export function crossedEvents(events, from, to) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  return (events || []).filter((event) => event.year > low && event.year <= high);
}

/** 朝代中点年份（地层柱点击、◀▶ 跳段用）。 */
export function bandMidYear(band) {
  return (band.start + band.end) / 2;
}

const $ = (id) => document.getElementById(id);

/**
 * 时间轴 UI：色带 + 事件刻点 + 滑杆 + HUD + 自动播放。
 * @param {object} options
 * @param {function} options.onSeek  (year, source) => void；source: 'drag' | 'auto' | 'step'
 * @param {function} options.onAutoplayBeat (event) => void
 * @param {function} options.onAutoplayState (running) => void
 */
export function createTimelineUI({ bands, bounds, events, chain = [], onSeek, onAutoplayBeat, onAutoplayState } = {}) {
  const autoplay = { running: false, raf: 0, start: 0, duration: 45000, from: 0, to: 0, readIndex: 0, lastBeat: 0 };
  const state = { year: bounds?.start ?? 0 };

  function ratioOf(year) {
    const span = (bounds.end - bounds.start) || 1;
    return clamp((year - bounds.start) / span, 0, 1);
  }

  function buildBands() {
    const strip = $('mt-bands');
    if (!strip) return;
    strip.innerHTML = '';
    bands.forEach((band) => {
      const width = ratioOf(band.end) - ratioOf(band.start);
      const node = document.createElement('div');
      node.className = 'mt-band';
      node.style.left = `${ratioOf(band.start) * 100}%`;
      node.style.width = `${Math.max(0.01, width) * 100}%`;
      node.style.setProperty('--era-color', band.color);
      const name = document.createElement('span');
      name.textContent = band.name;
      node.appendChild(name);
      strip.appendChild(node);
    });
    const ticks = $('mt-events');
    if (ticks) {
      ticks.innerHTML = '';
      eventTickLayout(events, bounds).forEach((tick) => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'mt-event';
        node.style.left = `${tick.ratio * 100}%`;
        node.title = `${yearText(tick.year)} · ${tick.title}`;
        node.addEventListener('click', (event_) => {
          event_.stopPropagation();
          onSeek?.(tick.year, 'step');
        });
        ticks.appendChild(node);
      });
    }
  }

  function buildChain() {
    const node = $('mt-chain');
    if (!node) return;
    node.innerHTML = '';
    chain.forEach((name, index) => {
      const item = document.createElement('span');
      item.className = 'mt-chain-item';
      item.dataset.index = String(index);
      item.textContent = name;
      node.appendChild(item);
      if (index < chain.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'mt-chain-arrow';
        arrow.textContent = '→';
        node.appendChild(arrow);
      }
    });
  }

  /** 更新 HUD（年份、朝代、改名链高亮）。 */
  function render(timelineState) {
    const band = timelineState.band;
    const yearNode = $('mt-year');
    if (yearNode) yearNode.textContent = yearText(state.year);
    $('millennium-era-name').textContent = band.name;
    const position = $('millennium-position');
    if (position) position.textContent = `${timelineState.index + 1} / ${bands.length}`;
    const range = $('mt-range');
    if (range && Number(range.value) !== Math.round(state.year)) range.value = String(Math.round(state.year));
    document.querySelectorAll('.mt-band').forEach((node, index) => {
      node.classList.toggle('active', index === timelineState.index);
    });
  }

  /** 改名链高亮：按当前段的古名（由调用方给出）点亮。 */
  function setChainActive(ancient) {
    const node = $('mt-chain');
    if (!node) return;
    node.querySelectorAll('.mt-chain-item').forEach((item) => {
      item.classList.toggle('active', Boolean(ancient) && item.textContent === ancient);
    });
  }

  function stopAutoplay() {
    if (!autoplay.running) return;
    autoplay.running = false;
    window.cancelAnimationFrame(autoplay.raf);
    $('millennium-autoplay')?.classList.remove('on');
    onAutoplayState?.(false);
  }

  function autoplayFrame(now) {
    if (!autoplay.running) return;
    const t = clamp((now - autoplay.start) / autoplay.duration, 0, 1);
    const year = autoplay.from + (autoplay.to - autoplay.from) * t;
    onSeek?.(year, 'auto');
    // 事件解说：跨过事件年份就播一条（同一时刻最多一条）
    while (autoplay.readIndex < events.length && events[autoplay.readIndex].year <= year) {
      const event = events[autoplay.readIndex];
      autoplay.readIndex += 1;
      if (now - autoplay.lastBeat > 1200) {
        autoplay.lastBeat = now;
        onAutoplayBeat?.(event);
      }
    }
    if (t >= 1) {
      stopAutoplay();
      return;
    }
    autoplay.raf = window.requestAnimationFrame(autoplayFrame);
  }

  function startAutoplay() {
    if (autoplay.running) return;
    autoplay.from = bounds.start;
    autoplay.to = bounds.end;
    autoplay.readIndex = 0;
    autoplay.lastBeat = 0;
    autoplay.start = performance.now();
    autoplay.running = true;
    $('millennium-autoplay')?.classList.add('on');
    onAutoplayState?.(true);
    autoplay.raf = window.requestAnimationFrame(autoplayFrame);
  }

  function bind() {
    $('mt-range')?.addEventListener('input', (event_) => {
      stopAutoplay();
      onSeek?.(Number(event_.target.value), 'drag');
    });
    $('millennium-autoplay')?.addEventListener('click', () => {
      if (autoplay.running) stopAutoplay();
      else startAutoplay();
    });
  }

  buildBands();
  buildChain();
  bind();

  return {
    setYear(year, timelineState) {
      state.year = year;
      render(timelineState);
    },
    setChainActive,
    startAutoplay,
    stopAutoplay,
    isAutoplaying: () => autoplay.running,
    destroy() {
      stopAutoplay();
    },
  };
}
