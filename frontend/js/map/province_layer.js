// 省级图层：省界（细线）+ 省会标签 + 点击命中，用于「飞到指定省份」与放大后的地图可读性。

import * as THREE from 'three';
import { PROVINCES_CN } from '../data/provinces-cn.js';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';
import { KM_PER_UNIT } from '../geo.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const SHOW_BELOW_KM = 2200; // 视野宽度小于这个值才显示省界（全国视角保持干净）
const LABEL_BELOW_KM = 1400;
const MAX_LABELS = 40;

function ringPoints(ring) {
  const positions = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = worldPosition(ring[i][0], ring[i][1], RANGES, 0.02);
    const b = worldPosition(ring[i + 1][0], ring[i + 1][1], RANGES, 0.02);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  return positions;
}

/** 点在多边形内（经纬度平面，射线法）。 */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 省份的 bbox 宽度（公里），用于计算飞行距离。 */
export function provinceWidthKm(province) {
  const [minLng, minLat, maxLng, maxLat] = province.bbox;
  const midLat = (minLat + maxLat) / 2;
  const widthKm = (maxLng - minLng) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const heightKm = (maxLat - minLat) * 110.57;
  return Math.max(widthKm, heightKm);
}

export function createProvinceLayer({ scene, camera, controls }) {
  const group = new THREE.Group();
  scene.add(group);

  const positions = [];
  PROVINCES_CN.forEach((province) => {
    positions.push(...ringPoints(province.ring));
  });
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: new THREE.Color('#7fd3e0'),
    linewidth: 1.4,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  group.add(lines);

  const labelLayer = document.getElementById('labels');
  const labels = [];
  for (let i = 0; i < MAX_LABELS; i += 1) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'city-label province-label';
    element.style.display = 'none';
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      if (element.__province) flyToProvince(element.__province);
    });
    labelLayer?.appendChild(element);
    labels.push(element);
  }

  const state = { visible: false, opacity: 0, viewKm: Infinity };
  const centerPositions = PROVINCES_CN.map((province) => worldPosition(province.lng, province.lat, RANGES, 0.05));
  const scratch = new THREE.Vector3();

  function flyToProvince(province) {
    if (!camera || !controls) return;
    const widthKm = provinceWidthKm(province) * 1.25;
    const fovRad = (camera.fov * Math.PI) / 180;
    const targetUnits = widthKm / KM_PER_UNIT;
    const distance = Math.max(
      0.6,
      targetUnits / (2 * Math.tan(fovRad / 2) * Math.max(camera.aspect, 0.5)),
    );
    const [minLng, minLat, maxLng, maxLat] = province.bbox;
    const center = worldPosition((minLng + maxLng) / 2, (minLat + maxLat) / 2, RANGES, 0);
    const direction = camera.position.clone().sub(controls.target).normalize();
    const position = center.clone().add(direction.multiplyScalar(distance));
    position.y = Math.max(position.y, center.y + distance * 0.5);
    handlers.onFly?.(position, center);
  }

  const handlers = {};

  return {
    group,
    provinces: PROVINCES_CN,
    get state() {
      return state;
    },
    onFly(handler) {
      handlers.onFly = handler;
    },
    flyToProvince,
    /** 每帧根据视野宽度淡入淡出省界与标签。 */
    update(viewKm, elapsed) {
      state.viewKm = viewKm;
      const target = viewKm < SHOW_BELOW_KM ? 1 : 0;
      state.opacity += (target - state.opacity) * 0.08;
      material.opacity = state.opacity * 0.55;
      state.visible = state.opacity > 0.05;
      lines.visible = state.visible;
      state.showLabels = viewKm < LABEL_BELOW_KM;
    },
    /** 更新省份名标签（只在省级视野显示）。 */
    updateLabels(camera, width, height) {
      if (!state.showLabels) {
        labels.forEach((element) => {
          if (element.style.display !== 'none') element.style.display = 'none';
        });
        return;
      }
      const occupied = new Set();
      let used = 0;
      PROVINCES_CN.forEach((province, index) => {
        if (used >= MAX_LABELS) return;
        scratch.copy(centerPositions[index]).project(camera);
        const x = (scratch.x * 0.5 + 0.5) * width;
        const y = (-scratch.y * 0.5 + 0.5) * height;
        if (x < 0 || y < 0 || x > width || y > height) return;
        const cell = `${Math.round(x / 120)}:${Math.round(y / 34)}`;
        if (occupied.has(cell)) return;
        occupied.add(cell);
        const element = labels[used];
        element.__province = province;
        const name = province.name.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)/g, '');
        if (element.textContent !== name) element.textContent = name;
        element.style.display = '';
        element.style.transform = `translate(${x}px, ${y}px)`;
        used += 1;
      });
      for (let i = used; i < labels.length; i += 1) {
        if (labels[i].style.display !== 'none') labels[i].style.display = 'none';
      }
      state.labelCount = used;
    },
    /** 经纬度 → 所在省份（点击命中用）。 */
    provinceAt(lng, lat) {
      for (const province of PROVINCES_CN) {
        const [minLng, minLat, maxLng, maxLat] = province.bbox;
        if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
        if (pointInRing(lng, lat, province.ring)) return province;
      }
      return null;
    },
    resize(width, height) {
      material.resolution.set(width, height);
    },
  };
}
