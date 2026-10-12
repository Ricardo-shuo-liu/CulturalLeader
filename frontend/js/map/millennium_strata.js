// 3D 地层柱：锁定点升起的一柱「考古剖面」，一层一朝代。
// 层厚按朝代实际年数成比例（秦 15 年薄薄一层、宋 372 年厚厚一层），点击某层直接跳年。

import * as THREE from 'three';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';
import { yearsOfBand } from './millennium_timeline.js';

export const STRATA_MIN = 0.005;
export const STRATA_MAX = 0.055;
export const STRATA_GAP = 0.004;
export const STRATA_RADIUS = 0.052;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 层厚 ∝ 朝代年数（相对最长的一段），夹在 min..max 之间。 */
export function strataThickness(years, maxYears, { min = STRATA_MIN, max = STRATA_MAX } = {}) {
  if (!maxYears || maxYears <= 0) return min;
  return clamp(max * (years / maxYears), min, max);
}

/** 自下而上排布：返回每层的中心高度与厚度（纯函数，Node 可校验）。 */
export function strataLayout(bands, { min = STRATA_MIN, max = STRATA_MAX, gap = STRATA_GAP } = {}) {
  const maxYears = Math.max(1, ...bands.map((band) => yearsOfBand(band)));
  let cursor = 0;
  return bands.map((band) => {
    const years = yearsOfBand(band);
    const thickness = strataThickness(years, maxYears, { min, max });
    const item = { ...band, years, thickness, center: cursor + thickness / 2 };
    cursor += thickness + gap;
    return item;
  });
}

/**
 * @param {object} options
 * @param {Array} options.bands 11 段年代分带
 * @param {number} options.lng / options.lat 锁定点
 */
export function createStrata({ bands, lng, lat }) {
  const layout = strataLayout(bands);
  const group = new THREE.Group();
  const base = worldPosition(lng, lat, RANGES, 0.01);
  group.position.copy(base);
  group.visible = false;

  const layers = layout.map((item, index) => {
    const geometry = new THREE.CylinderGeometry(STRATA_RADIUS, STRATA_RADIUS, item.thickness, 26, 1, false);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(item.color || '#d8b46a'),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = item.center;
    mesh.userData.index = index;
    group.add(mesh);
    return mesh;
  });

  // 当前层的高亮环
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(STRATA_RADIUS * 1.25, STRATA_RADIUS * 1.6, 36),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f2cd84'),
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const state = { active: 0, grow: 0, growing: false, visible: true };

  function setActive(index) {
    const next = clamp(Math.round(index), 0, layers.length - 1);
    state.active = next;
    ring.position.y = layout[next].center + layout[next].thickness * 0.6;
    layers.forEach((mesh, layerIndex) => {
      mesh.material.opacity = layerIndex === next ? 1 : 0.66;
    });
  }

  function setVisible(visible) {
    state.visible = Boolean(visible);
    group.visible = state.visible;
  }

  /** 入场生长：整柱从地面「长出来」。 */
  function grow() {
    state.growing = true;
    state.grow = 0;
    group.visible = state.visible;
  }

  function update(dt, time) {
    if (state.growing) {
      state.grow = Math.min(1, state.grow + dt * 1.1);
      const eased = 1 - (1 - state.grow) ** 3;
      group.scale.set(1, Math.max(0.02, eased), 1);
      if (state.grow >= 1) state.growing = false;
    }
    if (ring.material) {
      ring.material.opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(time * 2.4));
      ring.rotation.z = time * 0.6;
    }
  }

  /** 命中检测：返回被点到的层序号。 */
  function pick(raycaster) {
    const hits = raycaster.intersectObjects(layers, false);
    if (!hits.length) return null;
    return hits[0].object.userData.index ?? null;
  }

  /** 当前层在屏幕上的位置（挂 DOM 标签用）。 */
  function activeScreenPosition(camera, width, height) {
    const item = layout[state.active];
    const point = new THREE.Vector3(base.x, base.y + item.center + item.thickness * 0.6, base.z);
    point.project(camera);
    return {
      x: (point.x * 0.5 + 0.5) * width,
      y: (-point.y * 0.5 + 0.5) * height,
      visible: point.z < 1,
      band: item,
    };
  }

  function dispose() {
    layers.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    ring.geometry.dispose();
    ring.material.dispose();
  }

  setActive(0);

  return {
    group,
    layout,
    setActive,
    setVisible,
    grow,
    update,
    pick,
    activeScreenPosition,
    dispose,
    isVisible: () => state.visible,
    debug: () => ({
      layers: layers.length,
      active: state.active,
      visible: state.visible,
      thickness: Object.fromEntries(layout.map((item) => [item.key, Number(item.thickness.toFixed(4))])),
    }),
  };
}
