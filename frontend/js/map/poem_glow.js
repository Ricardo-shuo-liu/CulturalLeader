// 诗词光韵：代表诗词的写作地上浮起两列竖排的「光字」——单个汉字用 canvas 画成
// 带光晕的字形贴图，加色混合叠在沙盘上，没有任何纸面/碑体背景。
// - 每个字独立朝向相机（billboard），按相位轻微浮动、明暗呼吸
// - 字后有一层很淡的暗晕（白天保证可读）、一圈柔光晕与一道从地面升起的光柱
// - 夜里整体更亮；悬停时整串字放亮放大；点任意位置弹对应诗词卡

import * as THREE from 'three';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';

const GOLD = '#f7d79a';
const CORE = '#fff6e2';
const STROKE = '#fff3dc';
const POEM_RING = 0.085;
const CHAR_SIZE = 0.062;
const COL_GAP = 0.076;
const ROW_GAP = 0.072;
const BASE_LIFT = 0.15;
const FONT = '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", serif';

/** 同一写作地上多首诗词绕成的小环（与光点共用同一套落位）。 */
export function poemRingOffsets(count, index) {
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + 0.6;
  return { x: Math.cos(angle) * POEM_RING, z: Math.sin(angle) * POEM_RING };
}

/**
 * 取光字的两列文字：按标点断句后按列打包（每列 5–9 字），右列在前。
 * 例：「床前明月光，疑是地上霜。」→ [床前明月光, 疑是地上霜]
 */
export function poemColumns(text, { max = 9, min = 5 } = {}) {
  const clauses = String(text || '')
    .split(/[，。；！？、,.!?;:\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const columns = [];
  let current = '';
  for (const clause of clauses) {
    if (columns.length >= 2) break;
    if (current && current.length + clause.length > max) {
      columns.push(current);
      current = '';
    }
    current += clause;
    if (current.length >= min && columns.length < 2) {
      columns.push(current);
      current = '';
    }
  }
  if (current && columns.length < 2) columns.push(current);
  while (columns.length < 2) columns.push('');
  return columns.map((line) => (line.length > max ? line.slice(0, max) : line));
}

// ── 贴图（全部透明底，只留光）─────────────────────────────

const glyphCache = new Map();

function glyphTexture(char) {
  if (glyphCache.has(char)) return glyphCache.get(char);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 86px ${FONT}`;
  ctx.shadowColor = 'rgba(255, 246, 226, 0.95)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = CORE;
  // 两遍：先把光晕铺开，再压一笔实心笔画，远看是光、近看有字
  ctx.fillText(char, 64, 70);
  ctx.fillText(char, 64, 70);
  ctx.shadowBlur = 0;
  ctx.font = `600 86px ${FONT}`;
  ctx.fillText(char, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  glyphCache.set(char, texture);
  return texture;
}

let haloTexture = null;
function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255, 244, 214, 0.85)');
  gradient.addColorStop(0.45, 'rgba(247, 215, 154, 0.32)');
  gradient.addColorStop(1, 'rgba(247, 215, 154, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

let beamTexture = null;
function getBeamTexture() {
  if (beamTexture) return beamTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 128, 0, 0);
  gradient.addColorStop(0, 'rgba(255, 246, 226, 0.55)');
  gradient.addColorStop(0.5, 'rgba(247, 215, 154, 0.18)');
  gradient.addColorStop(1, 'rgba(247, 215, 154, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 128);
  beamTexture = new THREE.CanvasTexture(canvas);
  beamTexture.colorSpace = THREE.SRGBColorSpace;
  return beamTexture;
}

let veilTexture = null;
function getVeilTexture() {
  if (veilTexture) return veilTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(6, 12, 16, 0.55)');
  gradient.addColorStop(0.6, 'rgba(6, 12, 16, 0.22)');
  gradient.addColorStop(1, 'rgba(6, 12, 16, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  veilTexture = new THREE.CanvasTexture(canvas);
  veilTexture.colorSpace = THREE.SRGBColorSpace;
  return veilTexture;
}

/**
 * 生成诗词光韵。
 * @param {object} options
 * @param {object} options.scene   Three 场景
 * @param {Array}  options.poems   要发光的诗词（调用方已筛过 featured）
 * @param {Array}  options.places  该朝地点（用于查写作地坐标）
 */
export function createPoemGlow({ scene, poems = [], places = [] } = {}) {
  const group = new THREE.Group();
  scene?.add(group);
  const items = [];
  const placeById = (id) => places.find((place) => place.id === id) || null;

  const shareCount = new Map();
  poems.forEach((poem) => shareCount.set(poem.place_id, (shareCount.get(poem.place_id) || 0) + 1));
  const shareIndex = new Map();

  const quad = new THREE.PlaneGeometry(1, 1);

  poems.forEach((poem) => {
    const place = placeById(poem.place_id);
    if (!place) return;
    const index = shareIndex.get(poem.place_id) || 0;
    shareIndex.set(poem.place_id, index + 1);
    const offset = poemRingOffsets(shareCount.get(poem.place_id) || 1, index);
    const world = worldPosition(place.lng, place.lat, RANGES, 0.05);
    world.x += offset.x;
    world.z += offset.z;

    const cluster = new THREE.Group();
    cluster.position.copy(world);
    group.add(cluster);

    const columns = poemColumns(poem.text);
    const rows = Math.max(...columns.map((line) => Array.from(line).length), 1);
    const chars = [];
    columns.forEach((column, columnIndex) => {
      Array.from(column).forEach((char, rowIndex) => {
        const material = new THREE.MeshBasicMaterial({
          map: glyphTexture(char),
          // 笔画接近暖白、光晕用金色：看起来像"光写的字"而不是金字
          color: STROKE,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(quad, material);
        mesh.scale.setScalar(CHAR_SIZE);
        mesh.position.set(
          (columnIndex === 0 ? 1 : -1) * COL_GAP * 0.5,
          BASE_LIFT + rowIndex * ROW_GAP,
          0,
        );
        mesh.renderOrder = 5;
        cluster.add(mesh);
        chars.push({ mesh, baseY: mesh.position.y, phase: (rowIndex * 0.9 + columnIndex * 1.7) % (Math.PI * 2) });
      });
    });

    const veil = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({ map: getVeilTexture(), transparent: true, opacity: 0.2, depthWrite: false }),
    );
    veil.scale.set(COL_GAP * 3.2, ROW_GAP * (rows + 1.6), 1);
    veil.position.set(0, BASE_LIFT + ((rows - 1) * ROW_GAP) / 2, -0.01);
    veil.renderOrder = 4;
    cluster.add(veil);

    const halo = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: getHaloTexture(),
        color: GOLD,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(COL_GAP * 3.6, ROW_GAP * (rows + 1.2), 1);
    halo.position.set(0, BASE_LIFT + ((rows - 1) * ROW_GAP) / 2, -0.005);
    halo.renderOrder = 4;
    cluster.add(halo);

    const beam = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: getBeamTexture(),
        color: GOLD,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    beam.scale.set(0.05, BASE_LIFT, 1);
    beam.position.set(0, BASE_LIFT / 2, 0);
    beam.renderOrder = 3;
    cluster.add(beam);

    items.push({
      id: poem.id,
      poem,
      place,
      world,
      cluster,
      chars,
      veil,
      halo,
      beam,
      rows,
    });
  });

  const state = { hoverId: null };
  const scratch = new THREE.Vector3();
  const topOf = (item, scale) => item.world.y + (BASE_LIFT + (item.rows - 1) * ROW_GAP + CHAR_SIZE) * scale;

  return {
    group,
    items,
    ids: items.map((item) => item.id),
    /** 每帧：逐字朝向相机 + 浮动呼吸 + 昼夜明暗 + 悬停放亮。 */
    update(camera, time, { nightFactor = 0, scale = 1 } = {}) {
      const glow = 1 + nightFactor * 0.25;
      items.forEach((item) => {
        const hovered = state.hoverId === item.id;
        const itemScale = scale * (hovered ? 1.06 : 1);
        item.cluster.scale.setScalar(itemScale);
        item.veil.material.opacity = (0.2 * (1 - nightFactor) + 0.05) * (hovered ? 0.7 : 1);
        item.halo.material.opacity = (0.12 + nightFactor * 0.16) * (hovered ? 2.1 : 1) * glow;
        item.beam.material.opacity = (0.22 + nightFactor * 0.18) * (hovered ? 1.6 : 1);
        item.chars.forEach((entry) => {
          entry.mesh.quaternion.copy(camera.quaternion);
          entry.mesh.position.y = entry.baseY + Math.sin(time * 1.05 + entry.phase) * 0.005;
          const breathe = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(time * 1.7 + entry.phase));
          entry.mesh.material.opacity = Math.min(1, breathe * glow * (hovered ? 1.15 : 1));
        });
      });
    },
    setHover(id) {
      state.hoverId = id || null;
    },
    /** 整串光字的屏幕矩形（命中判定与自动化验收用）。 */
    screenPositions(camera, width, height) {
      return items.map((item, index) => {
        const scale = item.cluster.scale.x || 1;
        scratch.copy(item.world);
        scratch.y = topOf(item, scale);
        scratch.project(camera);
        const top = (-scratch.y * 0.5 + 0.5) * height;
        const topX = (scratch.x * 0.5 + 0.5) * width;
        const topVisible = scratch.z < 1;
        scratch.copy(item.world);
        scratch.project(camera);
        const bottom = (-scratch.y * 0.5 + 0.5) * height;
        return {
          index,
          id: item.id,
          x: topX,
          y: (top + bottom) / 2,
          top,
          bottom,
          halfWidth: Math.max(14, Math.abs(bottom - top) * 0.34),
          visible: topVisible && scratch.z < 1,
        };
      });
    },
    dispose() {
      items.forEach((item) => {
        item.cluster.traverse((node) => {
          node.material?.dispose?.();
        });
      });
      items.length = 0;
      group.remove(...group.children);
      scene?.remove(group);
    },
  };
}
