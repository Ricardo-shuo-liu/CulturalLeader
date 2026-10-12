// 千年模式的共享形态参数：城市性格 × 朝代形态 → 画面/剪影/地标共用的同一份参数。

import { project } from '../geo.js';

/** 每座城的性格：决定银幕/剪影里出现船、驼队、运河还是中轴。 */
export const CITY_ACCENTS = {
  西安: { axis: true },
  洛阳: { river: true, axis: true },
  北京: { axis: true, walls: 1.12 },
  南京: { river: true, walls: 1.08, boats: 0.6 },
  成都: { river: true, gardens: true },
  杭州: { lake: true, boats: true },
  苏州: { canal: true, boats: true, gardens: true },
  敦煌: { dunes: true, caves: true, caravans: true },
  泉州: { harbor: true, boats: 1 },
  开封: { canal: true, boats: true },
};

/** 11 段朝代的城市形态：墙高、宫室、塔、城门、市井、桥梁、园林、现代高楼。 */
export const ERA_ARCHETYPES = [
  { walls: 0.55, palace: 0.5, pagoda: 0, gate: 0.1, houses: 0.25, temples: 0 }, // 秦
  { walls: 0.6, palace: 0.8, pagoda: 0, gate: 0.2, houses: 0.32, temples: 0 }, // 汉
  { walls: 0.5, palace: 0.55, pagoda: 1, gate: 0.25, houses: 0.3, temples: 1 }, // 三国
  { walls: 0.55, palace: 0.5, pagoda: 1, gate: 0.3, houses: 0.34, temples: 1 }, // 晋
  { walls: 0.7, palace: 0.75, pagoda: 0, gate: 0.5, houses: 0.4, temples: 0 }, // 隋
  { walls: 0.85, palace: 1, pagoda: 1, gate: 0.6, houses: 0.55, temples: 0, bridges: 1 }, // 唐
  { walls: 0.7, palace: 0.7, pagoda: 1, gate: 0.5, houses: 0.5, temples: 0, bridges: 1 }, // 宋
  { walls: 0.6, palace: 0.6, pagoda: 1, gate: 0.4, houses: 0.45, temples: 0 }, // 元
  { walls: 1, palace: 0.9, pagoda: 0, gate: 0.8, houses: 0.5, temples: 0 }, // 明
  { walls: 1, palace: 0.85, pagoda: 0, gate: 0.8, houses: 0.45, temples: 0, gardens: 1 }, // 清
  { walls: 0, palace: 0, pagoda: 0, gate: 0, houses: 0.8, temples: 0, towers: 1 }, // 现代
];

/** 城市 + 朝代 → 画面参数（缺省回落到通例）。 */
export function sceneParams(cityName, eraIndex) {
  const accent = CITY_ACCENTS[cityName] || {};
  const archetype = ERA_ARCHETYPES[Math.max(0, Math.min(ERA_ARCHETYPES.length - 1, eraIndex))] || ERA_ARCHETYPES[0];
  const walls = Math.min(1.25, (archetype.walls || 0) * (accent.walls || 1));
  return {
    walls,
    palace: archetype.palace || 0,
    pagoda: archetype.pagoda || 0,
    gate: archetype.gate || 0,
    houses: archetype.houses || 0,
    temples: archetype.temples || 0,
    bridges: archetype.bridges || 0,
    gardens: archetype.gardens || 0,
    towers: archetype.towers || 0,
    river: Boolean(accent.river),
    canal: Boolean(accent.canal),
    lake: Boolean(accent.lake),
    boats: accent.boats || (accent.harbor || accent.river || accent.lake || accent.canal ? 0.7 : 0),
    harbor: Boolean(accent.harbor),
    dunes: Boolean(accent.dunes),
    caves: Boolean(accent.caves),
    caravans: Boolean(accent.caravans),
    axis: Boolean(accent.axis),
  };
}

const NUMERIC_KEYS = [
  'walls',
  'palace',
  'pagoda',
  'gate',
  'houses',
  'temples',
  'bridges',
  'gardens',
  'towers',
  'boats',
];
const FLAG_KEYS = ['river', 'canal', 'lake', 'harbor', 'dunes', 'caves', 'caravans', 'axis'];

/** 两个朝代的形态之间连续插值：拖动年份时，墙在长、塔在升、楼群在起。 */
export function interpolateParams(a, b, t) {
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  const left = a || {};
  const right = b || a || {};
  const out = {};
  NUMERIC_KEYS.forEach((key) => {
    const from = Number(left[key]) || 0;
    const to = Number(right[key]) || 0;
    out[key] = from + (to - from) * k;
  });
  FLAG_KEYS.forEach((key) => {
    out[key] = Boolean(left[key]) || Boolean(right[key]);
  });
  return out;
}

/** 天空三段色（按日高度角切换）。 */
export function skyPalette(altitude) {
  if (altitude >= 6) return { top: '#3f6c9c', mid: '#7ba7c9', low: '#c9d9e2', ground: '#6f7f6a' };
  if (altitude >= -4) return { top: '#3a4a75', mid: '#9c7f8e', low: '#e0a672', ground: '#5d5f55' };
  if (altitude >= -12) return { top: '#1d2542', mid: '#3d3f63', low: '#7a5f74', ground: '#3a3d42' };
  return { top: '#0b1024', mid: '#151d38', low: '#232c4c', ground: '#23272e' };
}

/** 日照时段（环幕只在换段时重画天空）。 */
export function skyPhase(altitude) {
  if (altitude >= 6) return 'day';
  if (altitude >= -4) return 'golden';
  if (altitude >= -12) return 'twilight';
  return 'night';
}

/**
 * 锁定城市在地图上的方位（弧度，0 = 正北，顺时针）。
 * 场景里北为 -z、东为 +x；project() 的 y 轴即为北向分量。
 */
export function bearingOf(lng, lat) {
  const point = project(lng, lat);
  return Math.atan2(point.x, point.y);
}

/** 环上某方位、某半径处的场景坐标（north = -z）。 */
export function ringPosition(bearing, radius, y = 0) {
  return { x: Math.sin(bearing) * radius, y, z: -Math.cos(bearing) * radius };
}

/** 两个方位之间的最短夹角（弧度，用于判断"城市段"绕环的连续排布）。 */
export function wrapAngleDelta(a, b) {
  let diff = (a - b) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
