// 中国等积圆锥投影（Albers）：城市与山脉共用，保证方位真实。

import { STAGE } from './config.js';

const RAD = Math.PI / 180;
const PHI1 = 25 * RAD;
const PHI2 = 47 * RAD;
const PHI0 = 35 * RAD;
const LAMBDA0 = 105 * RAD;

const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(PHI0)) / N;

export const LNG_RANGE = [73, 135];
export const LAT_RANGE = [18, 53];

function raw(lng, lat) {
  const theta = N * (lng * RAD - LAMBDA0);
  const rho = Math.sqrt(Math.max(C - 2 * N * Math.sin(lat * RAD), 0)) / N;
  return { x: rho * Math.sin(theta), y: RHO0 - rho * Math.cos(theta) };
}

const corners = [
  raw(LNG_RANGE[0], LAT_RANGE[0]),
  raw(LNG_RANGE[1], LAT_RANGE[0]),
  raw(LNG_RANGE[0], LAT_RANGE[1]),
  raw(LNG_RANGE[1], LAT_RANGE[1]),
];

const minX = Math.min(...corners.map((item) => item.x));
const maxX = Math.max(...corners.map((item) => item.x));
const minY = Math.min(...corners.map((item) => item.y));
const maxY = Math.max(...corners.map((item) => item.y));
const centerX = (minX + maxX) / 2;
const centerY = (minY + maxY) / 2;
const SCALE = STAGE.mapSpan / (maxX - minX);

/** 经纬度 → 场景平面坐标（y 轴向北）。 */
export function project(lng, lat) {
  const point = raw(lng, lat);
  return { x: (point.x - centerX) * SCALE, y: (point.y - centerY) * SCALE };
}

export const SCENE_SCALE = SCALE;

// 供着色器把屏幕横向位置换算成经度（用于逐片元日照）
const _x1 = (raw(73, 35).x - centerX) * SCALE;
const _x2 = (raw(135, 35).x - centerX) * SCALE;
export const LNG_PER_X = 62 / (_x2 - _x1);
export const LNG_AT_ZERO = 73 + (0 - _x1) * LNG_PER_X;

export function lngLatRange() {
  return { lng: LNG_RANGE, lat: LAT_RANGE };
}

/** 场景坐标 → 经纬度（Albers 逆投影，用于判断当前视野落在哪个省）。 */
export function unprojectScene(x, y) {
  const rawX = x / SCALE + centerX;
  const rawY = y / SCALE + centerY;
  const rho = Math.sign(N) * Math.hypot(rawX, RHO0 - rawY);
  const theta = Math.atan2(rawX, RHO0 - rawY);
  const lng = (LAMBDA0 + theta / N) * (180 / Math.PI);
  const lat = Math.asin(Math.max(-1, Math.min(1, (C - (rho * N) ** 2) / (2 * N)))) * (180 / Math.PI);
  return { lng, lat };
}

/** 每场景单位对应的公里数（用北京—上海实际距离自校准）。 */
export const KM_PER_UNIT = (() => {
  const a = project(116.4074, 39.9042);
  const b = project(121.4737, 31.2304);
  const units = Math.hypot(b.x - a.x, b.y - a.y);
  return units > 0 ? 1067.3 / units : 1200;
})();

/** 场景坐标 → 纱幕/幕布的 UV（用于对齐水墨晕染贴图）。 */
export function toUv(x, y) {
  return { u: x / STAGE.width + 0.5, v: y / STAGE.height + 0.5 };
}

/**
 * 把中国轮廓渲染成一张水墨晕染贴图。
 * @param {number[][][]} rings 经纬度环
 * @param {{width?:number,height?:number,blur?:number,alpha?:number}} options
 */
export function buildOutlineTexture(rings, options = {}) {
  const width = options.width || 1024;
  const height = options.height || Math.round((width * STAGE.height) / STAGE.width);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const path = new Path2D();
  for (const ring of rings) {
    ring.forEach(([lng, lat], index) => {
      const point = project(lng, lat);
      const uv = toUv(point.x, point.y);
      const px = uv.u * width;
      const py = (1 - uv.v) * height;
      if (index === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    });
    path.closePath();
  }

  const gradient = ctx.createLinearGradient(0, height * 0.1, 0, height * 0.9);
  gradient.addColorStop(0, 'rgba(232, 220, 195, 0.30)');
  gradient.addColorStop(0.55, 'rgba(210, 226, 226, 0.20)');
  gradient.addColorStop(1, 'rgba(24, 52, 60, 0.26)');

  ctx.save();
  if (options.blur !== 0) ctx.filter = `blur(${options.blur ?? 26}px)`;
  ctx.fillStyle = gradient;
  ctx.fill(path);
  ctx.restore();

  ctx.save();
  ctx.filter = `blur(${(options.blur ?? 26) * 0.35}px)`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(232, 220, 195, 0.22)';
  ctx.stroke(path);
  ctx.restore();

  return canvas;
}
