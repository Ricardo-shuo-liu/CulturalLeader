// 太阳位置与光照状态：纯函数、无依赖，浏览器与 Node 测试共用。
// 采用 NOAA 简化算法，精度满足本场景（高度角误差 < 0.5°，日出日落误差 < 2 分钟）。

import { LIGHT_STOPS, PALETTE } from './config.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const HORIZON_REFRACTION = -0.833; // 地平线折射修正（度）

export function norm360(value) {
  return ((value % 360) + 360) % 360;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** 太阳赤纬（度）与均时差（分钟）等几何量。 */
export function solarGeometry(date) {
  const n = julianDay(date) - 2451545.0;
  const meanLongitude = norm360(280.46 + 0.9856474 * n);
  const meanAnomaly = norm360(357.528 + 0.9856003 * n);
  const eclipticLongitude = norm360(
    meanLongitude + 1.915 * Math.sin(meanAnomaly * RAD) + 0.02 * Math.sin(2 * meanAnomaly * RAD),
  );
  const obliquity = 23.439 - 0.0000004 * n;
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(eclipticLongitude * RAD)) * DEG;
  const rightAscension = norm360(
    Math.atan2(Math.cos(obliquity * RAD) * Math.sin(eclipticLongitude * RAD), Math.cos(eclipticLongitude * RAD)) * DEG,
  );
  let diff = meanLongitude - rightAscension;
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  return {
    declination,
    equationOfTime: 4 * diff,
    meanLongitude,
    meanAnomaly,
    eclipticLongitude,
    obliquity,
  };
}

export function utcHours(date) {
  return (
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3600000
  );
}

/** 时角（度）：正午为 0，下午为正。东经为正。 */
export function hourAngle(lng, date, geometry) {
  const geo = geometry || solarGeometry(date);
  return 15 * (utcHours(date) + geo.equationOfTime / 60 + lng / 15 - 12);
}

export function sunAltitudeAt(lng, lat, date, geometry) {
  const geo = geometry || solarGeometry(date);
  const H = hourAngle(lng, date, geo) * RAD;
  const dec = geo.declination * RAD;
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  return Math.asin(clamp(sinAlt, -1, 1)) * DEG;
}

/** 方位角（度，正北为 0，顺时针）。 */
export function sunAzimuthAt(lng, lat, date, geometry) {
  const geo = geometry || solarGeometry(date);
  const H = hourAngle(lng, date, geo) * RAD;
  const dec = geo.declination * RAD;
  const phi = lat * RAD;
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) * DEG;
  return norm360(azimuth + 180);
}

/** 日出日落（返回 UTC 时间，极昼极夜返回 null）。 */
export function sunriseSunset(lng, lat, date, geometry) {
  const geo = geometry || solarGeometry(date);
  const phi = lat * RAD;
  const dec = geo.declination * RAD;
  const cosH = (Math.sin(HORIZON_REFRACTION * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) {
    return { sunrise: null, sunset: null, polar: true };
  }
  const H0 = Math.acos(cosH) * DEG;
  const noonUtcHours = 12 - geo.equationOfTime / 60 - lng / 15;
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return {
    sunrise: new Date(base + (noonUtcHours - H0 / 15) * 3600000),
    sunset: new Date(base + (noonUtcHours + H0 / 15) * 3600000),
    polar: false,
  };
}

export function phaseOf(altitude) {
  if (altitude >= 6) return 'day';
  if (altitude >= -0.833) return altitude >= 2 ? 'day' : 'dawn';
  if (altitude >= -12) return 'dusk';
  return 'night';
}

export function phaseLabel(phase) {
  return { day: '白昼', dawn: '黎明', dusk: '黄昏', night: '夜晚' }[phase] || '白昼';
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const int = parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((item) => item / 255);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 按真实高度角插值出整套光照参数。 */
export function lightingFor(altitude) {
  const stops = LIGHT_STOPS;
  let index = 0;
  while (index < stops.length - 2 && altitude > stops[index + 1].alt) index += 1;
  const a = stops[index];
  const b = stops[Math.min(index + 1, stops.length - 1)];
  const span = b.alt - a.alt || 1;
  const t = clamp((altitude - a.alt) / span, 0, 1);
  const ease = t * t * (3 - 2 * t);

  return {
    sunRgb: mixRgb(hexToRgb(a.sun), hexToRgb(b.sun), ease),
    sunIntensity: lerp(a.intensity, b.intensity, ease),
    ambientRgb: mixRgb(hexToRgb(a.ambient), hexToRgb(b.ambient), ease),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, ease),
    tint: lerp(a.tint, b.tint, ease),
    cityBoost: lerp(a.city, b.city, ease),
    nightFactor: smoothstep(3, -8, altitude),
  };
}

/** 面向 UI 与着色器的一次性状态采样。 */
export function sampleLighting(date, lng = 105, lat = 35) {
  const geometry = solarGeometry(date);
  const altitude = sunAltitudeAt(lng, lat, date, geometry);
  const azimuth = sunAzimuthAt(lng, lat, date, geometry);
  const phase = phaseOf(altitude);
  return {
    date,
    geometry,
    altitude,
    azimuth,
    phase,
    phaseLabel: phaseLabel(phase),
    ...lightingFor(altitude),
  };
}

/** 太阳方向单位向量（场景坐标：x 向东，y 向北，z 朝观察者）。 */
export function sunDirection(altitude, azimuth) {
  const alt = altitude * RAD;
  const az = azimuth * RAD;
  return [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
}

export const PALETTE_EXPORT = PALETTE;
