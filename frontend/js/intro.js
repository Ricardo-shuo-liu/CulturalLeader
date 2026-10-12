// 开场 30 秒：太空俯冲 → 穿云 → 晨昏线扫过 → 城市次第点亮 → 数字人开场白。
// 每次加载都播（2 秒后可跳过），导航抽屉里有「重播开场」；?intro=0 直接进沙盘（自动化测试用）。

import { createCameraTrack, poseForFocus } from './camera_track.js';
import { worldPosition } from './terrain.js';
import { RANGES } from './data/ranges.js';

const TITLE_END = 2.0;
const DIVE_END = 6.0;
const CLOUD_END = 9.0;
const SWEEP_END = 17.0;
const TOTAL = 22.0;

const CLOCK_START = 4 * 60 + 50; // 04:50，东边先亮
const CLOCK_SWEEP = 19 * 60 + 10; // 19:10，晨昏线扫过大半张版图
const CLOCK_END = 21 * 60 + 30;

const PHASE_TEXT = [
  [TITLE_END, ''],
  [DIVE_END, '从云端俯瞰这片土地'],
  [CLOUD_END, '穿过云层'],
  [SWEEP_END, '晨昏线扫过大地的这一天'],
  [TOTAL, ''],
];

function phaseTextFor(seconds) {
  for (const [limit, text] of PHASE_TEXT) {
    if (seconds <= limit) return text;
  }
  return '';
}

export function createIntro({
  camera,
  controls,
  cityPoints,
  resolveCity,
  home,
  narrate,
  setSceneMinutes,
  setSceneLive,
  onFinish = () => {},
  ui = null,
} = {}) {
  const state = {
    running: false,
    raf: 0,
    start: 0,
    paused: false,
  };
  let track = null;
  let finalPose = null;

  const $ = (id) => document.getElementById(id);

  function overlay() {
    return $('intro');
  }

  function setText(text) {
    const node = $('intro-sub');
    if (node && node.textContent !== text) node.textContent = text;
  }

  function applyPose(sample) {
    camera.position.set(sample.position[0], sample.position[1], sample.position[2]);
    controls.target.set(sample.target[0], sample.target[1], sample.target[2]);
    controls.update();
  }

  function buildTrack() {
    const startPose = {
      position: [0, 14.5, 17.5],
      target: [0, 0.05, 0.1],
    };
    const midPose = {
      position: [0.0, 6.4, 7.6],
      target: [0, 0.05, 0.1],
    };
    const nearPose = {
      position: [0.0, 3.9, 4.6],
      target: [0, 0.05, 0.1],
    };
    // 终点：上次访问的城市（localStorage），否则长安
    let targetCity = null;
    try {
      const last = window.localStorage.getItem('cl.lastCity');
      targetCity = (last && resolveCity?.(last)) || resolveCity?.('西安') || null;
    } catch (error) {
      targetCity = resolveCity?.('西安') || null;
    }
    const cityPoint = targetCity
      ? worldPosition(targetCity.lng, targetCity.lat, RANGES, 0.05)
      : null;
    finalPose = cityPoint
      ? {
          position: [
            cityPoint.x,
            cityPoint.y + 1.9,
            cityPoint.z + 2.0,
          ],
          target: [cityPoint.x, cityPoint.y + 0.1, cityPoint.z],
          label: targetCity.name,
        }
      : { position: [...home.position.toArray()], target: [...home.target.toArray()], label: '' };
    return createCameraTrack([
      { t: 0, ...startPose },
      { t: DIVE_END, ...midPose, ease: 'inCubic' },
      { t: CLOUD_END, ...nearPose, ease: 'outCubic' },
      { t: SWEEP_END, ...nearPose, ease: 'linear' },
      { t: TOTAL, position: finalPose.position, target: finalPose.target, ease: 'inOutCubic' },
    ]);
  }

  function setClock(seconds) {
    if (seconds <= DIVE_END) {
      setSceneMinutes?.(CLOCK_START);
      cityPoints?.setReveal(0);
      return;
    }
    if (seconds <= CLOUD_END) {
      setSceneMinutes?.(CLOCK_START);
      cityPoints?.setReveal(((seconds - DIVE_END) / (CLOUD_END - DIVE_END)) * 0.12);
      return;
    }
    if (seconds <= SWEEP_END) {
      const p = (seconds - CLOUD_END) / (SWEEP_END - CLOUD_END);
      setSceneMinutes?.(CLOCK_START + (CLOCK_SWEEP - CLOCK_START) * p);
      cityPoints?.setReveal(0.12 + 0.88 * Math.min(1, p / 0.86));
      return;
    }
    const p = (seconds - SWEEP_END) / (TOTAL - SWEEP_END);
    setSceneMinutes?.(CLOCK_SWEEP + (CLOCK_END - CLOCK_SWEEP) * p);
    cityPoints?.setReveal(1);
  }

  function frame(now) {
    if (!state.running) return;
    const seconds = Math.min(TOTAL, (now - state.start) / 1000);
    setClock(seconds);
    applyPose(track.sample(seconds));
    // 穿云：幕布水汽在 6–9 秒之间起落
    const veil = $('intro-veil');
    if (veil) {
      const cloud =
        seconds < DIVE_END
          ? Math.max(0, (seconds - TITLE_END) / 2.4)
          : seconds < CLOUD_END
            ? 1 - Math.max(0, (seconds - DIVE_END - 1.1) / 1.9)
            : 0;
      veil.style.opacity = String(Math.min(0.92, cloud));
    }
    setText(phaseTextFor(seconds));
    if (seconds >= 2) $('intro-skip')?.classList.remove('hidden');
    if (seconds >= TOTAL) finish({ skipped: false });
    else state.raf = window.requestAnimationFrame(frame);
  }

  function finish({ skipped }) {
    if (!state.running) return;
    state.running = false;
    window.cancelAnimationFrame(state.raf);
    // 定格拉平：落到终点城，回到实时日照
    if (finalPose) applyPose({ position: finalPose.position, target: finalPose.target });
    controls.enabled = true;
    controls.update();
    cityPoints?.setReveal(1);
    setSceneLive?.();
    const veil = $('intro-veil');
    if (veil) veil.style.opacity = '0';
    overlay()?.classList.add('hidden');
    document.body.classList.remove('intro-mode');
    if (!skipped && narrate) {
      const line = finalPose?.label
        ? `欢迎。这里是${finalPose.label}。把时间交给这片土地，让它自己讲给你听。`
        : '欢迎。把时间交给这片土地，让它自己讲给你听。';
      narrate(line);
    }
    onFinish({ skipped });
  }

  function start({ replay = false } = {}) {
    if (state.running) return;
    if (!replay && new URLSearchParams(window.location.search).get('intro') === '0') return;
    track = buildTrack();
    state.running = true;
    state.start = performance.now();
    controls.enabled = false;
    document.body.classList.add('intro-mode');
    overlay()?.classList.remove('hidden');
    $('intro-skip')?.classList.add('hidden');
    setText('');
    cityPoints?.setReveal(0);
    ui?.toast?.('');
    state.raf = window.requestAnimationFrame(frame);
  }

  function skip() {
    finish({ skipped: true });
  }

  return {
    start,
    skip,
    isActive: () => state.running,
    /** 供浏览器校验读取：当前进度与终点城市 */
    debug: () => ({
      running: state.running,
      elapsed: state.running ? (performance.now() - state.start) / 1000 : TOTAL,
      finalCity: finalPose?.label || null,
      revealed: state.running ? undefined : 1,
    }),
  };
}
