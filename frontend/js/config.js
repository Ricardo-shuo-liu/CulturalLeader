// 舞台参数：改这里即可调整观感，不需要动着色器代码。

export const PALETTE = {
  inkDeep: '#05090c',
  inkBase: '#0a161b',
  land: '#20434f',
  landHigh: '#366c79',
  ridge: '#59929f',
  paper: '#e8dcc3',
  gold: '#f2c879',
  cityCore: '#fff3d6',
  sunDay: '#fff3e0',
  sunLow: '#ffd9a0',
  sunHorizon: '#ffb870',
  dusk: '#9c7fa8',
  twilight: '#6a5c8c',
  moon: '#3b4a6b',
  skyDay: '#8fb2c9',
  skyNight: '#16233a',
};

export const STAGE = {
  mapSpan: 5.0, // 中国版图横向跨度（世界单位）
  relief: 0.58, // 最高峰隆起高度
  grid: { cols: 340, rows: 196 },
  camera: {
    fov: 32,
    position: [0, 3.9, 5.1],
    target: [0, 0.05, 0.1],
    minDistance: 0.35,
    maxDistance: 11,
    minPolar: 0.16,
    maxPolar: 1.34,
    panLimit: 2.4,
    damping: 0.07,
  },
  transitionMs: 900,
  closeMs: 700,
  cityCoreSize: 0.085,
  cityHoverPx: 30,
  maxPixelRatio: 2,
};

// 幕布退到舞台后方，作为整块背景
export const BACKDROP = {
  z: -13.5,
  width: 120,
  height: 66,
  foldCount: 9,
  foldDepth: 0.55,
  spread: 9.5, // 拉开时每片外移距离
};

export const GROUND = { width: 64, depth: 46 };
export const SKY = { radius: 120 };

export const LIGHT_STOPS = [
  { alt: -18, sun: '#1B2A45', intensity: 0.10, ambient: '#1B2C45', ambientIntensity: 0.36, tint: 1.0, city: 1.0 },
  { alt: -12, sun: '#2C3E60', intensity: 0.13, ambient: '#22314C', ambientIntensity: 0.40, tint: 1.0, city: 0.94 },
  { alt: -6, sun: '#6A5C8C', intensity: 0.20, ambient: '#404B6E', ambientIntensity: 0.42, tint: 0.86, city: 0.78 },
  { alt: -3, sun: '#9C7FA8', intensity: 0.32, ambient: '#5A5A78', ambientIntensity: 0.40, tint: 0.62, city: 0.58 },
  { alt: 0, sun: '#FFB870', intensity: 0.64, ambient: '#8A8398', ambientIntensity: 0.46, tint: 0.34, city: 0.34 },
  { alt: 3, sun: '#FFD9A0', intensity: 0.84, ambient: '#9CB3C4', ambientIntensity: 0.50, tint: 0.14, city: 0.18 },
  { alt: 12, sun: '#FFF3E0', intensity: 1.00, ambient: '#8FB2C9', ambientIntensity: 0.55, tint: 0.0, city: 0.06 },
  { alt: 60, sun: '#FFFFFF', intensity: 1.05, ambient: '#9CC0D6', ambientIntensity: 0.60, tint: 0.0, city: 0.0 },
];
