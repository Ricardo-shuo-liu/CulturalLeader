// 城内地图视图：腾讯地图 GL（TMap）优先 —— 连续拖拽 / 滚轮与双指缩放 / 双击放大 / 比例尺 / 指北针；
// 没有 JS Key 或脚本加载失败时自动降级为自建矢量底图（同一套 Web Mercator 投影 + 行政区边界 + 我们的路线）。

import { createView, mercatorUnproject, panView, projectToScreen, scaleBarKm, unprojectScreen, viewForPoints, zoomViewAt } from './mercator.js';
import { nightAlphaAt, terminatorPoints, twilightAt } from './playback.js';
import { sunAltitudeAt } from '../solar.js';

const SCRIPT_BASE = 'https://map.qq.com/api/gljs?v=1.exp';

/** 懒加载腾讯地图 GL JS API（Key 由 /api/config 下发）。 */
export async function loadTencentMap({ key } = {}) {
  if (!key) return null;
  if (window.TMap) return window.TMap;
  await new Promise((resolve) => {
    const existing = document.querySelector('script[data-tmap]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', resolve, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `${SCRIPT_BASE}&key=${encodeURIComponent(key)}`;
    script.dataset.tmap = '1';
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
    setTimeout(resolve, 8000);
  });
  // GL 脚本加载完成后才会挂上 TMap
  for (let i = 0; i < 20 && !window.TMap; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return window.TMap || null;
}

function createOverlay(container) {
  const box = document.createElement('div');
  box.className = 'map-overlay';
  box.innerHTML = `
    <button type="button" class="map-compass" title="指北针（点击回到全览）" aria-label="指北针">
      <span class="map-compass-n">N</span>
      <span class="map-compass-needle"></span>
    </button>
    <div class="map-scalebar"><span class="map-scalebar-bar"></span><span class="map-scalebar-text"></span></div>
    <div class="map-attribution"></div>`;
  container.appendChild(box);
  return {
    root: box,
    compass: box.querySelector('.map-compass'),
    bar: box.querySelector('.map-scalebar-bar'),
    text: box.querySelector('.map-scalebar-text'),
    attribution: box.querySelector('.map-attribution'),
  };
}

/**
 * 创建地图视图（腾讯 GL 或自建矢量降级），统一接口：
 *   setPoints({points,color,city}) · setSelected(id) · screenPositions()
 *   refresh() · fit() · zoomBy(factor) · kind · destroy()
 */
export function createMapView({ container, tmap, onStopClick, onMapClick } = {}) {
  const kind = tmap ? 'tencent' : 'canvas';
  const overlay = createOverlay(container);
  let map = null;
  let line = null;
  // 腾讯 GL 没有 TMap.Marker（只有 MultiMarker，且不支持自定义 HTML），
  // 所以点位标记用自绘 DOM 层：跟随地图移动/缩放，可点击、可长按拖拽。
  let markerLayer = null;
  const markerNodes = new Map();
  let legLayer = null;
  const legNodes = [];
  // 推演：旅行者光点、已走路径、昼夜层
  let travelerNode = null;
  let travelerPoint = null;
  let travelledPoints = [];
  let travelledLine = null;
  let nightCanvas = null;
  let nightCtx = null;
  let nightSmall = null;
  let nightImage = null;
  let nightDate = null;
  let nightEnabled = false;
  let nightAt = 0;
  let ignoreClicksUntil = 0;
  let points = [];
  let color = '#f2c879';
  let selectedId = null;
  let canvas = null;
  let ctx = null;
  let boundary = null;
  let boundaryCode = null;
  let suppressClick = false;
  const view = createView({ lng: 108.94, lat: 34.26 }, 11.5, 800, 600);
  const toScreen = (point) => projectToScreen(point, view);

  if (tmap) {
    map = new tmap.Map(container, {
      center: new tmap.LatLng(34.26, 108.94),
      zoom: 11,
      pitch: 0,
      viewMode: '2D',
      doubleClickZoom: true,
      baseMap: { type: 'vector' },
    });
    if (typeof map.on === 'function') {
      const update = () => {
        renderOverlayInfo();
        updateMarkerPositions();
        updateLegLabelPositions();
        renderTraveller();
        renderNightLayer();
      };
      ['zoom', 'center_changed', 'bounds_changed', 'idle', 'moving'].forEach((event) => {
        try {
          map.on(event, update);
        } catch (error) {
          /* 事件名不支持时忽略 */
        }
      });
      // 点击空白处 → 交给上层「在这里加一个点位」（双击缩放不触发）
      try {
        map.on('click', (event) => {
          if (suppressClick || !event?.latLng || mapClickBlocked(event)) return;
          const rect = container.getBoundingClientRect();
          const screen = { x: (event.point?.x ?? 0) || rect.width / 2, y: (event.point?.y ?? 0) || rect.height / 2 };
          scheduleMapClick({ lng: event.latLng.getLng(), lat: event.latLng.getLat() }, screen);
        });
      } catch (error) {
        /* 事件名不支持时忽略 */
      }
    }
  } else {
    canvas = document.createElement('canvas');
    canvas.className = 'planner-canvas';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  function containerSize() {
    const rect = container.getBoundingClientRect();
    return { width: Math.max(320, Math.round(rect.width)), height: Math.max(240, Math.round(rect.height)) };
  }

  function renderOverlayInfo() {
    const zoom = kind === 'tencent' ? (map?.getZoom?.() ?? 11) : view.zoom;
    const center =
      kind === 'tencent' && map?.getCenter
        ? { lng: map.getCenter().getLng(), lat: map.getCenter().getLat() }
        : view.center;
    const { km, pixels } = scaleBarKm(center.lat, zoom, 100);
    overlay.bar.style.width = `${Math.max(36, Math.round(pixels))}px`;
    overlay.text.textContent = km >= 1 ? `${km} 公里` : `${Math.round(km * 1000)} 米`;
    overlay.attribution.textContent =
      kind === 'tencent' ? '腾讯地图 · 可拖拽/滚轮缩放/双击放大' : '离线矢量底图 · 可拖拽/滚轮缩放/双击放大';
  }

  function clearOverlays() {
    if (line) {
      line.setMap?.(null);
      line = null;
    }
  }

  /** 容器坐标（projectToContainer 返回的就是容器坐标，不需要再减 rect.left/top）。 */
  function pointPixel(point) {
    if (!map?.projectToContainer || !window.TMap) return null;
    const pixel = map.projectToContainer(new window.TMap.LatLng(point.lat, point.lng));
    if (!pixel || !Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return null;
    return { x: pixel.x, y: pixel.y };
  }

  function ensureMarkerLayer() {
    if (markerLayer) return markerLayer;
    markerLayer = document.createElement('div');
    markerLayer.className = 'map-markers';
    container.appendChild(markerLayer);
    return markerLayer;
  }

  /** 我们自己浮层上的点击（取点弹窗、指北针、标记）不算“点地图”，取消后也不再立刻弹回来。 */
  function mapClickBlocked(event) {
    if (Date.now() < ignoreClicksUntil) return true;
    const target = event?.domEvent?.target || event?.originalEvent?.target || event?.target || null;
    if (target && typeof target.closest === 'function') {
      return Boolean(target.closest('.map-picker, .map-overlay, .map-markers, .map-legs'));
    }
    return false;
  }

  function ensureLegLayer() {
    if (legLayer) return legLayer;
    legLayer = document.createElement('div');
    legLayer.className = 'map-legs';
    container.appendChild(legLayer);
    return legLayer;
  }

  /** 每段通勤时长/里程的小标签（只在地图上有顺序、且算过通勤时显示）。 */
  function renderLegLabels() {
    const layer = ensureLegLayer();
    layer.innerHTML = '';
    legNodes.length = 0;
    points.slice(0, -1).forEach((point, index) => {
      const leg = point.leg;
      if (!leg || leg.minutes == null) return;
      const node = document.createElement('div');
      node.className = 'map-leg';
      node.textContent = `${Math.round(leg.minutes)} 分钟 · ${Number(leg.distance_km || 0).toFixed(1)} km${
        leg.estimated ? '（估算）' : ''
      }`;
      layer.appendChild(node);
      legNodes.push({ node, from: point, to: points[index + 1] });
    });
    updateLegLabelPositions();
  }

  function updateLegLabelPositions() {
    if (kind !== 'tencent' || !legLayer || !legNodes.length) return;
    const size = containerSize();
    legNodes.forEach(({ node, from, to }) => {
      const a = pointPixel(from);
      const b = pointPixel(to);
      if (!a || !b) {
        node.style.display = 'none';
        return;
      }
      const x = (a.x + b.x) / 2;
      const y = (a.y + b.y) / 2;
      const outside = x < -120 || y < -60 || x > size.width + 120 || y > size.height + 60;
      node.style.display = outside ? 'none' : 'block';
      node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    });
  }

  function renderDomMarkers() {
    const layer = ensureMarkerLayer();
    layer.innerHTML = '';
    markerNodes.clear();
    points.forEach((point, index) => {
      const node = document.createElement('div');
      node.className = 'map-marker';
      node.innerHTML = `<div class="planner-marker" style="--pin:${pointColor(point, index)}"><span>${badge(point, index)}</span></div>
        <div class="planner-marker-label">${point.name || ''}</div>`;
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        suppressClick = true;
        onStopClick?.(point);
        window.setTimeout(() => {
          suppressClick = false;
        }, 150);
      });
      layer.appendChild(node);
      markerNodes.set(point.id ?? `idx-${index}`, node);
    });
    updateMarkerPositions();
  }

  function updateMarkerPositions() {
    if (kind !== 'tencent' || !markerLayer || !points.length) return;
    const size = containerSize();
    points.forEach((point, index) => {
      const node = markerNodes.get(point.id ?? `idx-${index}`);
      if (!node) return;
      const pixel = pointPixel(point);
      if (!pixel) {
        node.style.display = 'none';
        return;
      }
      const outside = pixel.x < -100 || pixel.y < -100 || pixel.x > size.width + 100 || pixel.y > size.height + 100;
      node.style.display = outside ? 'none' : 'flex';
      node.style.transform = `translate(${Math.round(pixel.x)}px, ${Math.round(pixel.y)}px)`;
    });
  }

  function pointColor(point, index) {
    if (point.id && point.id === selectedId) return '#fff3d6';
    return color;
  }

  function badge(point, index) {
    if (point.kind === 'start') return '起';
    if (point.kind === 'end') return '终';
    return String(index);
  }

  async function loadBoundary(adcode) {
    if (!adcode || adcode === boundaryCode) return;
    boundaryCode = adcode;
    try {
      const response = await fetch(`/api/geo/city-boundary?adcode=${encodeURIComponent(adcode)}`);
      if (!response.ok) throw new Error(String(response.status));
      boundary = await response.json();
    } catch (error) {
      boundary = null;
    }
    renderCanvas();
  }

  function renderCanvas() {
    if (!ctx || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(240, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    view.width = width;
    view.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0b1a22');
    gradient.addColorStop(1, '#08131a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 1) 行政边界（与点位共用同一投影，拖拽/缩放时一起移动）
    if (boundary?.rings?.length) {
      ctx.strokeStyle = 'rgba(127, 211, 224, 0.34)';
      ctx.lineWidth = 1.2;
      boundary.rings.forEach((ring) => {
        ctx.beginPath();
        ring.forEach(([lng, lat], index) => {
          const position = toScreen({ lng, lat });
          if (index === 0) ctx.moveTo(position.x, position.y);
          else ctx.lineTo(position.x, position.y);
        });
        ctx.stroke();
      });
    }

    if (!points.length) {
      ctx.fillStyle = 'rgba(232,220,195,0.55)';
      ctx.font = '14px serif';
      ctx.fillText('这条流程还没有点位：先搜索地点或从“附近推荐”加入', 24, 40);
      renderOverlayInfo();
      return;
    }

    // 2) 路线
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      const position = toScreen(point);
      if (index === 0) ctx.moveTo(position.x, position.y);
      else ctx.lineTo(position.x, position.y);
    });
    ctx.stroke();

    // 3) 每段通勤时长与距离
    ctx.font = '11px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    points.slice(0, -1).forEach((point, index) => {
      const leg = point.leg;
      if (!leg) return;
      const a = toScreen(point);
      const b = toScreen(points[index + 1]);
      if (leg.minutes == null) return;
      const text = `${Math.round(leg.minutes || 0)} 分钟 · ${(leg.distance_km || 0).toFixed(1)} km${leg.estimated ? '（估算）' : ''}`;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const textWidth = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(6, 13, 18, 0.75)';
      ctx.fillRect(midX - textWidth / 2, midY - 10, textWidth, 18);
      ctx.fillStyle = 'rgba(240, 232, 214, 0.9)';
      ctx.fillText(text, midX, midY + 3);
    });

    // 3.5) 推演：已走路径 + 旅行者光点
    if (travelledPoints.length >= 2) {
      ctx.strokeStyle = 'rgba(255, 230, 176, 0.95)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      travelledPoints.forEach((point, index) => {
        const position = toScreen(point);
        if (index === 0) ctx.moveTo(position.x, position.y);
        else ctx.lineTo(position.x, position.y);
      });
      ctx.stroke();
    }
    if (travelerPoint) {
      const position = toScreen(travelerPoint);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255, 214, 130, 0.28)';
      ctx.arc(position.x, position.y, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = '#ffe6b0';
      ctx.arc(position.x, position.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(58, 42, 8, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 4) 点位
    points.forEach((point, index) => {
      const position = toScreen(point);
      const isSelected = point.id && point.id === selectedId;
      ctx.beginPath();
      ctx.fillStyle = pointColor(point, index);
      ctx.arc(position.x, position.y, isSelected ? 13 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10202a';
      ctx.font = 'bold 12px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badge(point, index), position.x, position.y);
      ctx.fillStyle = 'rgba(240,232,214,0.9)';
      ctx.font = '12px serif';
      ctx.fillText(point.name || '', position.x, position.y - 20);
    });
    renderOverlayInfo();
  }

  /** 已走路径：GL 加一条更亮的高亮线，canvas 直接重绘。 */
  function renderTravelled() {
    if (kind !== 'tencent' || !map || !tmap) return;
    if (travelledLine) {
      travelledLine.setMap?.(null);
      travelledLine = null;
    }
    if (travelledPoints.length < 2) return;
    const paths = travelledPoints.map((point) => new tmap.LatLng(point.lat, point.lng));
    const geometry = (id, styleId) =>
      tmap.PolylineGeometry ? new tmap.PolylineGeometry({ id, styleId, paths }) : { id, styleId, paths };
    travelledLine = new tmap.MultiPolyline({
      map,
      styles: {
        done: new tmap.PolylineStyle({ color: '#ffe6b0', width: 7, borderWidth: 2, borderColor: '#3a2a08', lineCap: 'round' }),
      },
      geometries: [geometry('done', 'done')],
    });
  }

  function ensureNightCanvas() {
    if (nightCanvas) return nightCanvas;
    nightCanvas = document.createElement('canvas');
    nightCanvas.className = 'map-night-layer';
    nightCtx = nightCanvas.getContext('2d');
    nightSmall = document.createElement('canvas');
    nightSmall.width = 64;
    nightSmall.height = 40;
    container.appendChild(nightCanvas);
    return nightCanvas;
  }

  /** 昼夜层：小网格按太阳高度角着色，再放大平滑，得到真实的晨昏线。 */
  function renderNightLayer(force = false) {
    const now = Date.now();
    if (!force && now - nightAt < 250) return;
    nightAt = now;
    if (!nightEnabled || !nightDate) {
      if (nightCanvas) nightCtx.clearRect(0, 0, nightCanvas.width, nightCanvas.height);
      return;
    }
    const area = bounds();
    if (!area) return;
    const { width, height } = containerSize();
    ensureNightCanvas();
    if (nightCanvas.width !== width || nightCanvas.height !== height) {
      nightCanvas.width = width;
      nightCanvas.height = height;
    }
    const cols = nightSmall.width;
    const rows = nightSmall.height;
    if (!nightImage) nightImage = nightCtx.createImageData(cols, rows);
    for (let row = 0; row < rows; row += 1) {
      const lat = area.maxLat + ((area.minLat - area.maxLat) * (row + 0.5)) / rows;
      for (let col = 0; col < cols; col += 1) {
        const lng = area.minLng + ((area.maxLng - area.minLng) * (col + 0.5)) / cols;
        const altitude = sunAltitudeAt(lng, lat, nightDate);
        const alpha = nightAlphaAt(altitude);
        const twilight = twilightAt(altitude);
        const index = (row * cols + col) * 4;
        nightImage.data[index] = 12 + Math.round(twilight * 120);
        nightImage.data[index + 1] = 16 + Math.round(twilight * 58);
        nightImage.data[index + 2] = 28 + Math.round(twilight * 10);
        nightImage.data[index + 3] = Math.round(alpha * 255);
      }
    }
    nightSmall.getContext('2d').putImageData(nightImage, 0, 0);
    nightCtx.clearRect(0, 0, width, height);
    nightCtx.imageSmoothingEnabled = true;
    nightCtx.drawImage(nightSmall, 0, 0, cols, rows, 0, 0, width, height);
    // 晨昏线：细亮线 + 一层暖色微光
    const line = terminatorPoints(area, nightDate, { rows: 28, steps: 48 });
    if (line.length >= 2) {
      nightCtx.beginPath();
      line.forEach((point, index) => {
        const x = ((point.lng - area.minLng) / (area.maxLng - area.minLng)) * width;
        const y = ((area.maxLat - point.lat) / (area.maxLat - area.minLat)) * height;
        if (index === 0) nightCtx.moveTo(x, y);
        else nightCtx.lineTo(x, y);
      });
      nightCtx.strokeStyle = 'rgba(255, 206, 138, 0.85)';
      nightCtx.lineWidth = 1.6;
      nightCtx.shadowColor = 'rgba(255, 190, 110, 0.65)';
      nightCtx.shadowBlur = 8;
      nightCtx.stroke();
      nightCtx.shadowBlur = 0;
    }
  }

  function renderTraveller() {
    if (kind !== 'tencent') return;
    if (!travelerPoint) {
      travelerNode?.remove();
      travelerNode = null;
      return;
    }
    if (!travelerNode) {
      travelerNode = document.createElement('div');
      travelerNode.className = 'map-traveler';
      travelerNode.innerHTML = '<span class="map-traveler-core"></span><span class="map-traveler-halo"></span>';
      container.appendChild(travelerNode);
    }
    const pixel = pointPixel(travelerPoint);
    if (!pixel) {
      travelerNode.style.display = 'none';
      return;
    }
    travelerNode.style.display = 'block';
    travelerNode.style.transform = `translate(${Math.round(pixel.x)}px, ${Math.round(pixel.y)}px)`;
  }

  function renderTencent() {
    if (!map || !tmap) return;
    clearOverlays();
    if (!points.length) {
      renderOverlayInfo();
      return;
    }
    // 只有 1 个点（新建流程只有出发点）时不能画折线：TMap 会抛 RangeError，
    // 一旦抛出就会打断 setPoints，连地图居中都会失效。
    if (points.length >= 2) {
      const paths = points.map((point) => new tmap.LatLng(point.lat, point.lng));
      const geometry = (id, styleId) =>
        tmap.PolylineGeometry
          ? new tmap.PolylineGeometry({ id, styleId, paths })
          : { id, styleId, paths };
      line = new tmap.MultiPolyline({
        map,
        styles: {
          route: new tmap.PolylineStyle({ color, width: 6, borderWidth: 2, borderColor: '#10202a', lineCap: 'round' }),
          glow: new tmap.PolylineStyle({ color, width: 14, opacity: 0.18, lineCap: 'round' }),
        },
        geometries: [geometry('glow', 'glow'), geometry('route', 'route')],
      });
    }
    renderDomMarkers();
    renderLegLabels();
    renderOverlayInfo();
  }

  function render() {
    // 任何绘制异常都不应该影响相机定位与交互
    try {
      if (kind === 'tencent') {
        renderTencent();
        renderTravelled();
        renderTraveller();
      } else renderCanvas();
    } catch (error) {
      console.warn('[map] 覆盖物绘制失败：', error?.message || error);
    }
  }

  /** 当前视野的经纬度范围（昼夜层采样用）。 */
  function bounds() {
    if (kind === 'tencent' && map?.getBounds) {
      try {
        const raw = map.getBounds();
        const ne = raw.getNorthEast();
        const sw = raw.getSouthWest();
        return { minLng: sw.getLng(), maxLng: ne.getLng(), minLat: sw.getLat(), maxLat: ne.getLat() };
      } catch (error) {
        /* 退回画布范围 */
      }
    }
    const { width, height } = containerSize();
    const topLeft = mercatorUnproject(
      view.center.lng - 0,
      view.center.lat - 0,
      view.zoom,
    );
    const northWest = unprojectScreen(0, 0, { ...view, width, height });
    const southEast = unprojectScreen(width, height, { ...view, width, height });
    void topLeft;
    return { minLng: northWest.lng, maxLng: southEast.lng, minLat: southEast.lat, maxLat: northWest.lat };
  }

  function fit() {
    if (!points.length) return;
    const size = containerSize();
    const rect = container.getBoundingClientRect();
    // 面板刚从 display:none 恢复时尺寸为 0，这时调用 fit 是无效的（会停在上一座城市的视图）
    if (rect.width < 40 || rect.height < 40) return;
    if (kind === 'tencent') {
      const lats = points.map((point) => point.lat);
      const lngs = points.map((point) => point.lng);
      const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
      try {
        map?.resize?.();
        const center = new tmap.LatLng((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2);
        if (span < 1e-3) {
          // 只有「出发点」一个点时，fitBounds 会失败：直接居中到该点
          map.setCenter(center);
          map.setZoom(13);
        } else {
          map.fitBounds(
            new tmap.LatLngBounds(
              new tmap.LatLng(Math.min(...lats), Math.min(...lngs)),
              new tmap.LatLng(Math.max(...lats), Math.max(...lngs)),
            ),
            { padding: 70 },
          );
        }
      } catch (error) {
        /* 单点时 fitBounds 可能报错，忽略 */
      }
      return;
    }
    const { width, height } = containerSize();
    const next = viewForPoints(points, width, height, 60);
    view.center = next.center;
    view.zoom = next.zoom;
    renderCanvas();
  }

  function zoomBy(factor, anchor) {
    if (kind === 'tencent') {
      map?.setZoom?.((map.getZoom?.() ?? 11) + Math.log2(factor));
      return;
    }
    const { width, height } = containerSize();
    view.width = width;
    view.height = height;
    const next = zoomViewAt(view, factor, anchor);
    view.center = next.center;
    view.zoom = next.zoom;
    renderCanvas();
  }

  // ── 地图像素 → 经纬度 / 统一的地图点击派发（单击取点、双击缩放）──
  function containerPointToLngLat(x, y) {
    if (kind === 'tencent' && map?.containerToLngLat) {
      try {
        const point = map.containerToLngLat(new tmap.Point(x, y));
        return { lng: point.getLng(), lat: point.getLat() };
      } catch (error) {
        /* 不支持时退回画布投影 */
      }
    }
    const { width, height } = containerSize();
    return unprojectScreen(x, y, { ...view, width, height });
  }

  let tapTimer = null;
  let lastMapTapAt = 0;
  /** 单击延迟 250ms 派发；250ms 内再来一次视为双击（缩放），不派发取点。 */
  function scheduleMapClick(point, screen) {
    const now = Date.now();
    if (now - lastMapTapAt < 330) {
      lastMapTapAt = 0;
      window.clearTimeout(tapTimer);
      tapTimer = null;
      return;
    }
    lastMapTapAt = now;
    window.clearTimeout(tapTimer);
    tapTimer = window.setTimeout(() => {
      tapTimer = null;
      // 取消/确认取点后可能又收到同一次点击，这里再挡一道
      if (Date.now() < ignoreClicksUntil) return;
      onMapClick?.({ ...point, ...(screen || {}) });
    }, 250);
  }

  // ── 矢量底图交互：拖拽平移、滚轮缩放、双指捏合、双击放大 ──
  let panning = null;
  let lastTap = 0;
  const activePointers = new Map();
  let pinch = null;
  if (canvas) {
    canvas.addEventListener('pointerdown', (event) => {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size === 2) {
        const [a, b] = Array.from(activePointers.values());
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
        panning = null;
        return;
      }
      panning = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && activePointers.size >= 2) {
        const [a, b] = Array.from(activePointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance > 20 && distance > 20) {
          const rect = canvas.getBoundingClientRect();
          zoomBy(distance / pinch.distance, {
            x: (a.x + b.x) / 2 - rect.left,
            y: (a.y + b.y) / 2 - rect.top,
          });
        }
        pinch.distance = distance;
        return;
      }
      if (!panning) return;
      const dx = event.clientX - panning.x;
      const dy = event.clientY - panning.y;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      panning.moved = true;
      panning.x = event.clientX;
      panning.y = event.clientY;
      const next = panView(view, dx, dy);
      view.center = next.center;
      renderCanvas();
    });
    const endPan = (event) => {
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) pinch = null;
      if (!panning) return;
      const moved = panning.moved;
      panning = null;
      if (moved || activePointers.size > 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = points.find((point) => {
        const position = toScreen(point);
        return Math.hypot(position.x - x, position.y - y) <= 22;
      });
      if (hit) {
        onStopClick?.(hit);
        return;
      }
      const now = Date.now();
      if (now - lastTap < 320) {
        zoomBy(1.6, { x, y });
        lastTap = 0;
        window.clearTimeout(tapTimer);
        tapTimer = null;
        lastMapTapAt = 0;
        return;
      }
      lastTap = now;
      scheduleMapClick(containerPointToLngLat(x, y), { x, y });
    };
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', (event) => {
      activePointers.delete(event.pointerId);
      pinch = null;
      panning = null;
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18, { x: event.clientX - rect.left, y: event.clientY - rect.top });
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomBy(1.6, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    });
  }

  overlay.compass.addEventListener('click', () => fit());

  const resize = () => {
    if (canvas) renderCanvas();
    else if (map?.resize) map.resize();
    renderNightLayer(true);
  };
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') {
    const last = { w: 0, h: 0 };
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (Math.round(rect.width) === last.w && Math.round(rect.height) === last.h) return;
      last.w = Math.round(rect.width);
      last.h = Math.round(rect.height);
      resize();
    });
    observer.observe(container);
  }
  resize();

  return {
    kind,
    container,
    map,
    /** 更新当天/当条流程的点位（顺序即显示顺序）。 */
    setPoints({ points: nextPoints, color: nextColor, city } = {}) {
      points = (nextPoints || []).filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat));
      if (nextColor) color = nextColor;
      selectedId = null;
      try {
        render();
      } finally {
        // 即使绘制失败也必须把镜头带到这条流程上
        fit();
      }
      // 布局稳定后再补一次：切换城市时容器刚从隐藏恢复，第一次 fit 可能因尺寸为 0 而无效
      window.requestAnimationFrame(() => {
        if (kind === 'tencent') map?.resize?.();
        fit();
      });
      window.setTimeout(() => fit(), 320);
      if (kind === 'canvas') loadBoundary(city?.adcode);
    },
    setSelected(id) {
      selectedId = id || null;
      render();
    },
    /** 旅行者光点（推演用）；传 null 隐藏。 */
    setTraveler(point) {
      travelerPoint = point && Number.isFinite(point.lng) ? { lng: point.lng, lat: point.lat } : null;
      if (kind === 'tencent') renderTraveller();
      else renderCanvas();
    },
    /** 已走过的路径高亮。 */
    setTravelled(next) {
      travelledPoints = (next || []).filter((point) => Number.isFinite(point?.lng) && Number.isFinite(point?.lat));
      if (kind === 'tencent') renderTravelled();
      else renderCanvas();
    },
    /** 昼夜层：date 为模拟时刻，enabled=false 时清除。 */
    setNightLayer({ date = null, enabled = true } = {}) {
      nightEnabled = Boolean(enabled);
      nightDate = date || null;
      ensureNightCanvas();
      renderNightLayer(true);
    },
    /** 视野经纬度范围（测试与昼夜层用）。 */
    bounds,
    /** 把地图中心移到某个点（跟随模式用）。 */
    centerOn(point) {
      if (!point || !Number.isFinite(point.lng)) return;
      if (kind === 'tencent' && map?.setCenter && window.TMap) {
        map.setCenter(new window.TMap.LatLng(point.lat, point.lng));
        return;
      }
      view.center = { lng: point.lng, lat: point.lat };
      renderCanvas();
    },
    /** 昼夜层是否已绘制（自动化验收用）。 */
    nightInfo() {
      return {
        enabled: nightEnabled,
        date: nightDate ? nightDate.toISOString() : null,
        canvas: Boolean(nightCanvas),
        width: nightCanvas?.width || 0,
        height: nightCanvas?.height || 0,
      };
    },
    /** 屏幕坐标（含 kind），供长按拖拽排序使用。 */
    screenPositions() {
      if (kind === 'canvas') {
        return points.map((point) => ({ id: point.id, name: point.name, kind: point.kind, ...toScreen(point) }));
      }
      return points
        .map((point) => {
          const pixel = pointPixel(point);
          return pixel ? { id: point.id, name: point.name, kind: point.kind, x: pixel.x, y: pixel.y } : null;
        })
        .filter(Boolean);
    },
    refresh: render,
    fit,
    zoomBy,
    /** 暂时忽略地图点击（取消取点弹窗后，避免那一下又立刻弹回来）。 */
    ignoreClicks: (ms = 600) => {
      ignoreClicksUntil = Date.now() + Math.max(0, Number(ms) || 0);
    },
    /** 屏幕坐标 → 经纬度（取点弹窗与自动化验收用）。 */
    lngLatAt: containerPointToLngLat,
    get suppressClick() {
      return suppressClick;
    },
    debugState() {
      return {
        kind,
        zoom: kind === 'tencent' ? map?.getZoom?.() ?? null : view.zoom,
        center: kind === 'tencent' && map?.getCenter ? { lng: map.getCenter().getLng(), lat: map.getCenter().getLat() } : { ...view.center },
        points: points.length,
        route: Boolean(line) || points.length >= 2,
        legLabels: legNodes.length,
        ignoreUntil: ignoreClicksUntil,
        markers: kind === 'tencent' ? markerNodes.size : points.length,
      };
    },
    destroy() {
      window.removeEventListener('resize', resize);
      clearOverlays();
      markerNodes.clear();
      markerLayer?.remove();
      legNodes.length = 0;
      legLayer?.remove();
      overlay.root.remove();
      if (map?.destroy) map.destroy();
    },
  };
}
