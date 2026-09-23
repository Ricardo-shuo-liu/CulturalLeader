// 城市光点：贴在浮雕地形上，始终面向相机（billboard），按各自所在地昼夜独立亮灭。

import * as THREE from 'three';
import { PALETTE, STAGE } from './config.js';

const quad = new THREE.PlaneGeometry(1, 1);

export function createCityPoints(cities, positions) {
  const count = cities.length;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);

  const offsets = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const scales = new Float32Array(count);
  const hovers = new Float32Array(count);
  const nights = new Float32Array(count);
  const worldPositions = [];

  cities.forEach((city, index) => {
    const point = positions[index];
    worldPositions.push(point);
    offsets.set([point.x, point.y + 0.03, point.z], index * 3);
    const color = new THREE.Color(city.accent_color || PALETTE.gold);
    colors.set([color.r, color.g, color.b], index * 3);
    phases[index] = (index * 2.399963) % (Math.PI * 2);
    scales[index] = STAGE.cityCoreSize * (index % 2 === 0 ? 1.0 : 0.88);
    hovers[index] = 0;
    nights[index] = 0;
  });

  geometry.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('iScale', new THREE.InstancedBufferAttribute(scales, 1));
  const hoverAttribute = new THREE.InstancedBufferAttribute(hovers, 1);
  geometry.setAttribute('iHover', hoverAttribute);
  const nightAttribute = new THREE.InstancedBufferAttribute(nights, 1);
  geometry.setAttribute('iNight', nightAttribute);
  geometry.instanceCount = count;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uNightFactor: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 iOffset;
      attribute vec3 iColor;
      attribute float iPhase;
      attribute float iScale;
      attribute float iHover;
      attribute float iNight;

      uniform float uTime;

      varying vec2 vUv;
      varying vec3 vColor;
      varying float vPulse;
      varying float vHover;
      varying float vNight;

      void main() {
        vUv = uv;
        vColor = iColor;
        vHover = iHover;
        vNight = iNight;

        float pulse = 0.5 + 0.5 * sin(uTime * 1.7 + iPhase);
        vPulse = pulse;
        float scale = iScale * (1.0 + 0.12 * pulse + 0.42 * iHover);

        // billboard：在视图空间铺开四边形，任何视角都正对相机
        vec4 center = modelViewMatrix * vec4(iOffset, 1.0);
        center.xy += position.xy * scale;
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNightFactor;
      uniform float uOpacity;

      varying vec2 vUv;
      varying vec3 vColor;
      varying float vPulse;
      varying float vHover;
      varying float vNight;

      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float halo = smoothstep(1.0, 0.05, d);
        float core = smoothstep(0.42, 0.0, d);
        float glow = halo * halo * 0.5 + core * 0.85;
        vec3 color = mix(vColor, vec3(1.0), core * 0.55);
        float boost = mix(0.45, 1.3, max(vNight, uNightFactor * 0.5));
        color *= (0.72 + 0.42 * vPulse) * boost * (1.0 + 0.55 * vHover);
        float alpha = glow * (0.62 + 0.3 * vPulse) * (1.0 + 0.5 * vHover) * uOpacity;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const state = { hoverIndex: -1 };

  return {
    mesh,
    material,
    worldPositions,
    setNight(values) {
      for (let i = 0; i < count; i += 1) nights[i] = values[i] ?? 0;
      nightAttribute.needsUpdate = true;
    },
    setHover(index) {
      if (state.hoverIndex === index) return;
      if (state.hoverIndex >= 0) hovers[state.hoverIndex] = 0;
      state.hoverIndex = index;
      if (index >= 0) hovers[index] = 1;
      hoverAttribute.needsUpdate = true;
    },
    get hoverIndex() {
      return state.hoverIndex;
    },
    /** 屏幕像素坐标，供 HTML 标签定位与命中判定。 */
    screenPositions(camera, width, height) {
      return worldPositions.map((point, index) => {
        const vector = point.clone();
        vector.y += 0.03;
        vector.project(camera);
        return {
          index,
          x: (vector.x * 0.5 + 0.5) * width,
          y: (-vector.y * 0.5 + 0.5) * height,
          visible: vector.z < 1,
        };
      });
    },
  };
}
