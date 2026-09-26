// 真实地图视图：腾讯地图 GL JS API（TMap）；没有 JS Key 时降级为 canvas 示意图（仍可点击与拖拽）。

const SCRIPT_BASE = 'https://map.qq.com/api/gljs?v=1.exp';

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
  // GL 版脚本加载完成后才会挂上 TMap
  for (let i = 0; i < 20 && !window.TMap; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return window.TMap || null;
}

function markerHtml(index, color, label) {
  return `<div class="planner-marker" style="--pin:${color}"><span>${index}</span></div>
    <div class="planner-marker-label">${label}</div>`;
}

/**
 * 创建地图视图（腾讯地图或 canvas 降级），统一接口：
 *   setDay(day) · setSelected(id) · stopScreenPositions() · refresh() · kind · destroy()
 */
export function createMapView({ container, tmap, onStopClick }) {
  const kind = tmap ? 'tencent' : 'canvas';
  let map = null;
  let overlays = [];
  let day = null;
  let selected = null;
  let canvas = null;
  let ctx = null;
  let hitBoxes = [];
  let boundary = null; // 当前城市的行政区边界（离线矢量底图）
  let boundaryCode = null;
  const view = { zoom: 1, offsetX: 0, offsetY: 0 };
  // 腾讯静态图（WebServiceAPI 的 staticmap，只需服务端 Key）作为真实底图
  const staticMap = { img: null, center: null, zoom: 12, loading: false, failed: false, timer: null };

  const TILE = 256;
  const worldSize = (z) => TILE * 2 ** z;
  const mercX = (lng, z) => ((lng + 180) / 360) * worldSize(z);
  const mercY = (lat, z) => {
    const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize(z);
  };

  /** 根据当天点位的范围决定底图中心与缩放级别，然后拉取静态图。 */
  function requestStaticMap() {
    if (kind !== 'canvas' || staticMap.failed || !canvas) return;
    const points = dayPoints();
    if (!points.length) return;
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    const center = { lng: (Math.min(...lngs) + Math.max(...lngs)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
    const spanLng = Math.max(Math.max(...lngs) - Math.min(...lngs), 0.01);
    const spanLat = Math.max(Math.max(...lats) - Math.min(...lats), 0.01);
    const span = Math.max(spanLng, spanLat) * 1.6;
    const zoom = Math.max(4, Math.min(16, Math.round(Math.log2(360 / ((span * TILE) / canvas.width)))));
    if (staticMap.center && staticMap.zoom === zoom && Math.abs(staticMap.center.lng - center.lng) < 1e-4) return;
    staticMap.loading = true;
    const url = `/api/geo/static-map?center=${center.lat},${center.lng}&zoom=${zoom}&width=${canvas.width}&height=${canvas.height}`;
    const image = new Image();
    image.onload = () => {
      staticMap.img = image;
      staticMap.center = center;
      staticMap.zoom = zoom;
      staticMap.loading = false;
      renderCanvas();
    };
    image.onerror = () => {
      staticMap.failed = true;
      staticMap.loading = false;
    };
    image.src = url;
  }

  /** 把当前的缩放/平移折算成新的底图中心与级别，然后重新请求（保证底图与点位始终对齐）。 */
  function commitView() {
    if (kind !== 'canvas') return;
    if (staticMap.center) {
      const effZoom = staticMap.zoom + Math.log2(Math.max(view.zoom, 0.2));
      const degPerPx = 360 / (TILE * 2 ** effZoom);
      staticMap.center = {
        lng: staticMap.center.lng - view.offsetX * degPerPx,
        lat: staticMap.center.lat + view.offsetY * degPerPx,
      };
      staticMap.zoom = Math.max(4, Math.min(16, staticMap.zoom + Math.round(Math.log2(Math.max(view.zoom, 0.2)))));
    }
    view.zoom = 1;
    view.offsetX = 0;
    view.offsetY = 0;
    staticMap.img = null;
    scheduleStaticMap();
  }

  function scheduleStaticMap() {
    window.clearTimeout(staticMap.timer);
    staticMap.timer = window.setTimeout(requestStaticMap, 400);
  }

  if (tmap) {
    map = new tmap.Map(container, {
      center: new tmap.LatLng(34.26, 108.94),
      zoom: 12,
      pitch: 0,
      viewMode: '2D',
      baseMap: { type: 'vector' },
    });
  } else {
    canvas = document.createElement('canvas');
    canvas.className = 'planner-canvas';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');
  }

  const resize = () => {
    if (canvas) {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width));
      canvas.height = Math.max(240, Math.floor(rect.height));
      renderCanvas();
    } else if (map?.resize) {
      map.resize();
    }
  };
  window.addEventListener('resize', resize);
  // 打开工作台时容器从隐藏变可见，尺寸 0 → 真实尺寸，会触发这里重算画布并重取底图
  if (typeof ResizeObserver !== 'undefined') {
    const lastSize = { w: 0, h: 0 };
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (Math.round(rect.width) === lastSize.w && Math.round(rect.height) === lastSize.h) return;
      lastSize.w = Math.round(rect.width);
      lastSize.h = Math.round(rect.height);
      resize();
      scheduleStaticMap();
    });
    observer.observe(container);
  }

  function clearOverlays() {
    overlays.forEach((overlay) => overlay.setMap?.(null));
    overlays = [];
  }

  function dayPoints() {
    if (!day) return [];
    const points = [];
    if (day.start) points.push({ ...day.start, kind: 'start' });
    (day.stops || []).forEach((stop) => points.push({ ...stop, kind: 'stop' }));
    if (day.end) points.push({ ...day.end, kind: 'end' });
    return points.filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
  }

  function renderTencent() {
    if (!map || !day || !tmap) return;
    clearOverlays();
    const points = dayPoints();
    if (!points.length) return;
    const color = day.color || '#f2c879';
    const paths = points.map((point) => new tmap.LatLng(point.lat, point.lng));

    const line = new tmap.MultiPolyline({
      map,
      styles: {
        route: new tmap.PolylineStyle({ color, width: 6, borderWidth: 2, borderColor: '#10202a', lineCap: 'round' }),
        glow: new tmap.PolylineStyle({ color, width: 14, opacity: 0.18, lineCap: 'round' }),
      },
      geometries: [
        { id: 'glow', styleId: 'glow', paths },
        { id: 'route', styleId: 'route', paths },
      ],
    });
    overlays.push(line);

    points.forEach((point, index) => {
      const marker = new tmap.Marker({
        map,
        position: new tmap.LatLng(point.lat, point.lng),
        content: markerHtml(point.kind === 'start' ? '起' : point.kind === 'end' ? '终' : String(index), color, point.name || ''),
        anchor: { x: 13, y: 13 },
        zIndex: 120 + index,
      });
      marker.on('click', () => onStopClick?.(point));
      overlays.push(marker);
    });

    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);
    map.fitBounds(
      new tmap.LatLngBounds(new tmap.LatLng(Math.min(...lats), Math.min(...lngs)), new tmap.LatLng(Math.max(...lats), Math.max(...lngs))),
      { padding: 70 },
    );
  }

  /** 拉取城市行政区边界（后端带磁盘缓存，无 JS Key 也能有清晰底图）。 */
  async function loadBoundary(adcode) {
    if (!adcode || adcode === boundaryCode) return;
    boundaryCode = adcode;
    try {
      const response = await fetch(`/api/geo/city-boundary?adcode=${encodeURIComponent(adcode)}`);
      if (!response.ok) throw new Error(String(response.status));
      boundary = await response.json();
      render();
    } catch (error) {
      boundary = null;
    }
  }

  function renderCanvas() {
    if (!ctx || !canvas || !day) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#08131a';
    ctx.fillRect(0, 0, width, height);

    const points = dayPoints();
    if (!points.length) {
      ctx.fillStyle = 'rgba(232,220,195,0.5)';
      ctx.font = '14px serif';
      ctx.fillText('当天还没有点位：先搜索地点或从“附近推荐”加入', 24, 40);
      hitBoxes = [];
      return;
    }
    const color = day.color || '#f2c879';
    const lngs = points.map((point) => point.lng);
    const lats = points.map((point) => point.lat);
    const minLng = Math.min(...lngs) - 0.01;
    const maxLng = Math.max(...lngs) + 0.01;
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;
    const pad = 60;
    const useStatic = Boolean(staticMap.img && staticMap.center);
    const effZoom = staticMap.zoom + Math.log2(Math.max(view.zoom, 0.2));
    const baseX = useStatic
      ? (lng) => mercX(lng, effZoom) - mercX(staticMap.center.lng, effZoom) + width / 2
      : (lng) => pad + ((lng - minLng) / (maxLng - minLng)) * (width - pad * 2);
    const baseY = useStatic
      ? (lat) => mercY(lat, effZoom) - mercY(staticMap.center.lat, effZoom) + height / 2
      : (lat) => height - pad - ((lat - minLat) / (maxLat - minLat)) * (height - pad * 2);
    const cx = width / 2;
    const cy = height / 2;
    // 应用缩放与平移（以画布中心为缩放基准）
    const toXY = (point) => ({
      x: cx + (baseX(point.lng) - cx) * view.zoom + view.offsetX,
      y: cy + (baseY(point.lat) - cy) * view.zoom + view.offsetY,
    });

    // 0) 腾讯静态图底图（真实道路与地名）
    if (useStatic) {
      const ratio = effZoom - staticMap.zoom;
      const scaled = staticMap.img;
      const drawW = scaled.width * 2 ** ratio;
      const drawH = scaled.height * 2 ** ratio;
      ctx.drawImage(
        scaled,
        width / 2 - drawW / 2 + view.offsetX,
        height / 2 - drawH / 2 + view.offsetY,
        drawW,
        drawH,
      );
    }

    // 1) 行政区边界（区县轮廓）：有静态图时适当减淡
    if (boundary?.rings?.length) {
      ctx.strokeStyle = useStatic ? 'rgba(127, 211, 224, 0.18)' : 'rgba(127, 211, 224, 0.35)';
      ctx.lineWidth = 1.2;
      boundary.rings.forEach((ring) => {
        ctx.beginPath();
        ring.forEach(([lng, lat], index) => {
          const point = toXY({ lng, lat });
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      });
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      const { x, y } = toXY(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    hitBoxes = [];
    points.forEach((point, index) => {
      const { x, y } = toXY(point);
      const isSelected = selected && selected.id === point.id;
      ctx.beginPath();
      ctx.fillStyle = isSelected ? '#fff3d6' : color;
      ctx.arc(x, y, isSelected ? 13 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10202a';
      ctx.font = 'bold 12px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(point.kind === 'start' ? '起' : point.kind === 'end' ? '终' : String(index), x, y);
      ctx.fillStyle = 'rgba(240,232,214,0.9)';
      ctx.font = '12px serif';
      ctx.fillText(point.name || '', x, y - 20);
      hitBoxes.push({ point, x, y, r: 16 });
    });

    // 2) 每段通勤时长与距离标注（地图上直接可读）
    const plan = day.plan;
    if (plan?.legs?.length) {
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      points.slice(0, -1).forEach((point, index) => {
        const leg = plan.legs[index];
        if (!leg) return;
        const a = toXY(point);
        const b = toXY(points[index + 1]);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const text = `${Math.round(leg.minutes || 0)} 分钟 · ${(leg.distance_km || 0).toFixed(1)} km${leg.estimated ? '（估算）' : ''}`;
        ctx.fillStyle = 'rgba(6, 13, 18, 0.75)';
        const textWidth = ctx.measureText(text).width + 12;
        ctx.fillRect(midX - textWidth / 2, midY - 10, textWidth, 18);
        ctx.fillStyle = 'rgba(240, 232, 214, 0.9)';
        ctx.fillText(text, midX, midY + 3);
      });
    }

    // 3) 比例尺（按当前缩放估算）
    const midLat = (minLat + maxLat) / 2;
    const kmPerPixel = (((maxLng - minLng) * 111.32 * Math.cos((midLat * Math.PI) / 180)) / (width - pad * 2)) / view.zoom;
    const scaleKm = kmPerPixel * 90 > 20 ? Math.round(kmPerPixel * 90) : Math.round(kmPerPixel * 90 * 10) / 10;
    ctx.strokeStyle = 'rgba(240, 232, 214, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(20, height - 18);
    ctx.lineTo(110, height - 18);
    ctx.moveTo(20, height - 22);
    ctx.lineTo(20, height - 14);
    ctx.moveTo(110, height - 22);
    ctx.lineTo(110, height - 14);
    ctx.stroke();
    ctx.fillStyle = 'rgba(240, 232, 214, 0.75)';
    ctx.textAlign = 'left';
    ctx.fillText(`约 ${scaleKm} 公里`, 20, height - 26);
  }

  function render() {
    if (kind === 'tencent') renderTencent();
    else renderCanvas();
  }

  if (canvas) {
    let pressTimer = null;
    let pressed = null;
    const localPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      };
    };
    canvas.addEventListener('pointerdown', (event) => {
      const point = localPoint(event);
      const hit = hitBoxes.find((box) => Math.hypot(box.x - point.x, box.y - point.y) <= box.r);
      if (!hit) return;
      pressed = hit;
      pressTimer = window.setTimeout(() => onStopClick?.(hit.point, point), 400);
    });
    canvas.addEventListener('pointerup', (event) => {
      window.clearTimeout(pressTimer);
      if (pressed) {
        const point = localPoint(event);
        if (Math.hypot(point.x - pressed.x, point.y - pressed.y) <= 6) onStopClick?.(pressed.point);
      }
      pressed = null;
    });
    canvas.addEventListener('pointerleave', () => {
      window.clearTimeout(pressTimer);
      pressed = null;
    });

    // 滚轮缩放（围绕鼠标位置）
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
        const cx = canvas.width / 2;
        const cy = canvas.height / 2;
        const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.min(6, Math.max(0.6, view.zoom * factor));
        const applied = next / view.zoom;
        view.offsetX = x - (x - cx) * applied - cx + view.offsetX * applied;
        view.offsetY = y - (y - cy) * applied - cy + view.offsetY * applied;
        view.zoom = next;
        renderCanvas();
        commitView();
      },
      { passive: false },
    );

    // 拖拽平移
    let panning = null;
    canvas.addEventListener('pointerdown', (event) => {
      const hit = hitBoxes.find((box) => {
        const rect = canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
        return Math.hypot(box.x - x, box.y - y) <= box.r;
      });
      if (hit) return; // 点中点位交给上面的长按/点击逻辑
      panning = { x: event.clientX, y: event.clientY, offsetX: view.offsetX, offsetY: view.offsetY };
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!panning) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      view.offsetX = panning.offsetX + (event.clientX - panning.x) * scaleX;
      view.offsetY = panning.offsetY + (event.clientY - panning.y) * scaleY;
      renderCanvas();
    });
    canvas.addEventListener('pointerup', () => {
      if (panning) {
        panning = null;
        commitView();
      }
    });
    canvas.addEventListener('pointercancel', () => {
      panning = null;
    });
  }

  resize();

  return {
    kind,
    container,
    map,
    setDay(nextDay) {
      day = nextDay;
      selected = null;
      if (kind === 'canvas') {
        view.zoom = 1;
        view.offsetX = 0;
        view.offsetY = 0;
        loadBoundary(day?.city?.adcode);
        staticMap.center = null;
        staticMap.img = null;
        staticMap.failed = false;
        resize();
        scheduleStaticMap();
      }
      render();
    },
    setSelected(id) {
      selected = { id };
      render();
    },
    refresh: render,
    stopScreenPositions() {
      const points = dayPoints();
      if (kind === 'canvas') {
        return points.map((point) => {
          const box = hitBoxes.find((item) => item.point.id === point.id || item.point.name === point.name);
          return { id: point.id, name: point.name, x: box ? box.x : 0, y: box ? box.y : 0, kind: point.kind };
        });
      }
      if (!map?.projectToContainer || !window.TMap) return [];
      return points.map((point) => {
        const pixel = map.projectToContainer(new window.TMap.LatLng(point.lat, point.lng));
        const rect = container.getBoundingClientRect();
        return {
          id: point.id,
          name: point.name,
          x: (pixel?.x ?? 0) - rect.left,
          y: (pixel?.y ?? 0) - rect.top,
          kind: point.kind,
        };
      });
    },
    destroy() {
      window.removeEventListener('resize', resize);
      clearOverlays();
      if (map?.destroy) map.destroy();
    },
  };
}
