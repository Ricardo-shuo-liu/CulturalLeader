// 巡游路线：多选城市 → 调 LKH-3.0.14 求解最优巡回 → 在地图上画出金色航线并播报。

import * as THREE from 'three';
import { worldPosition } from './terrain.js';
import { RANGES } from './data/ranges.js';

const GOLD = '#f2c879';

export function createRoute({ scene, cities, onSelectionChange, onResult, onError }) {
  const group = new THREE.Group();
  group.renderOrder = 3;
  scene.add(group);

  const state = { active: false, selected: [], result: null, pulses: [] };
  const label = (slug) => cities.find((city) => city.slug === slug)?.name || slug;

  function clearScene() {
    state.pulses = [];
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose();
      child.material?.dispose();
    }
  }

  function draw(result) {
    clearScene();
    const byslug = new Map(result.cities.map((city) => [city.slug, city]));
    const ordered = result.order.map((slug) => byslug.get(slug)).filter(Boolean);

    ordered.forEach((city, index) => {
      const point = worldPosition(city.lng, city.lat, RANGES, 0.06);

      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.008, 8, 40),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.copy(point);
      group.add(marker);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.012, 0.34, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending }),
      );
      beam.position.copy(point).setY(point.y + 0.17);
      group.add(beam);
    });

    for (const leg of result.legs) {
      const from = byslug.get(leg.from);
      const to = byslug.get(leg.to);
      if (!from || !to) continue;
      const a = worldPosition(from.lng, from.lat, RANGES, 0.05);
      const b = worldPosition(to.lng, to.lat, RANGES, 0.05);
      const distance = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y += 0.3 + distance * 0.16;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);

      const line = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 48, 0.011, 8, false),
        new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.92 }),
      );
      group.add(line);

      const glow = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 40, 0.03, 8, false),
        new THREE.MeshBasicMaterial({
          color: '#ffdca0',
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      group.add(glow);

      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.026, 14, 10),
        new THREE.MeshBasicMaterial({
          color: '#fff2d0',
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      group.add(pulse);
      state.pulses.push({ curve, mesh: pulse, offset: Math.random(), speed: 0.22 });
    }
  }

  function renderPanel() {
    const list = document.getElementById('route-list');
    const result = document.getElementById('route-result');
    if (!list || !result) return;
    list.innerHTML = '';
    state.selected.forEach((slug, index) => {
      const item = document.createElement('div');
      item.className = 'route-item';
      item.innerHTML = `<span class="route-index">${index + 1}</span><span>${label(slug)}</span>`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '移除';
      remove.addEventListener('click', () => toggle(slug));
      item.appendChild(remove);
      list.appendChild(item);
    });
    if (!state.selected.length) {
      list.innerHTML = '<div class="route-empty">点击地图上的城市加入路线（可多选）</div>';
    }
    result.textContent = state.result
      ? `最优顺序：${state.result.names.join(' → ')}\n总里程：${Math.round(state.result.distance_km)} 公里（${state.result.solver}，${state.result.elapsed_ms} ms）`
      : '';
  }

  function toggle(slug) {
    const index = state.selected.indexOf(slug);
    if (index >= 0) state.selected.splice(index, 1);
    else state.selected.push(slug);
    state.result = null;
    clearScene();
    renderPanel();
    onSelectionChange?.(state.selected);
  }

  function setActive(value) {
    state.active = Boolean(value);
    const panel = document.getElementById('route-panel');
    const button = document.getElementById('route-btn');
    panel?.classList.toggle('show', state.active);
    button?.classList.toggle('active', state.active);
    if (button) button.textContent = state.active ? '退出规划' : '路线规划';
    if (!state.active) {
      clearScene();
      state.selected = [];
      state.result = null;
      renderPanel();
      onSelectionChange?.(state.selected);
    }
  }

  async function solve() {
    if (state.selected.length < 2) {
      onError?.('至少选择两座城市');
      return null;
    }
    const resultBox = document.getElementById('route-result');
    if (resultBox) resultBox.textContent = '正在求解…';
    try {
      const response = await fetch('/api/route/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: state.selected }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || `求解失败：${response.status}`);
      state.result = payload;
      draw(payload);
      renderPanel();
      onResult?.(payload);
      return payload;
    } catch (error) {
      if (resultBox) resultBox.textContent = '';
      onError?.(error.message || '求解失败');
      return null;
    }
  }

  // 按钮由 main.js 绑定，避免重复监听导致状态互相抵消
  document.getElementById('route-solve')?.addEventListener('click', () => solve());
  document.getElementById('route-clear')?.addEventListener('click', () => {
    state.selected = [];
    state.result = null;
    clearScene();
    renderPanel();
    onSelectionChange?.(state.selected);
  });
  renderPanel();

  return {
    get active() {
      return state.active;
    },
    get selected() {
      return [...state.selected];
    },
    setActive,
    toggle,
    solve,
    clear: () => {
      state.selected = [];
      state.result = null;
      clearScene();
      renderPanel();
      onSelectionChange?.(state.selected);
    },
    update(delta) {
      for (const pulse of state.pulses) {
        pulse.offset = (pulse.offset + delta * pulse.speed) % 1;
        const point = pulse.curve.getPointAt(pulse.offset);
        pulse.mesh.position.copy(point);
      }
    },
  };
}
