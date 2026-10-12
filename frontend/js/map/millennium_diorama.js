// 城郭剪影：锁定点上的低模「这座城市」，随朝代长高、加塔、换城、起高楼。
// 它立在地层柱顶上——城，建在两千年的地层上；银幕里放的也是同一份形态参数。

import * as THREE from 'three';
import { ERA_ARCHETYPES, sceneParams } from './millennium_style.js';

export const DIORAMA_WIDTH = 0.2; // 城郭横向尺度（世界单位）

const SCALE = DIORAMA_WIDTH;

/** 城郭的形态参数（银幕与 3D 共用同一份 sceneParams）。 */
export function dioramaSpec(cityName, eraIndex) {
  const params = sceneParams(cityName, eraIndex);
  return {
    wallHeight: params.walls * 0.22 * SCALE,
    gate: params.gate * 0.2 * SCALE,
    palace: params.palace * 0.24 * SCALE,
    pagodaLevels: params.pagoda > 0 ? Math.round(3 + params.pagoda) : 0,
    houses: Math.round(params.houses * 6),
    towers: params.towers > 0 ? 6 : 0,
    axis: Boolean(params.axis),
    epoch: eraIndex,
  };
}

function box(width, height, depth, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }),
  );
}

/**
 * @param {object} options
 * @param {THREE.Vector3} options.point 锁定点
 * @param {string} options.cityName
 */
export function createDiorama({ scene, point, cityName }) {
  const group = new THREE.Group();
  group.position.copy(point);
  group.visible = false;
  scene.add(group);

  let content = null;
  let baseHeight = 0.03;
  const state = { eraIndex: 5, visible: true, grow: 0, growing: false };

  const COLORS = {
    earth: '#8d7a5e',
    roof: '#a05a3c',
    dark: '#4c443a',
    towerGlass: '#cfd8e2',
  };

  function build(eraIndex) {
    if (content) {
      group.remove(content);
      content.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    }
    const spec = dioramaSpec(cityName, eraIndex);
    content = new THREE.Group();
    const span = SCALE;
    const half = span / 2;
    // 城墙：四面薄墙
    if (spec.wallHeight > 0.001) {
      const wall = box(span, spec.wallHeight, 0.006, COLORS.earth);
      wall.position.set(0, spec.wallHeight / 2, -half);
      content.add(wall);
      const wallB = wall.clone();
      wallB.position.z = half;
      content.add(wallB);
      const wallL = box(0.006, spec.wallHeight, span, COLORS.earth);
      wallL.position.set(-half, spec.wallHeight / 2, 0);
      content.add(wallL);
      const wallR = wallL.clone();
      wallR.position.x = half;
      content.add(wallR);
    }
    // 城门楼
    if (spec.gate > 0.001) {
      const gate = box(0.03 * SCALE + 0.012, spec.gate, 0.02, COLORS.dark);
      gate.position.set(0, spec.gate / 2, half);
      content.add(gate);
      const roof = box(0.05 * SCALE + 0.016, 0.008, 0.028, COLORS.roof);
      roof.position.set(0, spec.gate + 0.004, half);
      content.add(roof);
    }
    // 宫室
    if (spec.palace > 0.001) {
      const palace = box(span * 0.42, spec.palace, span * 0.24, COLORS.roof);
      palace.position.set(0, spec.palace / 2, -half * 0.35);
      content.add(palace);
      const ridge = box(span * 0.48, 0.007, span * 0.3, '#d9a05a');
      ridge.position.set(0, spec.palace + 0.003, -half * 0.35);
      content.add(ridge);
    }
    // 塔：一层层收小的方盒
    if (spec.pagodaLevels > 0) {
      let levelH = 0.03 * SCALE + 0.02;
      let width = span * 0.24;
      let y = 0;
      for (let index = 0; index < spec.pagodaLevels; index += 1) {
        const layer = box(width, levelH, width, '#c08a4a');
        layer.position.set(half * 0.55, y + levelH / 2, half * 0.3);
        content.add(layer);
        const eave = box(width * 1.25, 0.005, width * 1.25, '#8a5f30');
        eave.position.set(half * 0.55, y + levelH, half * 0.3);
        content.add(eave);
        y += levelH + 0.004;
        levelH = Math.max(0.012, levelH - 0.006);
        width = Math.max(span * 0.08, width - span * 0.04);
      }
    }
    // 民居
    for (let index = 0; index < spec.houses; index += 1) {
      const hx = -half * 0.6 + (((index * 37) % 100) / 100) * span * 1.1;
      const hz = -half * 0.2 + (((index * 53) % 100) / 100) * span * 0.8;
      const size = span * 0.07;
      const house = box(size, size * 0.8, size, COLORS.roof);
      house.position.set(hx, size * 0.4, hz);
      content.add(house);
    }
    // 现代高楼
    for (let index = 0; index < spec.towers; index += 1) {
      const height = 0.09 * SCALE + ((index * 7) % 5) * 0.012 * SCALE + 0.02;
      const tower = box(span * 0.07, height, span * 0.07, COLORS.towerGlass);
      tower.position.set(-half + (index + 0.5) * (span / 6), height / 2, -half * 0.2 + ((index * 29) % 40) / 100);
      content.add(tower);
    }
    group.add(content);
    state.grow = 0;
    state.growing = true;
  }

  function setEra(eraIndex) {
    if (eraIndex === state.eraIndex && content) return;
    state.eraIndex = eraIndex;
    build(eraIndex);
  }

  /** 底座高度：地层柱可见时，城就立在柱顶。 */
  function setBase(height) {
    baseHeight = height;
    group.position.set(point.x, point.y + baseHeight, point.z);
  }

  function setVisible(visible) {
    state.visible = Boolean(visible);
    group.visible = state.visible;
  }

  function update(dt) {
    if (state.growing) {
      state.grow = Math.min(1, state.grow + dt * 2.2);
      const eased = 1 - (1 - state.grow) ** 3;
      group.scale.set(1, Math.max(0.05, eased), 1);
      if (state.grow >= 1) state.growing = false;
    }
  }

  function dispose() {
    scene.remove(group);
    if (content) {
      content.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    }
  }

  build(5);
  setBase(baseHeight);

  return {
    group,
    setEra,
    setBase,
    setVisible,
    update,
    dispose,
    isVisible: () => state.visible,
    debug: () => ({
      visible: state.visible,
      eraIndex: state.eraIndex,
      base: Number(baseHeight.toFixed(3)),
      spec: dioramaSpec(cityName, state.eraIndex),
    }),
  };
}

export { ERA_ARCHETYPES };
