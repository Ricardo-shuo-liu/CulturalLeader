// 千年模式的「疆域层」：用遮罩贴图代替重建网格，让疆域像墨迹一样连续生长/收缩。
// - 每一期画一张遮罩（清晰通道 + 高斯模糊通道），运行时只把「当前段 / 下一段」两张喂给着色器；
// - 浮雕几何体直接复用主沙盘的网格（不重建、不额外占显存）；
// - 边界线按统一点数重采样，拖动时逐帧插值；走过的朝代留成幽灵线（前朝残影）。

import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { PALETTE, STAGE } from '../config.js';
import { project } from '../geo.js';
import { solarUniforms } from '../lighting.js';
import { gridUv, heightAt, TERRAIN_VERTEX, terrainFragmentSource } from '../terrain.js';

export const RESAMPLE_COUNT = 160;
export const GHOST_LIMIT = 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** 按弧长把闭合环重采样到固定点数（返回 count+1 个点，首尾相同便于连线）。 */
export function resampleRing(ring, count = RESAMPLE_COUNT) {
  const points = (ring || []).map(([lng, lat]) => [Number(lng), Number(lat)]);
  if (points.length < 3) return [];
  if (
    points.length > 1 &&
    Math.abs(points[0][0] - points[points.length - 1][0]) < 1e-9 &&
    Math.abs(points[0][1] - points[points.length - 1][1]) < 1e-9
  ) {
    points.pop();
  }
  const n = points.length;
  const lengths = new Array(n);
  let total = 0;
  for (let index = 0; index < n; index += 1) {
    const next = points[(index + 1) % n];
    const dx = next[0] - points[index][0];
    const dy = next[1] - points[index][1];
    total += Math.hypot(dx, dy);
    lengths[index] = total;
  }
  const out = [];
  for (let step = 0; step <= count; step += 1) {
    const target = (total * step) / count;
    let index = 0;
    while (index < n - 1 && lengths[index] < target) index += 1;
    const start = index === 0 ? 0 : lengths[index - 1];
    const end = lengths[index];
    const span = end - start || 1;
    const k = clamp((target - start) / span, 0, 1);
    const from = points[index];
    const to = points[(index + 1) % n];
    out.push([from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]);
  }
  return out;
}

/** 两条等长环的逐点插值。 */
export function lerpRing(a, b, t) {
  const count = Math.min(a.length, b.length);
  const out = [];
  for (let index = 0; index < count; index += 1) {
    out.push([a[index][0] + (b[index][0] - a[index][0]) * t, a[index][1] + (b[index][1] - a[index][1]) * t]);
  }
  return out;
}

const MASK_WIDTH = 512;
const MASK_HEIGHT = 288;
const MASK_BLUR = 4;

function drawMask(ring, { width = MASK_WIDTH, height = MASK_HEIGHT } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ring.forEach(([lng, lat], index) => {
    const uv = gridUv(lng, lat);
    const px = uv.u * width;
    const py = (1 - uv.v) * height;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill('evenodd');
  return canvas;
}

/** 清晰通道（R）+ 模糊通道（G）合成一张贴图：前者定疆域，后者做边界柔光。 */
export function buildEraMaskTexture(ring, { blur = MASK_BLUR } = {}) {
  const sharp = drawMask(ring);
  const blurred = document.createElement('canvas');
  blurred.width = sharp.width;
  blurred.height = sharp.height;
  const blurredCtx = blurred.getContext('2d');
  blurredCtx.filter = `blur(${blur}px)`;
  blurredCtx.drawImage(sharp, 0, 0);
  blurredCtx.filter = 'none';

  const sharpData = sharp.getContext('2d').getImageData(0, 0, sharp.width, sharp.height).data;
  const blurredData = blurredCtx.getImageData(0, 0, blurred.width, blurred.height).data;
  const packed = document.createElement('canvas');
  packed.width = sharp.width;
  packed.height = sharp.height;
  const packedCtx = packed.getContext('2d');
  const out = packedCtx.createImageData(sharp.width, sharp.height);
  for (let index = 0; index < out.data.length; index += 4) {
    out.data[index] = sharpData[index + 3];
    out.data[index + 1] = blurredData[index + 3];
    out.data[index + 2] = 0;
    out.data[index + 3] = 255;
  }
  packedCtx.putImageData(out, 0, 0);
  const texture = new THREE.CanvasTexture(packed);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

const MASK_HEADER = /* glsl */ `
  uniform sampler2D uMaskA;
  uniform sampler2D uMaskB;
  uniform float uMix;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  uniform float uCinema;
`;

const MASK_APPLY = /* glsl */ `
  float sharpA = texture2D(uMaskA, vUv).r;
  float sharpB = texture2D(uMaskB, vUv).r;
  float eraMask = mix(sharpA, sharpB, uMix);
  float softMask = mix(texture2D(uMaskA, vUv).g, texture2D(uMaskB, vUv).g, uMix);
  vec3 eraTint = mix(uTintA, uTintB, uMix);
  float rim = clamp(softMask - eraMask, 0.0, 1.0);
  color += eraTint * rim * 0.5;
  color = mix(color, color + eraTint * 0.10, clamp(eraMask, 0.0, 1.0) * 0.6);
  // 疆域之外留一点「未及之地」的微光，轮廓仍然读得出来
  alpha *= mix(0.05, 1.0, clamp(eraMask * 1.4, 0.0, 1.0));
  alpha = max(alpha, rim * 0.4 * uOpacity);
  // 银幕的亮光会洒回沙盘：屏幕一闪，地图跟着呼吸
  color += uCinema * vec3(0.92, 0.84, 0.64);
`;

/**
 * 千年地形：复用主沙盘的几何体，换上带疆域遮罩的材质。
 * @param {object} options
 * @param {THREE.BufferGeometry} options.geometry 主沙盘的浮雕几何体（含 aLng/aLat/aLand/aHeight）
 * @param {Array<Array<[number,number]>>} options.rings 11 期疆域环
 * @param {Array<string>} options.colors 11 期主题色
 */
export function createMillenniumTerrain({ geometry, rings, colors }) {
  const textures = rings.map((ring) => buildEraMaskTexture(ring, {}));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...solarUniforms(),
      uLand: { value: new THREE.Color(PALETTE.land) },
      uLandHigh: { value: new THREE.Color(PALETTE.landHigh) },
      uRidge: { value: new THREE.Color(PALETTE.ridge) },
      uPaper: { value: new THREE.Color(PALETTE.paper) },
      uRelief: { value: STAGE.relief },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uMaskA: { value: textures[0] },
      uMaskB: { value: textures[0] },
      uMix: { value: 0 },
      uTintA: { value: new THREE.Color(colors[0] || '#d8b46a') },
      uTintB: { value: new THREE.Color(colors[0] || '#d8b46a') },
      uCinema: { value: 0 },
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: terrainFragmentSource({ maskHeader: MASK_HEADER, maskApply: MASK_APPLY }),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const state = { a: 0, b: 0, mix: 0 };

  function setBlend(aIndex, bIndex, mix) {
    const a = clamp(Math.round(aIndex), 0, textures.length - 1);
    const b = clamp(Math.round(bIndex), 0, textures.length - 1);
    const nextMix = clamp(mix, 0, 1);
    if (state.a !== a) {
      material.uniforms.uMaskA.value = textures[a];
      material.uniforms.uTintA.value.set(colors[a] || '#d8b46a');
      state.a = a;
    }
    if (state.b !== b) {
      material.uniforms.uMaskB.value = textures[b];
      material.uniforms.uTintB.value.set(colors[b] || '#d8b46a');
      state.b = b;
    }
    material.uniforms.uMix.value = nextMix;
    state.mix = nextMix;
  }

  function dispose() {
    textures.forEach((texture) => texture.dispose());
    material.dispose();
  }

  return {
    mesh,
    material,
    setBlend,
    setCinema(level) {
      material.uniforms.uCinema.value = Math.min(0.4, Math.max(0, Number(level) || 0));
    },
    dispose,
    debug: () => ({ a: state.a, b: state.b, mix: Number(state.mix.toFixed(3)) }),
  };
}

/**
 * 疆域边界：一条会形变的主界线 + 任意条「前朝残影」幽灵线。
 * @param {object} options
 * @param {Array<Array<[number,number]>>} options.rings 11 期原始环（内部统一重采样）
 * @param {Array<string>} options.colors 11 期主题色
 */
export function createEraBorders({ rings, colors }) {
  const resampled = rings.map((ring) => resampleRing(ring));
  const group = new THREE.Group();
  const rims = [];

  function positionsOf(ring) {
    const positions = [];
    for (let index = 0; index < ring.length - 1; index += 1) {
      const a = ring[index];
      const b = ring[index + 1];
      const uvA = gridUvWithLift(a);
      const uvB = gridUvWithLift(b);
      positions.push(uvA.x, uvA.y, uvA.z, uvB.x, uvB.y, uvB.z);
    }
    return positions;
  }

  function gridUvWithLift([lng, lat]) {
    // 与沙盘同一套投影：x 向东、z 向南；高度贴着浮雕走，边界线才能贴着地形
    const point = project(lng, lat);
    const height = heightAt(lng, lat) * STAGE.relief;
    return { x: point.x, y: height + 0.03, z: -point.y };
  }

  function makeLine(ring, color, { opacity, linewidth }) {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positionsOf(ring));
    const material = new LineMaterial({
      color: new THREE.Color(color),
      linewidth,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false;
    return line;
  }

  const active = makeLine(resampled[0] || [], colors[0] || '#e8dcc3', { opacity: 0.95, linewidth: 2.8 });
  group.add(active);

  const ghosts = new Map(); // eraIndex → line
  let ghostMode = 'recent';

  function setBlend(aIndex, bIndex, mix) {
    const t = clamp(mix, 0, 1);
    const a = resampled[clamp(Math.round(aIndex), 0, resampled.length - 1)] || [];
    const b = resampled[clamp(Math.round(bIndex), 0, resampled.length - 1)] || [];
    const ring = a.length && b.length ? lerpRing(a, b, t) : a.length ? a : b;
    active.geometry.setPositions(positionsOf(ring));
    const colorA = new THREE.Color(colors[Math.round(aIndex)] || '#e8dcc3');
    const colorB = new THREE.Color(colors[Math.round(bIndex)] || '#e8dcc3');
    active.material.color.copy(colorA).lerp(colorB, t);
  }

  /** 走过的朝代留下幽灵线；「最近 N 条」或「全开」。 */
  function addGhost(eraIndex, visited) {
    const index = clamp(Math.round(eraIndex), 0, resampled.length - 1);
    if (!ghosts.has(index)) {
      const line = makeLine(resampled[index] || [], colors[index] || '#e8dcc3', { opacity: 0.16, linewidth: 1.6 });
      ghosts.set(index, line);
      group.add(line);
    }
    applyGhostVisibility(visited || []);
  }

  function applyGhostVisibility(visited) {
    const keep = new Set(ghostMode === 'all' ? visited : visited.slice(-GHOST_LIMIT));
    ghosts.forEach((line, index) => {
      line.visible = keep.has(index);
    });
  }

  function setGhostMode(mode, visited) {
    ghostMode = mode === 'all' ? 'all' : 'recent';
    applyGhostVisibility(visited || []);
  }

  function clearGhosts() {
    ghosts.forEach((line) => {
      group.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    });
    ghosts.clear();
  }

  function resize(width, height) {
    active.material.resolution.set(width, height);
    ghosts.forEach((line) => line.material.resolution.set(width, height));
  }

  function dispose() {
    clearGhosts();
    group.remove(active);
    active.geometry.dispose();
    active.material.dispose();
  }

  return {
    group,
    setBlend,
    addGhost,
    setGhostMode,
    clearGhosts,
    resize,
    dispose,
    debug: () => ({ ghosts: ghosts.size, visibleGhosts: Array.from(ghosts.values()).filter((line) => line.visible).length, mode: ghostMode }),
  };
}
