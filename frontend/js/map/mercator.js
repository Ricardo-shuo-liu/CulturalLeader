// Web Mercator 投影 + 比例尺（纯函数，node 可直接校验）。
// 腾讯地图 GL 与自建矢量降级底图共用同一套投影，保证「底图与点位同步」。

export const TILE_SIZE = 256;
export const EARTH_CIRCUMFERENCE = 40075016.686;
export const MAX_LATITUDE = 85.05112878;

export function worldSize(zoom) {
  return TILE_SIZE * 2 ** zoom;
}

/** 经纬度 → 世界像素坐标。 */
export function mercatorProject(lng, lat, zoom) {
  const size = worldSize(zoom);
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, Number(lat) || 0));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: (((Number(lng) || 0) + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** 世界像素坐标 → 经纬度（与 mercatorProject 互逆）。 */
export function mercatorUnproject(x, y, zoom) {
  const size = worldSize(zoom);
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat };
}

/** 每像素地面距离（米）。 */
export function groundResolution(lat, zoom) {
  const metersPerPixelAtEquator = EARTH_CIRCUMFERENCE / TILE_SIZE;
  const safeLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  return (metersPerPixelAtEquator * Math.cos((safeLat * Math.PI) / 180)) / 2 ** zoom;
}

const BAR_STEPS = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** 比例尺：在不超过 maxPixels 的前提下取一个好看的整数值。 */
export function scaleBarKm(lat, zoom, maxPixels = 110) {
  const metersPerPixel = groundResolution(lat, zoom);
  const maxKm = (metersPerPixel * maxPixels) / 1000;
  let km = BAR_STEPS[0];
  for (const step of BAR_STEPS) {
    if (step <= maxKm) km = step;
  }
  return { km, pixels: (km * 1000) / metersPerPixel, metersPerPixel };
}

/** 视图状态：中心经纬度 + 缩放级别 + 画布尺寸（像素）。 */
export function createView(center, zoom, width, height) {
  return { center: { lng: center.lng, lat: center.lat }, zoom, width, height };
}

/** 经纬度 → 画布坐标（行政边界、路线、点位全部走这一个变换）。 */
export function projectToScreen(point, view) {
  const centerPx = mercatorProject(view.center.lng, view.center.lat, view.zoom);
  const px = mercatorProject(point.lng, point.lat, view.zoom);
  return { x: view.width / 2 + (px.x - centerPx.x), y: view.height / 2 + (px.y - centerPx.y) };
}

/** 画布坐标 → 经纬度。 */
export function unprojectScreen(x, y, view) {
  const centerPx = mercatorProject(view.center.lng, view.center.lat, view.zoom);
  return mercatorUnproject(centerPx.x + (x - view.width / 2), centerPx.y + (y - view.height / 2), view.zoom);
}

/** 平移：屏幕像素位移 → 新的中心经纬度。 */
export function panView(view, dxPixels, dyPixels) {
  const centerPx = mercatorProject(view.center.lng, view.center.lat, view.zoom);
  const center = mercatorUnproject(centerPx.x - dxPixels, centerPx.y - dyPixels, view.zoom);
  return { ...view, center };
}

/** 以屏幕某点为锚点缩放（锚点下的地理位置保持不动）。 */
export function zoomViewAt(view, factor, anchor) {
  const anchorX = anchor && Number.isFinite(anchor.x) ? anchor.x : view.width / 2;
  const anchorY = anchor && Number.isFinite(anchor.y) ? anchor.y : view.height / 2;
  const anchorPoint = unprojectScreen(anchorX, anchorY, view);
  const zoom = Math.max(3, Math.min(19, view.zoom + Math.log2(factor)));
  // 直接解出新的中心像素：让 anchorPoint 在新缩放下仍落在 (anchorX, anchorY)
  const anchorPx = mercatorProject(anchorPoint.lng, anchorPoint.lat, zoom);
  const center = mercatorUnproject(anchorPx.x - (anchorX - view.width / 2), anchorPx.y - (anchorY - view.height / 2), zoom);
  return { ...view, zoom, center };
}

/** 让一组经纬度点铺满画布（带留白）。 */
export function viewForPoints(points, width, height, padding = 48) {
  const valid = (points || []).filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat));
  if (!valid.length) return createView({ lng: 108.94, lat: 34.26 }, 11, width, height);
  const lngs = valid.map((point) => point.lng);
  const lats = valid.map((point) => point.lat);
  const center = {
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
  const innerWidth = Math.max(80, width - padding * 2);
  const innerHeight = Math.max(80, height - padding * 2);
  let zoom = 3;
  for (let candidate = 19; candidate >= 3; candidate -= 0.25) {
    const view = createView(center, candidate, width, height);
    const topLeft = projectToScreen({ lng: Math.min(...lngs), lat: Math.max(...lats) }, view);
    const bottomRight = projectToScreen({ lng: Math.max(...lngs), lat: Math.min(...lats) }, view);
    if (Math.abs(bottomRight.x - topLeft.x) <= innerWidth && Math.abs(bottomRight.y - topLeft.y) <= innerHeight) {
      zoom = candidate;
      break;
    }
  }
  return createView(center, zoom, width, height);
}
