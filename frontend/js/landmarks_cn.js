// 全国省会 / 自治区首府 / 特别行政区的地标构建器（高细节版）。
// 设计原则：① 基础原型负责形体；② 每座城市再挂 2–4 件「专属部件」（大佛、九层楼、沙丘、驼队、
// 经幡、渡轮、月洞门、泉水……），保证同原型的城市也能一眼分辨；③ 统一用斗拱、反宇屋檐、
// 台基、窗格等中式细节堆出质感，而不是靠换颜色。

import * as THREE from 'three';
import {
  applyProps,
  balustrade,
  box,
  chineseRoof,
  cone,
  cyl,
  dougong,
  eaveBells,
  eaveTiles,
  lampRow,
  latticeWindow,
  mesh,
  plaque,
  platform,
  ridgeBeasts,
  roofTiles,
  sphere,
  studdedDoor,
  torus,
  treeRow,
  windowGrid,
} from './landmarks_kit.js';
import { brickTexture, curtainWallTexture, latticeTexture, material, tileTexture } from './landmarks.js';

const goldMaterial = () =>
  material('#d9a648', { metalness: 0.62, roughness: 0.3, emissive: '#3a2a08', emissiveIntensity: 0.7 });

function roofMaterial(color, tiled = true) {
  return material(color, { roughness: 0.42, metalness: 0.12, map: tiled ? tileTexture(color, color) : null });
}

function paletteOf(config) {
  return config.palette || {};
}

/** 塔刹：相轮 + 宝珠 + 火焰。 */
function finial({ y = 0, scale = 1, gold = goldMaterial() }) {
  const group = new THREE.Group();
  for (let i = 0; i < 3; i += 1) {
    const ring = mesh(torus(0.022 * scale - i * 0.004, 0.005 * scale, 8), gold, 0, y + i * 0.03 * scale, 0);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }
  group.add(mesh(sphere(0.028 * scale, 18), gold, 0, y + 0.1 * scale, 0));
  group.add(mesh(cone(0.014 * scale, 0.06 * scale, 10), gold, 0, y + 0.15 * scale, 0));
  return group;
}

// ───────────────────────── 原型 ─────────────────────────

/** 层叠塔：杭州雷峰塔 / 福州白塔 / 苏州虎丘塔 … */
function pagoda(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const square = config.shape === 'square';
  const bodyMat = material(palette.bodyColor || '#c9b79a', {
    roughness: 0.72,
    map: brickTexture(palette.bodyColor || '#c9b79a', '#a89b85'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#8f3a2c');
  const woodMat = material('#8f3a2c', { roughness: 0.6, map: latticeTexture('#8f3a2c') });
  const stoneMat = material(palette.stoneColor || '#ded3bd', { roughness: 0.8 });
  const gold = goldMaterial();
  const paneMat = material('#3b2a1e', { roughness: 0.9 });

  const base = platform({ width: 0.92, depth: 0.92, tiers: 2, material: stoneMat, steps: 3 });
  group.add(base.group);

  const tiers = config.tiers || 7;
  const total = config.height || 0.8;
  const tierHeight = total / tiers;
  const sideSegments = square ? 4 : 16;
  let y = base.top;
  for (let i = 0; i < tiers; i += 1) {
    const shrink = 1 - (i / tiers) * 0.55;
    const radius = 0.3 * shrink;
    const bodyHeight = tierHeight * 0.6;
    const shaft = mesh(cyl(radius, radius * 1.04, bodyHeight, sideSegments), i % 2 ? woodMat : bodyMat, 0, y + bodyHeight / 2, 0);
    if (square) shaft.rotation.y = Math.PI / 4;
    group.add(shaft);
    // 格窗 + 平座栏杆 + 檐铃 + 瓦当：塔身细节
    group.add(
      latticeWindow({
        width: radius * (square ? 0.7 : 1.0),
        height: bodyHeight * 0.52,
        cols: square ? 2 : 3,
        rows: 2,
        y: y + bodyHeight * 0.2,
        z: radius * (square ? 0.74 : 1.04),
        frameMaterial: woodMat,
        paneMaterial: paneMat,
      }),
    );
    if (i % 2 === 0) {
      group.add(balustrade({ width: radius * (square ? 1.5 : 2.0), y: y - 0.012, z: radius * 0.98, material: woodMat, posts: 7 }));
    }
    group.add(
      eaveTiles({
        width: radius * 2.5 * 0.98,
        y: y + bodyHeight + tierHeight * 0.08,
        z: radius * 1.24,
        count: 10,
        material: stoneMat,
      }),
    );
    if (i >= tiers - 3) {
      group.add(eaveBells({ count: 4, radius: radius * 1.26, y: y + bodyHeight + tierHeight * 0.06, material: gold }));
    }
    group.add(
      roofTiles({
        width: radius * 2.3,
        height: tierHeight * 0.4,
        y: y + bodyHeight + tierHeight * 0.06,
        z: radius * 0.92,
        rows: 3,
        material: roofMat,
      }),
    );
    if (i === 0) {
      group.add(plaque({ width: radius * 1.1, height: 0.035, y: y + bodyHeight * 0.78, z: radius * 1.06, material: material('#2f2a22', { roughness: 0.7 }), trimMaterial: gold }));
    }
    // 斗拱 + 反宇屋檐
    group.add(dougong({ count: square ? 4 : 6, radius: radius * 1.02, y: y + bodyHeight, material: woodMat, size: 0.028 }));
    const roof = chineseRoof({
      width: radius * 2.5,
      height: tierHeight * 0.48,
      material: roofMat,
      ridgeMaterial: stoneMat,
      layers: 3,
      flare: 1.04,
      corners: i >= tiers - 3,
    });
    roof.position.y = y + bodyHeight + tierHeight * 0.1;
    group.add(roof);
    if (i === 0) {
      const lamps = lampRow({ count: 6, width: radius * 2.2, y: y + bodyHeight * 0.6, z: radius * 1.05, material: gold });
      group.add(lamps);
    }
    y += tierHeight;
  }
  group.add(finial({ y: y - 0.02, scale: 1 + tiers * 0.03, gold }));
  return applyProps(group, config.props, config);
}

/** 楼阁：武汉黄鹤楼 / 南昌滕王阁 / 济南超然楼 / 贵阳甲秀楼 … */
function towerPavilion(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const bodyMat = material(palette.bodyColor || '#8f3a2c', {
    roughness: 0.62,
    map: latticeTexture(palette.bodyColor || '#8f3a2c', '#e6cf9c'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#3f6b4a');
  const stoneMat = material('#ded3bd', { roughness: 0.8 });
  const redMat = material('#8f2f26', { roughness: 0.6 });
  const paneMat = material('#3b2a1e', { roughness: 0.9 });
  const gold = goldMaterial();

  const base = platform({ width: 0.98, depth: 0.8, tiers: 2, material: stoneMat, steps: 4 });
  group.add(base.group);

  const tiers = config.tiers || 5;
  const step = 0.145;
  let y = base.top;
  for (let i = 0; i < tiers; i += 1) {
    const shrink = 1 - i * 0.13;
    const width = 0.62 * shrink;
    const bodyHeight = step * 0.62;
    const hall = mesh(box(width, bodyHeight, width * 0.82), bodyMat, 0, y + bodyHeight / 2, 0);
    group.add(hall);
    // 廊柱
    const columns = 4;
    for (let c = 0; c < columns; c += 1) {
      const x = -width * 0.5 + (c / (columns - 1)) * width;
      [-1, 1].forEach((side) => {
        group.add(mesh(cyl(0.011, 0.011, bodyHeight, 8), redMat, x, y + bodyHeight / 2, side * width * 0.42));
      });
    }
    group.add(
      latticeWindow({
        width: width * 0.66,
        height: bodyHeight * 0.46,
        cols: 3,
        rows: 2,
        y: y + bodyHeight * 0.2,
        z: width * 0.44,
        frameMaterial: bodyMat,
        paneMaterial: paneMat,
      }),
    );
    group.add(balustrade({ width: width * 0.94, y: y - 0.014, z: width * 0.45, material: redMat, posts: 6 }));
    group.add(eaveTiles({ width: width * 1.86, y: y + bodyHeight + step * 0.04, z: width * 0.52, count: 9, material: stoneMat }));
    group.add(
      roofTiles({ width: width * 1.7, height: step * 0.4, y: y + bodyHeight + step * 0.04, z: width * 0.3, rows: 2, material: roofMat }),
    );
    if (i === tiers - 1) {
      group.add(plaque({ width: width * 0.5, height: 0.032, y: y + bodyHeight * 0.7, z: width * 0.5, material: material('#2f2a22', { roughness: 0.7 }), trimMaterial: gold }));
    }
    if (i >= tiers - 2) {
      group.add(eaveBells({ count: 4, radius: width * 0.6, y: y + bodyHeight + step * 0.04, material: gold }));
    }
    if (i === 0) {
      group.add(
        studdedDoor({ width: width * 0.22, height: bodyHeight * 0.6, y: y + 0.004, z: width * 0.45, material: redMat, studMaterial: gold, rows: 3, cols: 2 }),
      );
    }
    group.add(dougong({ count: 6, radius: width * 0.56, y: y + bodyHeight, material: redMat, size: 0.026 }));
    const roof = chineseRoof({
      width: width * 1.9,
      height: step * 0.52,
      material: roofMat,
      ridgeMaterial: gold,
      layers: 3,
      flare: 1.1,
      corners: i >= tiers - 2,
    });
    roof.position.y = y + bodyHeight + step * 0.06;
    group.add(roof);
    if (i === 0) {
      group.add(lampRow({ count: 8, width: width * 1.1, y: y + bodyHeight * 0.7, z: width * 0.44, material: gold }));
    }
    y += step;
  }
  const crown = mesh(cone(0.09, 0.2, 12), roofMat, 0, y + 0.1, 0);
  group.add(crown);
  group.add(finial({ y: y + 0.16, scale: 0.9, gold }));
  return applyProps(group, config.props, config);
}

/** 城门楼：南京 / 合肥 / 长沙 … */
function cityGate(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const brickMat = material(palette.wallColor || '#9a8b74', {
    roughness: 0.85,
    map: brickTexture(palette.wallColor || '#9a8b74', '#7d7060'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#3f5f8c');
  const stoneMat = material('#ded3bd', { roughness: 0.8 });
  const darkMat = material('#241b14', { roughness: 0.95 });
  const gold = goldMaterial();
  const woodMat = material('#8a4a32', { roughness: 0.65 });

  const base = platform({ width: 1.15, depth: 0.7, tiers: 1, material: stoneMat, steps: 3 });
  group.add(base.group);
  // 城墙与垛口
  const wall = mesh(box(1.5, 0.3, 0.28), brickMat, 0, base.top + 0.15, 0);
  group.add(wall);
  const crenels = 11;
  for (let i = 0; i < crenels; i += 1) {
    const x = -0.7 + (i / (crenels - 1)) * 1.4;
    group.add(mesh(box(0.06, 0.05, 0.3), brickMat, x, base.top + 0.325, 0));
  }
  // 城门洞 + 门钉板门 + 砖缝
  const archOuter = mesh(cyl(0.1, 0.1, 0.3, 24), darkMat, 0, base.top + 0.15, 0.02);
  archOuter.rotation.x = Math.PI / 2;
  group.add(archOuter);
  const archInner = mesh(cyl(0.082, 0.082, 0.32, 24), darkMat, 0, base.top + 0.15, 0.02);
  archInner.rotation.x = Math.PI / 2;
  group.add(archInner);
  group.add(
    studdedDoor({ width: 0.15, height: 0.19, y: base.top + 0.005, z: 0.155, material: woodMat, studMaterial: goldMaterial(), rows: 4, cols: 3 }),
  );
  for (let i = 0; i < 7; i += 1) {
    group.add(mesh(box(1.5, 0.004, 0.006), darkMat, 0, base.top + 0.02 + i * 0.042, 0.145));
  }
  // 门楼两层
  const towerHeight = 0.3;
  group.add(mesh(box(0.5, towerHeight, 0.24), brickMat, 0, base.top + 0.3 + towerHeight / 2, 0));
  group.add(
    windowGrid({
      width: 0.34,
      height: 0.08,
      cols: 3,
      rows: 1,
      y: base.top + 0.36,
      z: 0.13,
      frameMaterial: woodMat,
      paneMaterial: darkMat,
    }),
  );
  group.add(dougong({ count: 6, radius: 0.28, y: base.top + 0.6, material: woodMat, size: 0.024 }));
  group.add(ridgeBeasts({ width: 0.5, y: base.top + 0.72, material: gold, count: 2 }));
  group.add(eaveTiles({ width: 0.72, y: base.top + 0.63, z: 0.2, count: 9, material: stoneMat }));
  group.add(eaveBells({ count: 4, radius: 0.34, y: base.top + 0.6, material: gold }));
  [0, 0.11].forEach((offset, index) => {
    const roof = chineseRoof({
      width: (index === 0 ? 0.78 : 0.58) * 1.0,
      height: 0.1,
      material: roofMat,
      ridgeMaterial: gold,
      layers: 3,
      flare: 1.12,
    });
    roof.position.y = base.top + 0.62 + offset;
    group.add(roof);
  });
  group.add(finial({ y: base.top + 0.8, scale: 0.8, gold }));
  group.add(lampRow({ count: 6, width: 0.5, y: base.top + 0.36, z: 0.15, material: gold }));
  group.add(plaque({ width: 0.28, height: 0.05, y: base.top + 0.44, z: 0.13, material: material('#2f2a22', { roughness: 0.7 }), trimMaterial: gold }));
  return applyProps(group, config.props, config);
}

/** 宫殿：沈阳故宫大政殿 / 长春伪满皇宫 … */
function palacePavilion(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const wallMat = material(palette.wallColor || '#a5342c', {
    roughness: 0.66,
    map: latticeTexture(palette.wallColor || '#a5342c', '#e6cf9c'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#e0b23c');
  const stoneMat = material('#ded3bd', { roughness: 0.8 });
  const gold = goldMaterial();
  const darkMat = material('#2f241b', { roughness: 0.9 });

  const base = platform({ width: 1.24, depth: 0.86, tiers: 2, material: stoneMat, steps: 5 });
  group.add(base.group);
  // 正殿
  const hallWidth = 0.7;
  const hallHeight = 0.26;
  group.add(mesh(box(hallWidth, hallHeight, 0.4), wallMat, 0, base.top + hallHeight / 2, 0));
  for (let c = 0; c < 6; c += 1) {
    const x = -hallWidth * 0.46 + (c / 5) * hallWidth * 0.92;
    [-1, 1].forEach((side) => {
      group.add(mesh(cyl(0.014, 0.014, hallHeight, 10), material('#8a2e26', { roughness: 0.6 }), x, base.top + hallHeight / 2, side * 0.21));
    });
  }
  group.add(
    windowGrid({
      width: hallWidth * 0.72,
      height: hallHeight * 0.42,
      cols: 4,
      rows: 1,
      y: base.top + hallHeight * 0.22,
      z: 0.205,
      frameMaterial: wallMat,
      paneMaterial: darkMat,
    }),
  );
  group.add(dougong({ count: 10, radius: hallWidth * 0.52, y: base.top + hallHeight, material: material('#c9a227', { roughness: 0.5 }), size: 0.032 }));
  group.add(
    studdedDoor({ width: 0.2, height: 0.18, y: base.top + 0.005, z: 0.208, material: material('#7a2a22', { roughness: 0.7 }), studMaterial: goldMaterial(), rows: 4, cols: 3 }),
  );
  group.add(eaveTiles({ width: hallWidth * 1.6, y: base.top + hallHeight + 0.02, z: hallWidth * 0.9, count: 11, material: stoneMat }));
  const mainRoof = chineseRoof({
    width: hallWidth * 1.7,
    height: 0.2,
    material: roofMat,
    ridgeMaterial: gold,
    layers: 4,
    flare: 1.14,
  });
  mainRoof.position.y = base.top + hallHeight + 0.03;
  group.add(mainRoof);
  // 两翼
  [-0.44, 0.44].forEach((x) => {
    const wingHeight = 0.17;
    group.add(mesh(box(0.26, wingHeight, 0.26), wallMat, x, base.top + wingHeight / 2, -0.03));
    const wingRoof = chineseRoof({
      width: 0.42,
      height: 0.1,
      material: roofMat,
      ridgeMaterial: gold,
      layers: 2,
      flare: 1.1,
    });
    wingRoof.position.set(x, base.top + wingHeight + 0.02, -0.03);
    group.add(wingRoof);
  });
  // 旗杆与灯笼
  [-0.56, 0.56].forEach((x) => {
    group.add(mesh(cyl(0.008, 0.008, 0.44, 8), material('#7a5238', { roughness: 0.7 }), x, base.top + 0.22, 0.36));
    group.add(mesh(sphere(0.022, 12), gold, x, base.top + 0.46, 0.36));
  });
  group.add(lampRow({ count: 8, width: 0.86, y: base.top + 0.1, z: 0.42, material: gold }));
  group.add(plaque({ width: 0.3, height: 0.055, y: base.top + 0.3, z: 0.21, material: material('#2f2a22', { roughness: 0.7 }), trimMaterial: gold }));
  return applyProps(group, config.props, config);
}

/** 穹顶与尖塔：哈尔滨圣索菲亚 / 银川清真寺 / 乌鲁木齐大巴扎 … */
function domeTemple(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const wallMat = material(palette.wallColor || '#c9c0ae', {
    roughness: 0.74,
    map: brickTexture(palette.wallColor || '#c9c0ae', '#a99e8b'),
  });
  const domeMat = material(palette.domeColor || '#4f7f6a', { metalness: 0.5, roughness: 0.3 });
  const stoneMat = material('#ded3bd', { roughness: 0.8 });
  const darkMat = material('#3b2a1e', { roughness: 0.9 });
  const gold = goldMaterial();
  const onion = Boolean(config.onion);

  const base = platform({ width: 1.0, depth: 0.9, tiers: 2, material: stoneMat, steps: 3 });
  group.add(base.group);
  const hallHeight = 0.32;
  group.add(mesh(cyl(0.34, 0.36, hallHeight, 20), wallMat, 0, base.top + hallHeight / 2, 0));
  // 拱门与窗
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const door = mesh(box(0.1, 0.16, 0.02), darkMat, Math.cos(angle) * 0.345, base.top + 0.12, Math.sin(angle) * 0.345);
    door.rotation.y = -angle;
    group.add(door);
  }
  group.add(dougong({ count: 8, radius: 0.36, y: base.top + hallHeight, material: stoneMat, size: 0.03 }));
  const drum = mesh(cyl(0.28, 0.3, 0.1, 20), wallMat, 0, base.top + hallHeight + 0.05, 0);
  group.add(drum);
  const dome = mesh(sphere(0.3, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.55), domeMat, 0, base.top + hallHeight + 0.1, 0);
  dome.scale.set(1, onion ? 1.3 : 1.05, 1);
  group.add(dome);
  group.add(finial({ y: base.top + hallHeight + (onion ? 0.46 : 0.36), scale: 1.1, gold }));
  // 宣礼塔
  const minarets = config.minarets ?? 2;
  for (let i = 0; i < minarets; i += 1) {
    const angle = (i / Math.max(1, minarets)) * Math.PI * 2 + Math.PI / Math.max(1, minarets);
    const x = Math.cos(angle) * 0.44;
    const z = Math.sin(angle) * 0.44;
    group.add(mesh(cyl(0.05, 0.06, 0.5, 14), wallMat, x, base.top + 0.25, z));
    group.add(mesh(cyl(0.065, 0.055, 0.03, 14), domeMat, x, base.top + 0.44, z));
    group.add(mesh(cyl(0.04, 0.045, 0.12, 14), wallMat, x, base.top + 0.52, z));
    const cap = mesh(cone(0.07, 0.16, 12), domeMat, x, base.top + 0.66, z);
    group.add(cap);
    group.add(mesh(sphere(0.02, 12), gold, x, base.top + 0.76, z));
    for (let k = 0; k < 4; k += 1) {
      group.add(
        mesh(box(0.03, 0.02, 0.008), darkMat, x + Math.cos((k / 4) * Math.PI * 2) * 0.05, base.top + 0.3 + k * 0.05, z + Math.sin((k / 4) * Math.PI * 2) * 0.05),
      );
    }
  }
  if (config.arches) {
    group.add(dougong({ count: 12, radius: 0.37, y: base.top + 0.06, material: domeMat, size: 0.022 }));
  }
  return applyProps(group, config.props, config);
}

/** 蒙古包 + 藏蒙寺院：呼和浩特 */
function yurtTemple(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const feltMat = material(palette.feltColor || '#ece3cf', { roughness: 0.92 });
  const trimMat = material('#8f3a2c', { roughness: 0.62 });
  const wallMat = material('#c8b89c', { roughness: 0.8, map: brickTexture('#c8b89c', '#ab9b80') });
  const roofMat = roofMaterial(palette.roofColor || '#3f6b4a');
  const gold = goldMaterial();
  const stoneMat = material('#ded3bd', { roughness: 0.8 });

  const base = platform({ width: 1.0, depth: 0.8, tiers: 1, material: stoneMat, steps: 2 });
  group.add(base.group);
  // 大召式大殿
  const hallHeight = 0.24;
  group.add(mesh(box(0.6, hallHeight, 0.4), wallMat, 0, base.top + hallHeight / 2, 0));
  group.add(
    windowGrid({ width: 0.44, height: 0.1, cols: 4, rows: 1, y: base.top + 0.08, z: 0.21, frameMaterial: trimMat, paneMaterial: material('#3b2a1e', { roughness: 0.9 }) }),
  );
  group.add(dougong({ count: 8, radius: 0.32, y: base.top + hallHeight, material: trimMat, size: 0.028 }));
  const roof = chineseRoof({ width: 0.78, height: 0.14, material: roofMat, ridgeMaterial: gold, layers: 3, flare: 1.12 });
  roof.position.y = base.top + hallHeight + 0.02;
  group.add(roof);
  group.add(finial({ y: base.top + hallHeight + 0.16, scale: 1.0, gold }));
  // 三座蒙古包
  [[-0.36, 0.26, 1], [0.36, 0.28, 0.95], [0.0, -0.3, 0.85]].forEach(([x, z, scale]) => {
    const radius = 0.15 * scale;
    const yurt = mesh(cyl(radius, radius * 1.06, 0.12 * scale, 22), feltMat, x, base.top + 0.06 * scale, z);
    group.add(yurt);
    const roofYurt = mesh(cone(radius * 1.08, 0.1 * scale, 22), feltMat, x, base.top + 0.17 * scale, z);
    group.add(roofYurt);
    const band = mesh(torus(radius * 1.02, 0.01, 8), trimMat, x, base.top + 0.11 * scale, z);
    band.rotation.x = Math.PI / 2;
    group.add(band);
    const door = mesh(box(0.05 * scale, 0.07 * scale, 0.012), trimMat, x, base.top + 0.035 * scale, z + radius * 1.02);
    group.add(door);
  });
  group.add(lampRow({ count: 5, width: 0.5, y: base.top + 0.05, z: 0.42, material: gold }));
  group.add(plaque({ width: 0.26, height: 0.05, y: base.top + 0.2, z: 0.21, material: material('#2f2a22', { roughness: 0.7 }), trimMaterial: gold }));
  return applyProps(group, config.props, config);
}

/** 现代天际线：香港 / 南宁 … */
function skyline(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const glassMat = material(palette.glassColor || '#9fb6c4', {
    metalness: 0.45,
    roughness: 0.24,
    map: curtainWallTexture(palette.glassColor || '#9fb6c4', '#6d8494'),
  });
  const accentMat = material(palette.accentColor || '#cbd8e2', { metalness: 0.62, roughness: 0.26 });
  const stoneMat = material('#8d8271', { roughness: 0.82 });
  const glow = material('#f2c879', { emissive: '#a06a14', emissiveIntensity: 1.15 });
  const towers = config.towers || [
    { x: 0, z: 0, w: 0.17, h: 0.92, top: 'spire', style: 'curtain' },
    { x: -0.22, z: 0.13, w: 0.15, h: 0.56, style: 'curtain' },
    { x: 0.22, z: 0.15, w: 0.14, h: 0.48, style: 'band' },
    { x: -0.13, z: -0.22, w: 0.13, h: 0.4, style: 'band' },
    { x: 0.18, z: -0.24, w: 0.15, h: 0.62, top: 'flat', style: 'curtain' },
  ];
  const base = platform({ width: 1.2, depth: 0.9, tiers: 1, material: stoneMat, steps: 2, railing: false });
  group.add(base.group);
  towers.forEach((tower, index) => {
    const height = tower.h;
    const bodyMat = tower.style === 'band' ? accentMat : glassMat;
    const shaft = mesh(box(tower.w, height, tower.w * 0.92), bodyMat, tower.x || 0, base.top + height / 2, tower.z || 0);
    group.add(shaft);
    // 楼层横线
    const bands = Math.max(4, Math.round(height / 0.05));
    for (let i = 1; i < bands; i += 1) {
      const band = mesh(box(tower.w * 1.04, 0.006, tower.w * 0.96), index % 2 ? accentMat : glassMat, tower.x || 0, base.top + (height / bands) * i, tower.z || 0);
      group.add(band);
    }
    // 屋顶附属
    const rooftop = mesh(box(tower.w * 0.5, 0.03, tower.w * 0.5), accentMat, tower.x || 0, base.top + height + 0.015, tower.z || 0);
    group.add(rooftop);
    if (tower.top === 'spire') {
      group.add(mesh(cone(tower.w * 0.34, 0.2, 12), accentMat, tower.x || 0, base.top + height + 0.12, tower.z || 0));
      group.add(mesh(cyl(0.006, 0.006, 0.06, 8), accentMat, tower.x || 0, base.top + height + 0.24, tower.z || 0));
    }
    if (tower.top === 'crown') {
      const crown = mesh(cyl(tower.w * 0.86, tower.w * 0.44, 0.06, 4, true), goldMaterial(), tower.x || 0, base.top + height + 0.045, tower.z || 0);
      crown.rotation.y = Math.PI / 4;
      group.add(crown);
    }
    if (tower.lights) {
      for (let i = 0; i < 6; i += 1) {
        group.add(mesh(sphere(0.012, 8), glow, tower.x || 0, base.top + 0.06 + i * 0.06, (tower.z || 0) + tower.w * 0.5));
      }
    }
  });
  return applyProps(group, config.props, config);
}

/** 层叠斗形塔（台北 101 式） */
function stackedTower(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const glassMat = material(palette.glassColor || '#a8c2cf', {
    metalness: 0.4,
    roughness: 0.22,
    map: curtainWallTexture(palette.glassColor || '#a8c2cf', '#7a95a6'),
  });
  const frameMat = material(palette.frameColor || '#7fa6a0', { metalness: 0.52, roughness: 0.3 });
  const stoneMat = material('#8d8271', { roughness: 0.82 });
  const glow = material('#f2c879', { emissive: '#a06a14', emissiveIntensity: 1.2 });
  const base = platform({ width: 1.0, depth: 0.9, tiers: 2, material: stoneMat, steps: 3 });
  group.add(base.group);
  // 裙楼
  group.add(mesh(box(0.62, 0.14, 0.56), frameMat, 0, base.top + 0.07, 0));
  group.add(
    windowGrid({ width: 0.5, height: 0.06, cols: 6, rows: 1, y: base.top + 0.05, z: 0.285, frameMaterial: frameMat, paneMaterial: glassMat }),
  );
  const sections = config.sections || 8;
  const sectionHeight = 0.085;
  let y = base.top + 0.14;
  for (let i = 0; i < sections; i += 1) {
    const width = 0.42 - i * 0.014;
    group.add(mesh(box(width, sectionHeight * 0.6, width), glassMat, 0, y + sectionHeight * 0.3, 0));
    // 每段 8 层窗线
    for (let k = 0; k < 8; k += 1) {
      const line = mesh(box(width * 1.03, 0.0035, width * 1.03), frameMat, 0, y + sectionHeight * 0.08 + k * (sectionHeight * 0.055), 0);
      group.add(line);
    }
    const flare = mesh(cyl(width * 0.86, width * 1.14, sectionHeight * 0.4, 4, false), frameMat, 0, y + sectionHeight * 0.8, 0);
    flare.rotation.y = Math.PI / 4;
    group.add(flare);
    if (config.nightLights) {
      group.add(lampRow({ count: 4, width: width * 0.7, y: y + sectionHeight * 0.4, z: width * 0.52, material: glow }));
    }
    y += sectionHeight;
  }
  group.add(mesh(cyl(0.016, 0.022, 0.3, 12), frameMat, 0, y + 0.15, 0));
  group.add(mesh(sphere(0.02, 12), goldMaterial(), 0, y + 0.31, 0));
  return applyProps(group, config.props, config);
}

/** 拱桥：石家庄赵州桥 / 兰州中山桥 … */
function archBridge(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const stoneMat = material(palette.stoneColor || '#c2b8a4', {
    roughness: 0.82,
    map: brickTexture(palette.stoneColor || '#c2b8a4', '#a49a86'),
  });
  const steelMat = material('#9aa2a6', { metalness: 0.6, roughness: 0.34 });
  const memberMat = config.steel ? steelMat : stoneMat;
  const span = 0.96;
  const arch = mesh(torus(0.36, 0.05, 10, Math.PI), memberMat, 0, 0.32, 0);
  group.add(arch);
  if (!config.steel) {
    // 敞肩小拱
    [-0.27, 0.27].forEach((x) => {
      const small = mesh(torus(0.09, 0.022, 8, Math.PI), memberMat, x, 0.36, 0);
      group.add(small);
    });
  }
  group.add(mesh(box(span, 0.05, 0.16), config.steel ? steelMat : stoneMat, 0, 0.34, 0));
  [-0.09, 0.09].forEach((z) => {
    group.add(mesh(box(span, 0.045, 0.02), memberMat, 0, 0.39, z));
  });
  for (let i = -2; i <= 2; i += 1) {
    group.add(mesh(box(0.022, 0.07, 0.2), memberMat, i * 0.21, 0.4, 0));
  }
  if (config.steel) {
    // 桁架
    for (let i = -3; i <= 3; i += 1) {
      const x = i * 0.14;
      group.add(mesh(cyl(0.006, 0.006, 0.12, 6), steelMat, x, 0.45, -0.08));
      group.add(mesh(cyl(0.006, 0.006, 0.12, 6), steelMat, x, 0.45, 0.08));
    }
    group.add(mesh(box(span, 0.012, 0.012), steelMat, 0, 0.51, -0.08));
    group.add(mesh(box(span, 0.012, 0.012), steelMat, 0, 0.51, 0.08));
  }
  if (config.piers) {
    [-0.3, 0.3].forEach((x) => {
      group.add(mesh(box(0.09, 0.22, 0.18), memberMat, x, 0.11, 0));
    });
  }
  return applyProps(group, config.props, config);
}

/** 摩天轮：天津之眼 */
function ferrisWheel(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const steelMat = material(palette.steelColor || '#dfe6ec', { metalness: 0.66, roughness: 0.26 });
  const accentMat = material(palette.accentColor || '#e0645f', { roughness: 0.45 });
  const glow = material('#f2c879', { emissive: '#a06a14', emissiveIntensity: 1.2 });
  const stoneMat = material('#8d8271', { roughness: 0.82 });
  const radius = 0.44;
  const hubY = 0.66;
  const base = platform({ width: 0.9, depth: 0.6, tiers: 1, material: stoneMat, steps: 2, railing: false });
  group.add(base.group);
  // 双轮圈 + 内圈
  [radius, radius * 0.72].forEach((r) => {
    const ring = mesh(torus(r, 0.014, 8), steelMat, 0, hubY, 0);
    group.add(ring);
  });
  const spokes = 16;
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2;
    const spoke = mesh(box(radius * 0.96, 0.006, 0.006), steelMat, Math.cos(angle) * radius * 0.48, hubY + Math.sin(angle) * radius * 0.48, 0);
    spoke.rotation.z = angle;
    group.add(spoke);
    const cabin = mesh(box(0.05, 0.035, 0.04), i % 3 === 0 ? accentMat : steelMat, Math.cos(angle) * radius, hubY + Math.sin(angle) * radius, 0);
    group.add(cabin);
    if (i % 2 === 0) group.add(mesh(sphere(0.008, 8), glow, Math.cos(angle) * radius, hubY + Math.sin(angle) * radius - 0.03, 0));
  }
  const hub = mesh(cyl(0.03, 0.03, 0.06, 16), steelMat, 0, hubY, 0);
  hub.rotation.x = Math.PI / 2;
  group.add(hub);
  [-1, 1].forEach((side) => {
    const leg = mesh(box(0.03, 0.68, 0.03), steelMat, side * 0.13, 0.34, 0);
    leg.rotation.z = side * 0.3;
    group.add(leg);
    group.add(mesh(box(0.02, 0.02, 0.02), steelMat, side * 0.06, 0.66, 0));
  });
  // 桥面
  group.add(mesh(box(1.1, 0.02, 0.24), stoneMat, 0, 0.03, 0.24));
  return applyProps(group, config.props, config);
}

/** 层叠吊脚楼：重庆洪崖洞 */
function stiltHouse(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const woodMat = material(palette.woodColor || '#7a5238', {
    roughness: 0.75,
    map: latticeTexture(palette.woodColor || '#7a5238', '#d8c9a3'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#3c4b57');
  const glow = material('#f2c879', { emissive: '#a06a14', emissiveIntensity: 1.25 });
  const stoneMat = material('#6f6a5e', { roughness: 0.9 });
  const levels = config.levels || 6;
  // 崖壁
  const cliff = mesh(box(1.0, 0.5, 0.5), stoneMat, 0, 0.25, -0.12);
  group.add(cliff);
  for (let i = 0; i < levels; i += 1) {
    const width = 0.84 - i * 0.08;
    const depth = 0.38 - i * 0.03;
    const height = 0.11;
    const y = 0.06 + i * height;
    const house = mesh(box(width, height * 0.78, depth), woodMat, 0, y + height * 0.39, -i * 0.015 + 0.06);
    group.add(house);
    // 檐
    const eave = mesh(cyl(width * 0.3, width * 0.62, 0.05, 4, true), roofMat, 0, y + height * 0.86, -i * 0.015 + 0.06);
    eave.rotation.y = Math.PI / 4;
    group.add(eave);
    // 连排灯笼与窗
    group.add(lampRow({ count: 7, width: width * 0.82, y: y + height * 0.5, z: depth * 0.5 + 0.07, material: glow }));
    group.add(
      windowGrid({
        width: width * 0.6,
        height: height * 0.3,
        cols: 4,
        rows: 1,
        y: y + height * 0.2,
        z: depth * 0.5 + 0.06,
        frameMaterial: woodMat,
        paneMaterial: glow,
      }),
    );
    if (i < levels - 1) {
      [-width * 0.42, width * 0.42].forEach((x) => {
        group.add(mesh(cyl(0.012, 0.012, height + 0.08, 8), woodMat, x, y + height * 0.1, depth * 0.5 + 0.02));
      });
    }
  }
  // 台阶
  for (let i = 0; i < 6; i += 1) {
    group.add(mesh(box(0.22, 0.02, 0.05), stoneMat, -0.36, 0.03 + i * 0.05, 0.3 + i * 0.05));
  }
  return applyProps(group, config.props, config);
}

/** 依山宫堡：拉萨布达拉宫 */
function potala(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const rockMat = material(palette.rockColor || '#8b7f6d', { roughness: 0.95 });
  const whiteMat = material(palette.whiteColor || '#efe7d6', {
    roughness: 0.72,
    map: brickTexture(palette.whiteColor || '#efe7d6', '#d9cfba'),
  });
  const redMat = material(palette.redColor || '#8f3a2c', { roughness: 0.68, map: latticeTexture('#8f3a2c', '#e0c690') });
  const roofMat = roofMaterial('#e0b23c');
  const gold = goldMaterial();

  const hill = mesh(cone(0.66, 0.46, 8), rockMat, 0, 0.23, 0);
  hill.rotation.y = Math.PI * 0.15;
  hill.scale.set(1.15, 1, 0.9);
  group.add(hill);
  // 白宫（两翼）
  group.add(mesh(box(0.94, 0.26, 0.46), whiteMat, 0, 0.52, 0));
  group.add(mesh(box(0.62, 0.1, 0.4), whiteMat, 0, 0.68, 0));
  // 红宫
  const redPalace = mesh(box(0.36, 0.36, 0.36), redMat, 0, 0.72, 0);
  group.add(redPalace);
  // 窗（黑框白窗套，藏式）
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = -0.12 + col * 0.08;
      const y = 0.6 + row * 0.08;
      group.add(mesh(box(0.05, 0.07, 0.01), material('#3b2a1e', { roughness: 0.9 }), x, y, 0.19));
      group.add(mesh(box(0.062, 0.08, 0.008), whiteMat, x, y, 0.185));
    }
  }
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const x = -0.36 + col * 0.14;
      const y = 0.46 + row * 0.08;
      if (Math.abs(x) < 0.2 && row === 2) continue;
      group.add(mesh(box(0.05, 0.07, 0.01), material('#3b2a1e', { roughness: 0.9 }), x, y, 0.24));
      group.add(mesh(box(0.062, 0.08, 0.008), whiteMat, x, y, 0.235));
    }
  }
  // 金顶群
  [-0.2, 0, 0.2].forEach((x, index) => {
    const roof = chineseRoof({
      width: index === 1 ? 0.22 : 0.17,
      height: 0.07,
      material: roofMat,
      ridgeMaterial: gold,
      layers: 3,
      flare: 1.15,
    });
    roof.position.set(x, 0.9 + (index === 1 ? 0.02 : 0), 0);
    group.add(roof);
    group.add(finial({ y: 0.98 + (index === 1 ? 0.02 : 0), scale: 0.8, gold }));
  });
  group.add(mesh(box(0.1, 0.06, 0.1), gold, 0, 0.99, 0));
  // 之字形台阶
  for (let i = 0; i < 9; i += 1) {
    group.add(mesh(box(0.5 - i * 0.02, 0.02, 0.06), whiteMat, 0, 0.36 - i * 0.02, 0.3 + i * 0.04));
  }
  for (let i = 0; i < 5; i += 1) {
    group.add(mesh(box(0.4, 0.02, 0.05), whiteMat, i % 2 ? 0.06 : -0.06, 0.19 + i * 0.02, 0.52 + i * 0.05));
  }
  group.add(lampRow({ count: 6, width: 0.5, y: 0.44, z: 0.27, material: gold }));
  return applyProps(group, config.props, config);
}

/** 牌坊：昆明金马碧鸡坊 */
function archway(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const stoneMat = material(palette.stoneColor || '#b8443a', {
    roughness: 0.6,
    map: latticeTexture(palette.stoneColor || '#b8443a', '#f0dfae'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#d9a648');
  const gold = goldMaterial();
  const plaqueMat = material('#2f2a22', { roughness: 0.7 });
  const base = platform({ width: 1.1, depth: 0.5, tiers: 1, material: material('#cbbda3', { roughness: 0.85 }), steps: 3, railing: false });
  group.add(base.group);
  const pillars = [-0.36, -0.13, 0.13, 0.36];
  pillars.forEach((x) => {
    const pillar = mesh(box(0.06, 0.52, 0.06), stoneMat, x, base.top + 0.26, 0);
    group.add(pillar);
    // 柱础
    group.add(mesh(box(0.1, 0.03, 0.1), material('#9a8f7a', { roughness: 0.9 }), x, base.top + 0.015, 0));
  });
  [0, 0.3, 0.58].forEach((y, index) => {
    const width = index === 1 ? 0.9 : 0.94;
    group.add(mesh(box(width, 0.07, 0.1), stoneMat, 0, base.top + y + 0.5 - index * 0.02, 0));
  });
  [-0.245, 0, 0.245].forEach((x, index) => {
    const roof = chineseRoof({
      width: index === 1 ? 0.4 : 0.28,
      height: index === 1 ? 0.11 : 0.085,
      material: roofMat,
      ridgeMaterial: gold,
      layers: 3,
      flare: 1.2,
    });
    roof.position.set(x, base.top + (index === 1 ? 0.94 : 0.84), 0);
    group.add(roof);
  });
  group.add(mesh(box(0.24, 0.09, 0.04), plaqueMat, 0, base.top + 0.72, 0.06));
  group.add(mesh(box(0.2, 0.05, 0.02), gold, 0, base.top + 0.72, 0.085));
  // 石狮
  [-0.46, 0.46].forEach((x) => {
    group.add(mesh(box(0.07, 0.09, 0.07), material('#b9ae98', { roughness: 0.88 }), x, base.top + 0.045, 0.12));
    group.add(mesh(sphere(0.035, 12), material('#b9ae98', { roughness: 0.88 }), x, base.top + 0.11, 0.12));
  });
  group.add(lampRow({ count: 4, width: 0.6, y: base.top + 0.44, z: 0.08, material: gold }));
  return applyProps(group, config.props, config);
}

/** 教堂立面：澳门大三巴牌坊 */
function sacredFacade(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const stoneMat = material(palette.stoneColor || '#cfc4ad', {
    roughness: 0.84,
    map: brickTexture(palette.stoneColor || '#cfc4ad', '#a89d88'),
  });
  const darkMat = material('#3b3226', { roughness: 0.9 });
  const base = platform({ width: 1.0, depth: 0.6, tiers: 2, material: stoneMat, steps: 5, railing: false });
  group.add(base.group);
  const body = mesh(box(0.72, 0.44, 0.12), stoneMat, 0, base.top + 0.22, 0);
  group.add(body);
  group.add(mesh(box(0.5, 0.26, 0.11), stoneMat, 0, base.top + 0.57, 0));
  group.add(mesh(box(0.3, 0.16, 0.1), stoneMat, 0, base.top + 0.78, 0));
  const gable = mesh(cyl(0.02, 0.2, 0.13, 3), stoneMat, 0, base.top + 0.92, 0);
  gable.rotation.y = Math.PI / 2;
  group.add(gable);
  // 龛与窗
  for (let i = 0; i < 3; i += 1) {
    const niche = mesh(box(0.09, 0.14, 0.03), darkMat, -0.22 + i * 0.22, base.top + 0.24, 0.07);
    group.add(niche);
    const arch = mesh(cyl(0.05, 0.05, 0.02, 12), stoneMat, -0.22 + i * 0.22, base.top + 0.3, 0.08);
    arch.rotation.x = Math.PI / 2;
    group.add(arch);
  }
  for (let i = 0; i < 3; i += 1) {
    group.add(mesh(box(0.07, 0.11, 0.03), darkMat, -0.16 + i * 0.16, base.top + 0.58, 0.06));
  }
  group.add(mesh(box(0.08, 0.1, 0.03), darkMat, 0, base.top + 0.79, 0.06));
  group.add(mesh(box(0.16, 0.22, 0.03), darkMat, 0, base.top + 0.11, 0.07));
  // 柱式与檐口
  [-0.3, -0.1, 0.1, 0.3].forEach((x) => {
    group.add(mesh(cyl(0.012, 0.014, 0.44, 10), stoneMat, x, base.top + 0.22, 0.07));
  });
  [0.44, 0.7, 0.86].forEach((y, index) => {
    group.add(mesh(box(0.78 - index * 0.2, 0.03, 0.14), stoneMat, 0, base.top + y, 0));
  });
  return applyProps(group, config.props, config);
}

/** 骑楼老街：海口 */
function arcadeStreet(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const wallMat = material(palette.wallColor || '#e2d4bb', {
    roughness: 0.82,
    map: brickTexture(palette.wallColor || '#e2d4bb', '#c3b49a'),
  });
  const trimMat = material(palette.roofColor || '#8a5a3c', { roughness: 0.7 });
  const darkMat = material('#3b3226', { roughness: 0.9 });
  const glow = material('#f2c879', { emissive: '#a06a14', emissiveIntensity: 1.0 });
  const base = platform({ width: 1.3, depth: 0.6, tiers: 1, material: material('#cbbda3', { roughness: 0.85 }), steps: 2, railing: false });
  group.add(base.group);
  const blocks = 4;
  for (let i = 0; i < blocks; i += 1) {
    const x = -0.45 + i * 0.3;
    const height = 0.32 + (i === 1 ? 0.1 : i === 2 ? 0.05 : 0);
    group.add(mesh(box(0.28, height, 0.3), wallMat, x, base.top + height / 2, 0));
    // 廊柱与拱券
    for (let k = 0; k < 3; k += 1) {
      const cx = x - 0.09 + k * 0.09;
      const arch = mesh(cyl(0.025, 0.025, 0.02, 12), trimMat, cx, base.top + 0.13, 0.16);
      arch.rotation.x = Math.PI / 2;
      group.add(arch);
      group.add(mesh(box(0.05, 0.12, 0.02), darkMat, cx, base.top + 0.07, 0.16));
    }
    // 女儿墙与檐口
    const cornice = chineseRoof({ width: 0.32, height: 0.045, material: trimMat, ridgeMaterial: trimMat, layers: 2, flare: 1.05, ridge: false, corners: false });
    cornice.position.set(x, base.top + height + 0.01, 0);
    group.add(cornice);
    group.add(mesh(box(0.3, 0.03, 0.32), trimMat, x, base.top + height + 0.06, 0));
    // 招牌
    group.add(mesh(box(0.16, 0.05, 0.02), i % 2 ? darkMat : trimMat, x, base.top + 0.2, 0.17));
  }
  group.add(lampRow({ count: 9, width: 1.0, y: base.top + 0.26, z: 0.18, material: glow }));
  return applyProps(group, config.props, config);
}

/** 藏式金顶寺院：西宁塔尔寺 */
function templeGolden(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const whiteMat = material(palette.wallColor || '#f0e9da', {
    roughness: 0.78,
    map: brickTexture(palette.wallColor || '#f0e9da', '#d8cfba'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#e0b23c');
  const redMat = material('#8f3a2c', { roughness: 0.66 });
  const gold = goldMaterial();
  const base = platform({ width: 1.1, depth: 0.8, tiers: 2, material: whiteMat, steps: 4 });
  group.add(base.group);
  group.add(mesh(box(0.7, 0.28, 0.46), whiteMat, 0, base.top + 0.14, 0));
  group.add(mesh(box(0.72, 0.05, 0.48), redMat, 0, base.top + 0.29, 0));
  // 藏式窗套
  for (let c = 0; c < 5; c += 1) {
    const x = -0.28 + c * 0.14;
    group.add(mesh(box(0.05, 0.07, 0.02), material('#3b2a1e', { roughness: 0.9 }), x, base.top + 0.14, 0.24));
    group.add(mesh(box(0.062, 0.082, 0.012), redMat, x, base.top + 0.14, 0.235));
  }
  group.add(dougong({ count: 8, radius: 0.38, y: base.top + 0.32, material: redMat, size: 0.026 }));
  const mainRoof = chineseRoof({ width: 0.72, height: 0.14, material: roofMat, ridgeMaterial: gold, layers: 3, flare: 1.18 });
  mainRoof.position.y = base.top + 0.34;
  group.add(mainRoof);
  [-0.22, 0.22].forEach((x) => {
    const rooflet = chineseRoof({ width: 0.28, height: 0.08, material: roofMat, ridgeMaterial: gold, layers: 2, flare: 1.15 });
    rooflet.position.set(x, base.top + 0.44, 0);
    group.add(rooflet);
    group.add(finial({ y: base.top + 0.5, scale: 0.7, gold }));
  });
  group.add(finial({ y: base.top + 0.48, scale: 0.9, gold }));
  // 转经筒与经幡杆
  for (let i = 0; i < 8; i += 1) {
    const x = -0.44 + i * 0.125;
    group.add(mesh(cyl(0.016, 0.016, 0.06, 10), gold, x, base.top + 0.03, 0.32));
  }
  [-0.5, 0.5].forEach((x) => {
    group.add(mesh(cyl(0.008, 0.008, 0.5, 8), redMat, x, base.top + 0.25, 0.3));
    group.add(mesh(cone(0.02, 0.05, 8), gold, x, base.top + 0.52, 0.3));
  });
  group.add(applyProps(new THREE.Group(), ['flags'], config));
  return group;
}

/** 崖壁楼阁：敦煌莫高窟九层楼 / 洛阳龙门石窟 */
function cliffTemple(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const rockMat = material(palette.rockColor || '#a8916f', {
    roughness: 0.96,
    map: brickTexture(palette.rockColor || '#a8916f', '#8a755a'),
  });
  const woodMat = material(palette.woodColor || '#8a3a2c', {
    roughness: 0.68,
    map: latticeTexture(palette.woodColor || '#8a3a2c'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#7a8f4a');
  const gold = goldMaterial();
  const levels = config.levels || 5;
  const cliff = mesh(box(1.2, 0.9, 0.4), rockMat, 0, 0.45, -0.04);
  group.add(cliff);
  // 崖顶
  const top = mesh(cone(0.7, 0.16, 6), rockMat, 0.06, 0.94, -0.06);
  top.scale.set(1.3, 1, 0.9);
  group.add(top);
  let y = 0.12;
  for (let i = 0; i < levels; i += 1) {
    const width = 0.42 - i * 0.02;
    const height = 0.075;
    group.add(mesh(box(width, height * 0.7, 0.16), woodMat, 0.08, y + height * 0.35, 0.22));
    group.add(
      windowGrid({
        width: width * 0.7,
        height: height * 0.34,
        cols: 4,
        rows: 1,
        y: y + height * 0.12,
        z: 0.3,
        frameMaterial: woodMat,
        paneMaterial: material('#f2c879', { emissive: '#a06a14', emissiveIntensity: 1.1 }),
      }),
    );
    const eave = chineseRoof({
      width: width * 1.5,
      height: height * 0.5,
      material: roofMat,
      ridgeMaterial: gold,
      layers: 2,
      flare: 1.2,
    });
    eave.position.set(0.08, y + height * 0.72, 0.22);
    group.add(eave);
    if (i % 2 === 0) {
      group.add(lampRow({ count: 4, width: width * 0.6, y: y + height * 0.5, z: 0.31, material: gold }));
    }
    y += height;
  }
  return applyProps(group, config.props, config);
}

/** 喀斯特孤峰：桂林 */
function karstHill(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const rockMat = material(palette.rockColor || '#8fa07a', { roughness: 0.96 });
  const cliffMat = material('#6f7f63', { roughness: 0.98 });
  const greenMat = material('#4f7f5a', { roughness: 0.9 });
  const peaks = [
    { x: -0.08, z: -0.05, r: 0.3, h: 0.72, rot: 0.2 },
    { x: 0.34, z: 0.16, r: 0.16, h: 0.44, rot: 0.6 },
    { x: -0.4, z: 0.2, r: 0.18, h: 0.5, rot: 0.9 },
    { x: 0.16, z: -0.3, r: 0.2, h: 0.58, rot: 0.35 },
    { x: -0.3, z: -0.3, r: 0.13, h: 0.36, rot: 0.75 },
  ];
  peaks.forEach((peak, index) => {
    const hill = mesh(cone(peak.r, peak.h, 9), index % 2 ? cliffMat : rockMat, peak.x, peak.h / 2, peak.z);
    hill.rotation.y = Math.PI * peak.rot;
    hill.scale.set(1.06, 1, 0.94);
    group.add(hill);
    // 山腰植被
    for (let k = 0; k < 3; k += 1) {
      const angle = (k / 3) * Math.PI * 2 + peak.rot;
      group.add(
        mesh(cone(0.02, 0.06, 6), greenMat, peak.x + Math.cos(angle) * peak.r * 0.5, peak.h * 0.28 + k * 0.05, peak.z + Math.sin(angle) * peak.r * 0.5),
      );
    }
  });
  return applyProps(group, config.props, config);
}

/** 双塔：太原永祚寺双塔 / 郑州二七塔 */
function twinPagoda(config = {}) {
  const group = new THREE.Group();
  const palette = paletteOf(config);
  const bodyMat = material(palette.bodyColor || '#c6b393', {
    roughness: 0.78,
    map: brickTexture(palette.bodyColor || '#c6b393', '#a8977a'),
  });
  const roofMat = roofMaterial(palette.roofColor || '#8f3a2c');
  const stoneMat = material('#ded3bd', { roughness: 0.8 });
  const woodMat = material('#8f3a2c', { roughness: 0.6 });
  const gold = goldMaterial();
  const linked = Boolean(config.linked);
  const offset = linked ? 0.17 : 0.26;
  const tiers = config.tiers || 13;
  const total = config.height || 0.78;
  const tierHeight = total / tiers;
  const base = platform({ width: linked ? 0.7 : 1.15, depth: 0.7, tiers: 2, material: stoneMat, steps: 3, railing: !linked });
  group.add(base.group);
  [-offset, offset].forEach((x) => {
    let y = base.top;
    for (let i = 0; i < tiers; i += 1) {
      const shrink = 1 - (i / tiers) * 0.5;
      const radius = (linked ? 0.12 : 0.13) * shrink;
      const height = tierHeight * 0.62;
      const shaft = mesh(cyl(radius, radius * 1.05, height, linked ? 4 : 12), bodyMat, x, y + height / 2, 0);
      if (linked) shaft.rotation.y = Math.PI / 4;
      group.add(shaft);
      if (i % 3 === 0) {
        group.add(
          windowGrid({
            width: radius * 1.6,
            height: height * 0.45,
            cols: 2,
            rows: 1,
            y: y + height * 0.2,
            z: radius * 1.05,
            frameMaterial: woodMat,
            paneMaterial: material('#3b2a1e', { roughness: 0.9 }),
          }),
        );
      }
      group.add(dougong({ count: 4, radius: radius * 1.1, y: y + height, material: woodMat, size: 0.02 }));
      const roof = chineseRoof({
        width: radius * 2.6,
        height: tierHeight * 0.42,
        material: roofMat,
        ridgeMaterial: stoneMat,
        layers: 3,
        flare: 1.08,
        corners: i >= tiers - 2,
      });
      roof.position.y = y + height + tierHeight * 0.06;
      group.add(roof);
      y += tierHeight;
    }
    group.add(finial({ y: y - 0.01, scale: 0.85, gold }));
  });
  if (linked) {
    group.add(mesh(box(offset * 2 + 0.1, 0.05, 0.16), bodyMat, 0, base.top + 0.42, 0));
    group.add(mesh(box(offset * 2 + 0.16, 0.02, 0.2), stoneMat, 0, base.top + 0.46, 0));
  }
  return applyProps(group, config.props, config);
}

export const CN_LANDMARK_BUILDERS = {
  pagoda,
  tower_pavilion: towerPavilion,
  city_gate: cityGate,
  palace_pavilion: palacePavilion,
  dome_temple: domeTemple,
  yurt_temple: yurtTemple,
  skyline,
  stacked_tower: stackedTower,
  arch_bridge: archBridge,
  ferris_wheel: ferrisWheel,
  stilt_house: stiltHouse,
  potala,
  archway,
  sacred_facade: sacredFacade,
  arcade_street: arcadeStreet,
  temple_golden: templeGolden,
  cliff_temple: cliffTemple,
  karst_hill: karstHill,
  twin_pagoda: twinPagoda,
};
