// 行程规划的纯函数工具（不依赖 DOM / three，可用 node 直接校验）。

export const DAY_COLORS = [
  '#f2c879', // 金
  '#5ac8d8', // 青
  '#57c08a', // 绿
  '#d98a5a', // 赭
  '#9e8cd8', // 紫
  '#e0645f', // 朱
  '#7fb2ff', // 蓝
  '#c9a227', // 土黄
];

export const LOD = { far: 7.6, mid: 5.2 };

/** 按天取色（稳定循环）。 */
export function dayColor(index) {
  const value = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return DAY_COLORS[value % DAY_COLORS.length];
}

/** 当前时段 → 推荐桶。 */
export function bucketForHour(hour) {
  if (hour < 10) return 'breakfast';
  if (hour < 14) return 'lunch';
  if (hour < 17) return 'coffee';
  if (hour < 20) return 'dinner';
  return 'night';
}

const BIG_TIERS = new Set(['municipality', 'sar', 'subprovincial', 'capital']);

// 视野宽度超过这个值（公里）就认为还在"全国尺度"，只显示重点城市；
// 缩进到省级范围后，显示落在视野内的所有城市。
export const PROVINCE_VIEW_KM = 1200;

/**
 * 按当前视野自动决定显示哪些城市（纯函数，便于测试）：
 *  - 全国尺度（视野宽度 ≥ PROVINCE_VIEW_KM）：只显示直辖市/省会/计划单列市
 *  - 省级尺度：显示视野范围内的全部地级市（即"进入这个省才看到这个省的城市"）
 * @param {Array} cities 城市清单（含 lng/lat/tier）
 * @param {{minLng:number,maxLng:number,minLat:number,maxLat:number,widthKm:number,margin?:number}} view
 */
export function visibleCitiesForView(cities, view) {
  if (!view) return { cities: [], labelCities: [], level: 'national', widthKm: 0 };
  const margin = view.margin ?? 0.15;
  const spanLng = Math.max(view.maxLng - view.minLng, 1e-4);
  const spanLat = Math.max(view.maxLat - view.minLat, 1e-4);
  const minLng = view.minLng - spanLng * margin;
  const maxLng = view.maxLng + spanLng * margin;
  const minLat = view.minLat - spanLat * margin;
  const maxLat = view.maxLat + spanLat * margin;

  if ((view.widthKm ?? 0) >= PROVINCE_VIEW_KM) {
    const keyCities = cities.filter((city) => BIG_TIERS.has(city.tier));
    return { cities: keyCities, labelCities: keyCities, level: 'national', widthKm: view.widthKm };
  }

  const inView = cities.filter(
    (city) => city.lng >= minLng && city.lng <= maxLng && city.lat >= minLat && city.lat <= maxLat,
  );
  return { cities: inView, labelCities: inView, level: 'province', widthKm: view.widthKm };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * 拖拽落点 → 插入下标。
 * @param {{x:number,y:number}[]} points 已排序点位在屏幕上的坐标（不含起终点）
 * @param {{x:number,y:number}} drop 松手位置
 * @returns {number} 插入下标（0..points.length）
 */
export function insertIndexForDrop(points, drop) {
  if (!points || points.length === 0) return 0;
  if (points.length === 1) {
    return drop.x < points[0].x ? 0 : 1;
  }
  let best = { index: points.length, distance: Infinity };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const distance = distanceToSegment(drop.x, drop.y, a.x, a.y, b.x, b.y);
    if (distance < best.distance) best = { index: i + 1, distance };
  }
  // 落在首点之前 / 末点之后
  const first = points[0];
  const last = points[points.length - 1];
  const ahead = distanceToSegment(drop.x, drop.y, first.x - 60, first.y, first.x, first.y);
  const behind = distanceToSegment(drop.x, drop.y, last.x, last.y, last.x + 60, last.y);
  if (ahead < best.distance) return 0;
  if (behind < best.distance) return points.length;
  return best.index;
}

/** 两个经纬度点之间的球面距离（公里）。 */
export function haversineKm(a, b) {
  const radius = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 折线总长（公里），用于离线地图的比例尺与标注。 */
export function polylineLengthKm(points) {
  let total = 0;
  for (let i = 1; i < (points || []).length; i += 1) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

/** 把一组经纬度投影到画布坐标（含留白），用于没有腾讯地图 JS Key 时的降级显示。 */
export function projectToBox(points, width, height, padding = 36) {
  const valid = (points || []).filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat));
  if (!valid.length) return [];
  const lngs = valid.map((point) => point.lng);
  const lats = valid.map((point) => point.lat);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  if (maxLng - minLng < 1e-4) {
    minLng -= 0.01;
    maxLng += 0.01;
  }
  if (maxLat - minLat < 1e-4) {
    minLat -= 0.01;
    maxLat += 0.01;
  }
  return points.map((point) => {
    if (!Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) return { x: 0, y: 0 };
    const x = padding + ((point.lng - minLng) / (maxLng - minLng)) * (width - padding * 2);
    const y = height - padding - ((point.lat - minLat) / (maxLat - minLat)) * (height - padding * 2);
    return { x, y, lng: point.lng, lat: point.lat };
  });
}
