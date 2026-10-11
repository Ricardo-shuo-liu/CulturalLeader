// 诗词光韵：写作地上浮起两列竖排的「光字」。
// 每个字用 canvas 画成带光晕的字形，按列合成一张贴图（一列一面片），
// 加色混合叠在沙盘上——没有纸面、没有碑体，只有光。
// - 每列独立朝向相机（billboard），带相位浮动与明暗呼吸
// - 每首诗另有：一层很淡的暗晕（保证白天可读）、一圈柔光、一道从地面升起的光柱
// - 支持 LOD：视野拉远时只保留「代表诗词」，靠近后所有诗词一起发光

import * as THREE from 'three';
import { worldPosition } from '../terrain.js';
import { RANGES } from '../data/ranges.js';

const GOLD = '#f7d79a';
const CORE = '#fff6e2';
const POEM_RING = 0.085;
const COL_GAP = 0.105;
const ROW_GAP = 0.072;
const BASE_LIFT = 0.14;
const FONT = '"Kaiti SC", "STKaiti", "KaiTi", "Songti SC", "Noto Serif CJK SC", "Noto Serif SC", "Source Han Serif SC", serif';
const TEXTURE_CACHE_MAX = 72;

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

// ── 贴图（透明底，只留光）──────────────────────────────────

const columnCache = new Map();

function columnTexture(text) {
  if (columnCache.has(text)) return columnCache.get(text);
  const chars = Array.from(text);
  const canvas = document.createElement('canvas');
  canvas.width = 112;
  canvas.height = Math.max(140, chars.length * 76 + 60);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 62px ${FONT}`;
  // 两遍光晕 + 一遍实心笔画：远看是光，近看是字
  ctx.shadowColor = 'rgba(255, 246, 226, 0.95)';
  ctx.shadowBlur = 22;
  ctx.fillStyle = CORE;
  chars.forEach((char, index) => {
    const y = 38 + index * 76;
    ctx.fillText(char, 56, y);
    ctx.fillText(char, 56, y);
  });
  ctx.shadowBlur = 0;
  chars.forEach((char, index) => {
    ctx.fillText(char, 56, 38 + index * 76);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  columnCache.set(text, texture);
  if (columnCache.size > TEXTURE_CACHE_MAX) {
    const oldest = columnCache.keys().next().value;
    columnCache.get(oldest)?.dispose();
    columnCache.delete(oldest);
  }
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
  gradient.addColorStop(0.45, 'rgba(247, 215, 154, 0.3)');
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
  gradient.addColorStop(0, 'rgba(255, 246, 226, 0.5)');
  gradient.addColorStop(0.5, 'rgba(247, 215, 154, 0.16)');
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
  gradient.addColorStop(0, 'rgba(6, 12, 16, 0.5)');
  gradient.addColorStop(0.6, 'rgba(6, 12, 16, 0.2)');
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
 * @param {Array}  options.poems   要发光的诗词（通常传该时期全部诗词）
 * @param {Array}  options.places  该时期地点（用于查写作地坐标）
 * @param {number} options.distance 当前相机距离（决定 LOD：远时只留代表诗词）
 */
export function createPoemGlow({ scene, poems = [], places = [], distance = 5 } = {}) {
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
    const columnHeight = Math.max(1, rows) * ROW_GAP;
    const spans = [];
    columns.forEach((column, columnIndex) => {
      const chars = Array.from(column);
      if (!chars.length) return;
      const texture = columnTexture(column);
      const height = Math.max(1, chars.length) * ROW_GAP;
      const width = height * (112 / Math.max(1, texture.image.height));
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: CORE,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(quad, material);
      mesh.scale.set(width, height, 1);
      mesh.position.set((columnIndex === 0 ? 1 : -1) * COL_GAP * 0.5, BASE_LIFT + height / 2, 0);
      mesh.renderOrder = 5;
      cluster.add(mesh);
      spans.push({ mesh, baseY: mesh.position.y, phase: columnIndex * 1.7 + (poem.id.length % 5) * 0.4 });
    });

    const veil = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({ map: getVeilTexture(), transparent: true, opacity: 0.2, depthWrite: false }),
    );
    veil.scale.set(COL_GAP * 3.1, columnHeight + 0.16, 1);
    veil.position.set(0, BASE_LIFT + columnHeight / 2, -0.01);
    veil.renderOrder = 4;
    cluster.add(veil);

    const halo = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: getHaloTexture(),
        color: GOLD,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(COL_GAP * 3.4, columnHeight + 0.12, 1);
    halo.position.set(0, BASE_LIFT + columnHeight / 2, -0.005);
    halo.renderOrder = 4;
    cluster.add(halo);

    const beam = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: getBeamTexture(),
        color: GOLD,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    beam.scale.set(0.045, BASE_LIFT, 1);
    beam.position.set(0, BASE_LIFT / 2, 0);
    beam.renderOrder = 3;
    cluster.add(beam);

    items.push({
      id: poem.id,
      poem,
      place,
      featured: Boolean(poem.featured),
      world,
      cluster,
      spans,
      veil,
      halo,
      beam,
      rows,
      columnHeight,
    });
  });

  const state = { hoverId: null, distance };
  const scratch = new THREE.Vector3();
  const topOf = (item, scale) => item.world.y + (BASE_LIFT + item.columnHeight) * scale;

  return {
    group,
    items,
    ids: items.map((item) => item.id),
    /** 每帧：逐列朝向相机 + 浮动呼吸 + 昼夜明暗 + LOD + 悬停放亮。 */
    update(camera, time, { nightFactor = 0, scale = 1, distance = state.distance } = {}) {
      state.distance = distance;
      const glow = 1 + nightFactor * 0.3;
      // 视野拉远时只保留代表诗词，靠近后全部发光：既不空旷也不糊成一片
      const showAll = distance < 7.5;
      items.forEach((item) => {
        const visible = showAll || item.featured;
        item.cluster.visible = visible;
        if (!visible) return;
        const hovered = state.hoverId === item.id;
        const itemScale = scale * (hovered ? 1.06 : 1);
        item.cluster.scale.setScalar(itemScale);
        item.veil.material.opacity = (0.2 * (1 - nightFactor) + 0.05) * (hovered ? 0.7 : 1);
        item.halo.material.opacity = (0.1 + nightFactor * 0.14) * (hovered ? 2 : 1) * glow;
        item.beam.material.opacity = (0.18 + nightFactor * 0.16) * (hovered ? 1.6 : 1);
        item.spans.forEach((span) => {
          span.mesh.quaternion.copy(camera.quaternion);
          span.mesh.position.y = span.baseY + Math.sin(time * 1.05 + span.phase) * 0.006;
          const breathe = 0.76 + 0.24 * (0.5 + 0.5 * Math.sin(time * 1.6 + span.phase));
          span.mesh.material.opacity = Math.min(1, breathe * glow * (hovered ? 1.15 : 1));
        });
      });
    },
    setHover(id) {
      state.hoverId = id || null;
    },
    /** 整串光字的屏幕矩形（命中判定与自动化验收用）。 */
    screenPositions(camera, width, height) {
      return items.map((item, index) => {
        if (!item.cluster.visible) {
          return { index, id: item.id, x: 0, y: 0, top: 0, bottom: 0, halfWidth: 0, visible: false };
        }
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
