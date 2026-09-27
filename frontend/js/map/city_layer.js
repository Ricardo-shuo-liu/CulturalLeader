// 沙盘上的全国城市标注：369 个地级市/直辖市/省会/计划单列市。
// - 按相机距离分级显示（远：重点城市；中：全部地级市；近：全部 + 标签）
// - 屏幕投影与标签 DOM 都做节流与复用，避免放大后每帧重算造成卡顿

import * as THREE from 'three';
import { CITIES_CN } from '../data/cities-cn.js';
import { visibleCitiesForView } from './trip_utils.js';
import { unprojectScene } from '../geo.js';
import { project } from '../geo.js';
import { STAGE } from '../config.js';

const TIER_STYLE = {
  municipality: { color: '#ffd77a', size: 1.6 },
  sar: { color: '#ffd77a', size: 1.5 },
  subprovincial: { color: '#f2c879', size: 1.35 },
  capital: { color: '#e8dcc3', size: 1.25 },
  prefecture: { color: '#8fdcE8', size: 1.0 },
};

const MAX_LABELS = 240;
// 各档位允许的标签数量与防重叠网格（像素）
const LABEL_TIERS = {
  far: { limit: 40, cellX: 92, cellY: 28 },
  mid: { limit: 140, cellX: 74, cellY: 24 },
  near: { limit: 240, cellX: 56, cellY: 22 },
};
// 标签宽度估算：小字号中文 ≈13px/字，再加左右内边距
const labelWidthOf = (city) => {
  const text = String(city?.name || '').replace(/市$/, '');
  return Math.max(38, text.length * 13 + 20);
};
const PROJECT_INTERVAL_MS = 100; // 屏幕投影节流
const LABEL_INTERVAL_MS = 120; // 标签 DOM 更新节流

export function createCityLayer({ scene, terrainHeight, exclude = new Set() }) {
  // 排除已有讲解的重点城市（数据里是“北京市”这类全名，这里做归一化匹配）
  const excluded = new Set([...exclude].map((name) => String(name).replace(/市$/, '')));
  const cities = CITIES_CN.filter((city) => !excluded.has(String(city.name).replace(/市$/, '')));

  const group = new THREE.Group();
  scene.add(group);

  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);

  const count = cities.length;
  const offsets = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const alphas = new Float32Array(count);
  const phases = new Float32Array(count);
  const indices = new Float32Array(count);
  const worldPositions = new Float32Array(count * 3);

  cities.forEach((city, index) => {
    const point = project(city.lng, city.lat);
    const height = (terrainHeight ? terrainHeight(city.lng, city.lat) : 0) * STAGE.relief;
    const style = TIER_STYLE[city.tier] || TIER_STYLE.prefecture;
    worldPositions.set([point.x, height + 0.06, -point.y], index * 3);
    offsets.set([point.x, height + 0.06, -point.y], index * 3);
    const color = new THREE.Color(style.color);
    colors.set([color.r, color.g, color.b], index * 3);
    scales[index] = STAGE.cityCoreSize * style.size;
    alphas[index] = 1;
    phases[index] = (index * 1.7) % (Math.PI * 2);
    indices[index] = index;
  });

  geometry.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('iScale', new THREE.InstancedBufferAttribute(scales, 1));
  geometry.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(alphas, 1));
  geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('iIndex', new THREE.InstancedBufferAttribute(indices, 1));
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uHighlight: { value: -1 },
      uOpacity: { value: 1 },
      uScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 iOffset;
      attribute vec3 iColor;
      attribute float iScale;
      attribute float iAlpha;
      attribute float iPhase;
      attribute float iIndex;
      uniform float uTime;
      uniform float uHighlight;
      uniform float uScale;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vUv = uv;
        vColor = iColor;
        float hover = abs(uHighlight - iIndex) < 0.5 ? 1.0 : 0.0;
        float pulse = 0.5 + 0.5 * sin(uTime * 1.1 + iPhase);
        vAlpha = iAlpha * (0.85 + 0.15 * pulse);
        float scale = iScale * uScale * (1.0 + 0.2 * pulse + 0.7 * hover);
        vec4 center = modelViewMatrix * vec4(iOffset, 1.0);
        center.xy += position.xy * scale;
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float core = smoothstep(0.6, 0.0, d);
        float halo = smoothstep(1.0, 0.2, d) * 0.5;
        gl_FragColor = vec4(vColor, (core + halo) * vAlpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  group.add(mesh);

  const handlers = {};

  // 标签池（HTML），按档位限量显示并做网格防重叠
  const labelLayer = document.getElementById('labels');
  const labels = [];
  for (let i = 0; i < MAX_LABELS; i += 1) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'city-label city-label-minor';
    element.style.display = 'none';
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      if (element.__city) handlers.onSelect?.(element.__city);
    });
    labelLayer?.appendChild(element);
    labels.push(element);
  }

  const state = {
    level: 'national',
    viewKm: 0,
    visibleCount: count,
    labelCount: 0,
    highlight: -1,
    opacity: 1,
    scale: 1,
    visible: [],
    showLabels: false,
  };

  // 复用的中间对象，避免每帧分配
  const projected = new Array(count);
  for (let i = 0; i < count; i += 1) {
    projected[i] = { index: i, x: 0, y: 0, visible: false };
  }
  const scratch = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const mapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // 只用屏幕中线附近的两点估算视野宽度：四角在倾斜视角下会命中地平线附近导致范围无穷大
  const edgeNdc = [new THREE.Vector2(-0.55, 0), new THREE.Vector2(0.55, 0)];
  const hit = new THREE.Vector3();
  let viewBounds = null;

  /** 用四个屏幕角射线打到地图平面，换算出当前视野的经纬度范围与宽度（公里）。 */
  function computeView(camera) {
    const points = [];
    for (const ndc of edgeNdc) {
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(mapPlane, hit)) continue;
      points.push(unprojectScene(hit.x, -hit.z));
    }
    if (points.length < 2) return null;
    const [left, right] = points;
    const minLng = Math.min(left.lng, right.lng);
    const maxLng = Math.max(left.lng, right.lng);
    const midLat = (left.lat + right.lat) / 2;
    // 视野宽度（公里）：中线两点跨度按 0.55 的取样比例放大回整屏
    const widthKm = ((maxLng - minLng) * 111.32 * Math.cos((midLat * Math.PI) / 180)) / 1.1;
    const spanLat = Math.max(widthKm / 110.57, 0.4);
    const minLat = midLat - spanLat / 2;
    const maxLat = midLat + spanLat / 2;
    return { minLng, maxLng, minLat, maxLat, widthKm: Math.max(widthKm, 5), heightKm: spanLat * 110.57 };
  }
  const orderScratch = new Array(count);
  let lastProjectAt = 0;
  let lastLabelAt = 0;
  let lastLabelSignature = '';
  let cameraSignature = '';
  const labelAllowed = new Uint8Array(count);

  function applyVisibility() {
    const visibleNames = new Set(state.visible.map((city) => city.name));
    for (let i = 0; i < count; i += 1) {
      alphas[i] = visibleNames.has(cities[i].name) ? 1 : 0;
    }
    geometry.getAttribute('iAlpha').needsUpdate = true;
    state.visibleCount = state.visible.length;
  }

  function projectAll(camera, width, height) {
    for (let i = 0; i < count; i += 1) {
      const target = projected[i];
      scratch.set(worldPositions[i * 3], worldPositions[i * 3 + 1], worldPositions[i * 3 + 2]);
      scratch.project(camera);
      target.x = (scratch.x * 0.5 + 0.5) * width;
      target.y = (-scratch.y * 0.5 + 0.5) * height;
      target.visible = scratch.z < 1 && alphas[i] > 0.5;
    }
  }

  return {
    group,
    mesh,
    material,
    cities,
    get state() {
      return state;
    },
    onSelect(handler) {
      handlers.onSelect = handler;
    },
    update(camera, time, width, height) {
      material.uniforms.uTime.value = time;
      material.uniforms.uHighlight.value = state.highlight;
      material.uniforms.uOpacity.value = state.opacity;
      material.uniforms.uScale.value = state.scale;

      // 相机没动就不重复计算可见性与投影
      const pos = camera.position;
      const signature = `${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)},${(camera.zoom || 1).toFixed(3)}`;
      if (signature !== cameraSignature) {
        cameraSignature = signature;
        const view = computeView(camera);
        if (view) {
          const { cities: visible, labelCities, level } = visibleCitiesForView(cities, view);
          state.visible = visible;
          state.labelCities = labelCities;
          const labelNames = new Set(labelCities.map((city) => city.name));
          for (let i = 0; i < count; i += 1) labelAllowed[i] = labelNames.has(cities[i].name) ? 1 : 0;
          state.showLabels = true;
          state.level = level;
          state.viewKm = Math.round(view.widthKm);
          viewBounds = view;
          applyVisibility();
        }
      }
      return { width, height };
    },
    setOpacity(value) {
      state.opacity = value;
    },
    setScale(value) {
      state.scale = value;
    },
    setHighlight(index) {
      state.highlight = index;
    },
    /** 屏幕坐标（节流 + 复用对象）。 */
    screenPositions(camera, width, height) {
      const now = performance.now();
      if (now - lastProjectAt >= PROJECT_INTERVAL_MS) {
        lastProjectAt = now;
        projectAll(camera, width, height);
      }
      return projected;
    },
    /** 更新 HTML 标签（节流 + 只在变化时写 DOM）；mask 是重点城市标签已占用的格子。 */
    updateLabels(screenPositions, width, height, mask = null, hideAll = false) {
      const now = performance.now();
      if (now - lastLabelAt < LABEL_INTERVAL_MS) return;
      lastLabelAt = now;
      if (!state.showLabels || hideAll) {
        if (state.labelCount !== 0) {
          labels.forEach((element) => {
            element.style.display = 'none';
          });
          state.labelCount = 0;
          lastLabelSignature = 'none';
        }
        return;
      }
      const tier = LABEL_TIERS[state.level] || LABEL_TIERS.mid;
      let used = 0;
      const occupied = new Set();
      const chosenY = new Float32Array(count);
      for (let i = 0; i < count && orderScratch.length; i += 1) orderScratch[i] = i;
      orderScratch.length = count;
      orderScratch.sort((a, b) => scales[b] - scales[a]);
      for (let i = 0; i < orderScratch.length; i += 1) {
        if (used >= tier.limit) break;
        const index = orderScratch[i];
        const position = screenPositions[index];
        if (!position || !position.visible || !labelAllowed[index]) continue;
        // 标签同样是以锚点为中心、向上延伸的小牌子；和重点城市一样给几个候选位置
        const labelWidth = labelWidthOf(cities[index]);
        const cellsAt = (cx, cy) => {
          const list = [];
          for (let col = Math.floor((cx - labelWidth / 2) / 34); col <= Math.floor((cx + labelWidth / 2) / 34); col += 1) {
            for (let row = Math.floor((cy - 24) / 20); row <= Math.floor((cy + 5) / 20); row += 1) {
              list.push(`${col}:${row}`);
            }
          }
          return list;
        };
        // 只保留「正上方」一个位置：不做多方位挪动，避免视觉上像在找位置
        const cells = cellsAt(position.x, position.y);
        if (cells.some((cell) => occupied.has(cell) || (mask && mask.has(cell)))) continue;
        const chosenYValue = position.y;
        cells.forEach((key) => occupied.add(key));
        chosenY[index] = chosenYValue;
        orderScratch[used] = index; // 复用数组前半段记录入选顺序
        used += 1;
      }
      const signature = `${state.level}|${used}|${orderScratch
        .slice(0, used)
        .map((index) => `${index}:${Math.round(screenPositions[index].x)}:${Math.round(screenPositions[index].y)}`)
        .join('|')}`;
      if (signature === lastLabelSignature) return;
      lastLabelSignature = signature;
      for (let i = 0; i < used; i += 1) {
        const index = orderScratch[i];
        const element = labels[i];
        const position = screenPositions[index];
        element.__city = cities[index];
        const name = cities[index].name.replace(/市$/, '');
        if (element.textContent !== name) element.textContent = name;
        element.style.display = '';
        // 取整避免亚像素抖动；锚点在标签底部中心，视觉上贴着城市光点
        element.style.transform = `translate3d(${Math.round(position.x)}px, ${Math.round(chosenY[index])}px, 0) translate(-50%, -100%) translateY(3px)`;
      }
      for (let i = used; i < labels.length; i += 1) {
        if (labels[i].style.display !== 'none') labels[i].style.display = 'none';
      }
      state.labelCount = used;
    },
    search(keyword) {
      const text = String(keyword || '').trim();
      if (!text) return null;
      return cities.find((city) => city.name.includes(text) || city.name.replace(/市$/, '') === text) || null;
    },
    locate(city) {
      const index = cities.findIndex((item) => item.name === city.name);
      if (index < 0) return null;
      return { x: worldPositions[index * 3], y: worldPositions[index * 3 + 1], z: worldPositions[index * 3 + 2] };
    },
  };
}
