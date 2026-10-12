// 真实地标随史建造：把现有 38 座地标模型按高度分层，在史实建造窗口里逐层立起来。
// 与环幕共享同一份进度：环幕中层同步出现脚手架与半成的剪影。

import * as THREE from 'three';
import { landmarkFactory } from '../landmarks.js';

export const BUILD_LAYERS = 14;
export const RUINS_RATIO = 0.25;

/** 纯函数：按高度把构件分到 14 层（从下往上）。 */
export function assignLayers(heights, layers = BUILD_LAYERS) {
  if (!heights.length) return [];
  const sorted = heights.map((height, index) => ({ height, index })).sort((a, b) => a.height - b.height);
  const out = new Array(heights.length).fill(0);
  sorted.forEach((item, order) => {
    out[item.index] = Math.min(layers - 1, Math.floor((order / sorted.length) * layers));
  });
  return out;
}

/**
 * 纯函数：年份 → 建造状态机。
 * @param {Array} phases [{year, span, action, label}]
 * @param {number} year
 * @returns {{state:string, phaseIndex:number, progress:number, revealed:number, label:string, action:string}}
 *   state ∈ absent | always | building | burning | ruins | complete
 */
export function constructionState(phases, year, { always = false, layers = BUILD_LAYERS } = {}) {
  if (always) return { state: 'always', phaseIndex: -1, progress: 1, revealed: layers, label: '始终在场', action: 'always' };
  const list = phases || [];
  if (!list.length) return { state: 'absent', phaseIndex: -1, progress: 0, revealed: 0, label: '', action: '' };
  if (year < list[0].year) {
    return { state: 'absent', phaseIndex: -1, progress: 0, revealed: 0, label: '', action: '' };
  }
  for (let index = 0; index < list.length; index += 1) {
    const phase = list[index];
    const end = phase.year + phase.span;
    if (year < phase.year) break;
    if (year < end) {
      const progress = Math.min(1, Math.max(0, (year - phase.year) / phase.span));
      const burning = phase.action === 'burn';
      return {
        state: burning ? 'burning' : 'building',
        phaseIndex: index,
        progress,
        revealed: burning
          ? Math.floor((1 - progress) * layers)
          : Math.max(1, Math.ceil(progress * layers)),
        label: phase.label,
        action: phase.action,
      };
    }
  }
  const last = list[list.length - 1];
  const ended = list.filter((phase) => year >= phase.year + phase.span);
  if (ended.length === list.length) {
    // 所有阶段都已结束：焚毁类停在残迹，其余算建成
    if (last.action === 'burn') {
      return {
        state: 'ruins',
        phaseIndex: list.length - 1,
        progress: 1,
        revealed: Math.floor(RUINS_RATIO * layers),
        label: last.label,
        action: 'ruins',
      };
    }
    return { state: 'complete', phaseIndex: list.length - 1, progress: 1, revealed: layers, label: last.label, action: last.action };
  }
  // 两次建造之间的空档：留残迹（等下一段重建）
  if (ended.length) {
    const endedPhase = ended[ended.length - 1];
    const keep = (endedPhase.gap || 'ruins') === 'keep';
    if (keep) {
      // 迁建 / 扩建 / 天际线：楼没塌，维持原样
      return {
        state: 'complete',
        phaseIndex: list.indexOf(endedPhase),
        progress: 1,
        revealed: layers,
        label: endedPhase.label,
        action: endedPhase.action,
      };
    }
    return {
      state: 'ruins',
      phaseIndex: list.indexOf(endedPhase),
      progress: 1,
      revealed: Math.floor(RUINS_RATIO * layers),
      label: `${endedPhase.label}（已毁，待重建）`,
      action: 'ruins',
    };
  }
  return { state: 'absent', phaseIndex: -1, progress: 0, revealed: 0, label: '', action: '' };
}

function dustTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(226, 210, 176, 0.9)');
  gradient.addColorStop(0.5, 'rgba(206, 186, 150, 0.3)');
  gradient.addColorStop(1, 'rgba(206, 186, 150, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {THREE.Vector3} options.point 锚点（地标立在旁边 0.3 处）
 * @param {string} options.landmarkKey
 * @param {object} options.timeline {kind, always, phases}
 * @param {Function} options.onBuildStep 层落位 / 焚毁时的音效回调
 */
export function createLandmarkBuild({ scene, point, landmarkKey, timeline, onBuildStep = () => {} }) {
  const model = landmarkFactory(landmarkKey);
  model.scale.setScalar(0.85);
  const offset = new THREE.Vector3(0.3, 0, -0.22); // 让开地层柱，斜立在锚点旁
  model.position.copy(point).add(offset);
  scene.add(model);
  model.updateMatrixWorld(true);

  // 收集构件并按高度分层
  const meshes = [];
  model.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox.clone();
    box.applyMatrix4(object.matrixWorld);
    meshes.push({ mesh: object, height: box.min.y + box.getSize(new THREE.Vector3()).y / 2, baseScale: object.scale.clone() });
  });
  const layers = assignLayers(meshes.map((item) => item.height));
  meshes.forEach((item, index) => {
    item.layer = layers[index];
    item.pop = 0;
    item.revealed = false;
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());

  // 脚手架：四角立杆 + 每 1/4 高一道横杆
  const scaffold = new THREE.Group();
  const poleMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#4a3f33'), transparent: true, opacity: 0.85 });
  const poleHeight = Math.max(0.2, size.y * 1.12);
  [
    [-size.x / 2, -size.z / 2],
    [size.x / 2, -size.z / 2],
    [-size.x / 2, size.z / 2],
    [size.x / 2, size.z / 2],
  ].forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, poleHeight, 6), poleMaterial);
    pole.position.set(x, poleHeight / 2, z);
    scaffold.add(pole);
  });
  for (let level = 1; level <= 3; level += 1) {
    const y = (poleHeight / 4) * level;
    const barX = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.014, 0.014), poleMaterial);
    barX.position.set(0, y, -size.z / 2);
    const barX2 = barX.clone();
    barX2.position.z = size.z / 2;
    const barZ = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, size.z), poleMaterial);
    barZ.position.set(-size.x / 2, y, 0);
    const barZ2 = barZ.clone();
    barZ2.position.x = size.x / 2;
    scaffold.add(barX, barX2, barZ, barZ2);
  }
  scaffold.position.copy(model.position);
  scaffold.visible = false;
  scene.add(scaffold);

  // 落件尘土
  const dustTextureShared = dustTexture();
  const dustBursts = [];
  function spawnDust(layerY, strength = 1) {
    for (let index = 0; index < 9; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: dustTextureShared,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.5 * strength,
      });
      const sprite = new THREE.Sprite(material);
      const angle = Math.random() * Math.PI * 2;
      sprite.position.set(
        model.position.x + Math.cos(angle) * size.x * 0.4,
        model.position.y + layerY,
        model.position.z + Math.sin(angle) * size.z * 0.4,
      );
      sprite.scale.setScalar(0.05 + Math.random() * 0.05);
      scene.add(sprite);
      dustBursts.push({
        sprite,
        vx: Math.cos(angle) * 0.05,
        vy: 0.05 + Math.random() * 0.06,
        vz: Math.sin(angle) * 0.05,
        age: 0,
        life: 1.1 + Math.random() * 0.4,
      });
    }
  }

  const state = {
    year: -221,
    status: 'absent',
    revealed: 0,
    progress: 0,
    lastRevealed: 0,
    lastStatus: 'absent',
    lastStepAt: 0,
    lastYearUsed: -9999,
    label: '',
  };

  const timelineInfo = timeline || { kind: 'brick', always: false, phases: [] };

  function layerY(layerIndex) {
    const inLayer = meshes.filter((item) => item.layer === layerIndex);
    if (!inLayer.length) return size.y * 0.5;
    const average = inLayer.reduce((sum, item) => sum + item.height, 0) / inLayer.length;
    return average - model.position.y;
  }

  function setYear(year) {
    const result = constructionState(timelineInfo.phases, year, { always: timelineInfo.always, layers: BUILD_LAYERS });
    state.year = year;
    state.status = result.state;
    state.revealed = result.revealed;
    state.progress = result.progress;
    state.label = result.label;
    // 焚毁瞬间：一声闷响 + 大片尘土
    if (result.state === 'burning' && state.lastStatus !== 'burning') {
      onBuildStep('burn');
      spawnDust(size.y * 0.5, 1.6);
    }
    meshes.forEach((item) => {
      const reveal = result.state === 'always' || result.state === 'complete'
        ? true
        : result.state === 'absent'
          ? false
          : item.layer < result.revealed;
      if (reveal && !item.revealed) {
        item.pop = 0; // 新露出的层弹一下
        if (result.state === 'building' && year > state.lastYearUsed) {
          const now = performance.now();
          if (now - state.lastStepAt > 200) {
            state.lastStepAt = now;
            onBuildStep(timelineInfo.kind || 'brick');
            spawnDust(layerY(item.layer));
          }
        }
      }
      item.revealed = reveal;
      item.mesh.visible = reveal;
    });
    state.lastYearUsed = year;
    state.lastStatus = result.state;
  }

  function update(dt) {
    meshes.forEach((item) => {
      if (!item.revealed) return;
      if (item.pop < 1) {
        item.pop = Math.min(1, item.pop + dt * 2.4);
        const eased = 1 + 2.2 * (item.pop - 1) ** 3 + 1.4 * (item.pop - 1) ** 2; // 轻微回弹
        item.mesh.scale.copy(item.baseScale).multiplyScalar(Math.max(0.05, eased));
      } else if (!item.mesh.scale.equals(item.baseScale)) {
        item.mesh.scale.copy(item.baseScale);
      }
    });
    // 脚手架：建造 / 焚毁时在场，随进度升高
    const building = state.status === 'building' || state.status === 'burning';
    scaffold.visible = building;
    if (building) {
      const growth = Math.max(0.25, state.progress * 1.02);
      scaffold.scale.set(1, growth, 1);
      poleMaterial.opacity = state.status === 'burning' ? 0.9 : 0.5 + state.progress * 0.4;
    }
    // 尘土
    for (let index = dustBursts.length - 1; index >= 0; index -= 1) {
      const burst = dustBursts[index];
      burst.age += dt;
      const view = burst.age / burst.life;
      if (view >= 1) {
        scene.remove(burst.sprite);
        burst.sprite.material.dispose();
        dustBursts.splice(index, 1);
        continue;
      }
      burst.sprite.position.x += burst.vx * dt;
      burst.sprite.position.y += burst.vy * dt;
      burst.sprite.position.z += burst.vz * dt;
      burst.vy -= 0.05 * dt;
      burst.sprite.material.opacity = 0.45 * (1 - view) ** 1.3;
      burst.sprite.scale.multiplyScalar(1 + dt * 0.7);
    }
  }

  function setVisible(visible) {
    model.visible = Boolean(visible);
    scaffold.visible = Boolean(visible) && (state.status === 'building' || state.status === 'burning');
  }

  function dispose() {
    scene.remove(model);
    scene.remove(scaffold);
    model.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    });
    scaffold.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
    poleMaterial.dispose();
    dustBursts.forEach((burst) => {
      scene.remove(burst.sprite);
      burst.sprite.material.dispose();
    });
    dustTextureShared.dispose();
  }

  setYear(-221);

  return {
    model,
    scaffold,
    setYear,
    update,
    setVisible,
    isVisible: () => model.visible,
    debug: () => ({
      state: state.status,
      progress: Number(state.progress.toFixed(2)),
      revealed: state.revealed,
      layers: BUILD_LAYERS,
      scaffolding: scaffold.visible,
      kind: timelineInfo.kind,
      label: state.label || '',
      meshes: meshes.length,
    }),
    dispose,
  };
}
