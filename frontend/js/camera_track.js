// 关键帧运镜内核：把「起点 → 途经点 → 定格」编译成一条按时间采样的相机轨迹。
// 开场俯冲（A1）与旅行电影（A3）共用；纯数学、无依赖，Node 校验可直接引用。

const EASINGS = {
  linear: (t) => t,
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuint: (t) => 1 - (1 - t) ** 5,
};

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 二次贝塞尔（起点、控制点、终点），用于俯冲/穿云这种带弧度的段。 */
export function quadBezier3(p0, p1, p2, t) {
  const k = clamp01(t);
  const inv = 1 - k;
  return [
    inv * inv * p0[0] + 2 * inv * k * p1[0] + k * k * p2[0],
    inv * inv * p0[1] + 2 * inv * k * p1[1] + k * k * p2[1],
    inv * inv * p0[2] + 2 * inv * k * p1[2] + k * k * p2[2],
  ];
}

/**
 * @param {Array} keyframes [{ t（秒）, position: [x,y,z], target: [x,y,z], ease?, via?（二次贝塞尔控制点）}]
 * @param {string} defaultEase
 */
export function createCameraTrack(keyframes, { defaultEase = 'inOutCubic' } = {}) {
  const frames = (keyframes || [])
    .map((frame) => ({
      t: Number(frame.t) || 0,
      position: [...(frame.position || [0, 0, 0])],
      target: [...(frame.target || [0, 0, 0])],
      ease: frame.ease || defaultEase,
      via: frame.via ? [...frame.via] : null,
    }))
    .sort((a, b) => a.t - b.t);
  if (!frames.length) throw new Error('运镜至少需要一个关键帧');

  const duration = frames[frames.length - 1].t;

  function sample(time) {
    const seconds = Math.max(0, Number(time) || 0);
    if (frames.length === 1 || seconds <= frames[0].t) {
      return {
        position: [...frames[0].position],
        target: [...frames[0].target],
        done: frames.length === 1,
        duration,
      };
    }
    for (let index = 0; index < frames.length - 1; index += 1) {
      const from = frames[index];
      const to = frames[index + 1];
      if (seconds > to.t) continue;
      const span = to.t - from.t || 1;
      const raw = clamp01((seconds - from.t) / span);
      const ease = EASINGS[to.ease] || EASINGS[defaultEase] || EASINGS.linear;
      const k = ease(raw);
      const position = to.via
        ? quadBezier3(from.position, to.via, to.position, k)
        : lerp3(from.position, to.position, k);
      return { position, target: lerp3(from.target, to.target, k), done: false, duration };
    }
    const last = frames[frames.length - 1];
    return { position: [...last.position], target: [...last.target], done: true, duration };
  }

  return { sample, duration, keyframes: frames };
}

/** 给「按视野宽度巡航」的场景用：从一个世界坐标点反推相机位姿（保持当前方向）。 */
export function poseForFocus({ target, direction, distance, heightRatio = 0.5 }) {
  const dir = direction || [0, 0.72, 0.7];
  const norm = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const position = [
    target[0] + (dir[0] / norm) * distance,
    target[1] + (dir[1] / norm) * distance * heightRatio + distance * 0.18,
    target[2] + (dir[2] / norm) * distance,
  ];
  return { position, target: [...target] };
}
