// 时间之尘：拖动时间轴时在锁定点周围升起的粒子流，强度 ∝ 时间流速。
// 越快地穿过年代，光尘越亮、拖尾越长——让「时间在流动」这件事看得见。

import * as THREE from 'three';

const COUNT = 220;

function spriteTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 240, 205, 0.95)');
  gradient.addColorStop(0.45, 'rgba(242, 205, 132, 0.35)');
  gradient.addColorStop(1, 'rgba(242, 205, 132, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createTimeDust({ origin, radius = 0.42, height = 1.1 } = {}) {
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);
  for (let index = 0; index < COUNT; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    positions[index * 3] = origin.x + Math.cos(angle) * r;
    positions[index * 3 + 1] = origin.y + Math.random() * height;
    positions[index * 3 + 2] = origin.z + Math.sin(angle) * r;
    speeds[index] = 0.05 + Math.random() * 0.16;
    phases[index] = Math.random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: spriteTexture(),
    size: 0.05,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: new THREE.Color('#f2cd84'),
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;

  const state = { intensity: 0, base: origin.clone(), height, radius };

  function setOrigin(point) {
    state.base.copy(point);
  }

  function setIntensity(value) {
    state.intensity = Math.min(1, Math.max(0, Number(value) || 0));
    points.visible = state.intensity > 0.02;
    material.opacity = Math.min(0.75, state.intensity * 0.75);
    material.size = 0.035 + state.intensity * 0.045;
  }

  function update(dt, time) {
    if (!points.visible) return;
    const array = geometry.attributes.position.array;
    for (let index = 0; index < COUNT; index += 1) {
      const offset = index * 3;
      const speed = speeds[index] * (0.4 + state.intensity * 1.6);
      array[offset + 1] += speed * dt;
      const wobble = Math.sin(time * 1.3 + phases[index]) * 0.02;
      array[offset] += wobble * dt;
      if (array[offset + 1] > state.base.y + state.height) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * state.radius;
        array[offset] = state.base.x + Math.cos(angle) * r;
        array[offset + 1] = state.base.y;
        array[offset + 2] = state.base.z + Math.sin(angle) * r;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.map?.dispose();
    material.dispose();
  }

  return { points, setOrigin, setIntensity, update, dispose, debug: () => ({ intensity: Number(state.intensity.toFixed(2)) }) };
}
