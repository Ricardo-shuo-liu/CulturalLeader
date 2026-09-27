// 地标构建的公共零件库：中国式屋顶、斗拱、台基、窗格、水面、山体、沙丘、驼队……
// 目标是「同一原型 + 不同专属部件」也能一眼分辨城市，而不是只换配色。

import * as THREE from 'three';

export const mesh = (geometry, material, x = 0, y = 0, z = 0) => {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  return item;
};

export const box = (w, h, d, material) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 24, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r, h, seg = 16) => new THREE.ConeGeometry(r, h, seg);
export const sphere = (r, seg = 20) => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.7)));
export const torus = (r, tube, seg = 8, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, seg, Math.round(seg * 6), arc);

/**
 * 中国式反宇屋顶：用多段四棱台叠出「檐口外张、屋面内凹」的曲线，
 * 带正脊、鸱吻与四角起翘，比单个圆锥更像真屋顶。
 */
export function chineseRoof({
  width = 0.4,
  height = 0.12,
  material,
  ridgeMaterial = material,
  layers = 3,
  ridge = true,
  corners = true,
  flare = 1.0,
} = {}) {
  const group = new THREE.Group();
  for (let i = 0; i < layers; i += 1) {
    const t = i / Math.max(1, layers - 1);
    const bottom = width * (0.58 + t * 0.44) * flare;
    const top = width * (0.2 + t * 0.34) * flare;
    const segmentHeight = (height / layers) * 1.18;
    const segment = mesh(cyl(top, bottom, segmentHeight, 4, true), material);
    segment.rotation.y = Math.PI / 4;
    segment.position.y = height - (i + 0.5) * (height / layers);
    group.add(segment);
    // 檐口一圈瓦当
    const rim = mesh(cyl(bottom * 1.02, bottom * 1.02, 0.008, 4), material);
    rim.rotation.y = Math.PI / 4;
    rim.position.y = height - i * (height / layers) - 0.004;
    group.add(rim);
  }
  if (ridge) {
    const beam = mesh(box(width * 0.78, 0.022, 0.05), ridgeMaterial, 0, height + 0.012, 0);
    group.add(beam);
    [-1, 1].forEach((side) => {
      const owl = mesh(box(0.035, 0.06, 0.045), ridgeMaterial, (side * width * 0.78) / 2, height + 0.03, 0);
      owl.rotation.z = side * 0.22;
      group.add(owl);
    });
  }
  if (corners) {
    [-1, 1].forEach((sx) => {
      [-1, 1].forEach((sz) => {
        const tip = mesh(cone(0.018, 0.06, 5), ridgeMaterial, (sx * width * 0.5) * 1.02, height - 0.02, (sz * width * 0.5) * 1.02);
        tip.rotation.set(sz * 0.5, 0, -sx * 0.5);
        group.add(tip);
      });
    });
  }
  return group;
}

/** 斗拱：檐下那一圈层层出挑的木构件，是中式建筑最好认的细节。 */
export function dougong({ count = 8, radius = 0.26, y = 0, material, size = 0.05 }) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const bracket = mesh(box(size, size * 0.5, size), material, Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    bracket.rotation.y = -angle;
    group.add(bracket);
    const arm = mesh(box(size * 1.5, size * 0.32, size * 0.5), material, Math.cos(angle) * (radius + size * 0.5), y + size * 0.35, Math.sin(angle) * (radius + size * 0.5));
    arm.rotation.y = -angle;
    group.add(arm);
  }
  return group;
}

/** 台基：多层须弥座 + 台阶 + 栏杆柱。 */
export function platform({ width = 0.9, depth = 0.7, tiers = 2, material, railing = true, steps = 3 } = {}) {
  const group = new THREE.Group();
  let y = 0;
  for (let i = 0; i < tiers; i += 1) {
    const shrink = 1 - i * 0.12;
    const height = 0.045;
    const slab = mesh(box(width * shrink, height, depth * shrink), material, 0, y + height / 2, 0);
    group.add(slab);
    if (railing) {
      const postCount = Math.max(6, Math.round(width * 14));
      for (let k = 0; k < postCount; k += 1) {
        const x = -width * shrink * 0.46 + (k / (postCount - 1)) * width * shrink * 0.92;
        group.add(mesh(box(0.012, 0.03, 0.012), material, x, y + height + 0.015, depth * shrink * 0.48));
        group.add(mesh(box(0.012, 0.03, 0.012), material, x, y + height + 0.015, -depth * shrink * 0.48));
      }
    }
    y += height;
  }
  for (let i = 0; i < steps; i += 1) {
    group.add(mesh(box(width * 0.3, 0.016, 0.05), material, 0, 0.02 + i * 0.016, depth / 2 + 0.04 + i * 0.055));
  }
  return { group, top: y };
}

/** 窗格 / 门：给墙面加上真的开洞感（深色内凹 + 木框）。 */
export function windowGrid({ width = 0.4, height = 0.16, cols = 4, rows = 1, y = 0, z = 0, frameMaterial, paneMaterial }) {
  const group = new THREE.Group();
  const cellW = width / cols;
  const cellH = height / rows;
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const pane = mesh(box(cellW * 0.72, cellH * 0.72, 0.012), paneMaterial, -width / 2 + cellW * (c + 0.5), y + cellH * (r + 0.5), z);
      group.add(pane);
    }
  }
  const frame = mesh(box(width + 0.02, height + 0.02, 0.008), frameMaterial, 0, y + height / 2, z - 0.006);
  group.add(frame);
  return group;
}

/** 一排灯笼 / 窗光，夜里会亮。 */
export function lampRow({ count = 6, width = 0.5, y = 0, z = 0, material }) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const x = count === 1 ? 0 : -width / 2 + (i / (count - 1)) * width;
    const lamp = mesh(sphere(0.014, 10), material, x, y + (i % 2) * 0.012, z);
    group.add(lamp);
    group.add(mesh(cyl(0.003, 0.003, 0.02, 6), material, x, y + 0.022, z));
  }
  return group;
}

/** 一排树（锥形树冠 + 树干）。 */
export function treeRow({ count = 4, spread = 0.5, y = 0, z = 0, material, trunkMaterial, scale = 1 } = {}) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = -spread / 2 + t * spread;
    const size = scale * (0.7 + ((i * 37) % 10) / 24);
    const trunk = mesh(cyl(0.008, 0.01, 0.05 * size, 6), trunkMaterial, x, y + 0.025 * size, z);
    group.add(trunk);
    const crown = mesh(cone(0.045 * size, 0.13 * size, 7), material, x, y + 0.1 * size, z);
    group.add(crown);
  }
  return group;
}

export function waterDisc({ radius = 0.6, y = 0.012, material }) {
  const disc = mesh(cyl(radius, radius, 0.02, 44), material, 0, y, 0);
  return disc;
}

/** 山体：几个错落的山峰叠在一起，比单个圆锥自然。 */
export function mountainCluster({ radius = 0.5, height = 0.4, material, count = 4, seed = 3 } = {}) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const angle = ((i * 2.399) % (Math.PI * 2)) * 0.6;
    const spread = radius * (i === 0 ? 0 : 0.42 + ((i * seed) % 3) * 0.12);
    const scale = i === 0 ? 1 : 0.55 + ((i * 7) % 5) / 12;
    const peak = mesh(cone(radius * 0.5 * scale, height * scale, 7), material, Math.cos(angle) * spread, (height * scale) / 2, Math.sin(angle) * spread);
    peak.rotation.y = angle;
    group.add(peak);
  }
  return group;
}

export function dune({ radius = 0.5, height = 0.16, material, count = 3 }) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + 0.5;
    const ridge = mesh(cone(radius * (0.7 - i * 0.14), height * (1 - i * 0.18), 5), material, Math.cos(angle) * radius * 0.5, (height * (1 - i * 0.18)) / 2, Math.sin(angle) * radius * 0.45);
    ridge.rotation.y = angle;
    ridge.scale.set(1.8, 1, 0.7);
    group.add(ridge);
  }
  return group;
}

/** 经幡串：藏地场景一眼认出的元素。 */
export function prayerFlags({ count = 8, width = 0.6, y = 0.3, material }) {
  const group = new THREE.Group();
  const colors = ['#d8534f', '#e0b23c', '#4f8f6a', '#4f7f9c', '#f0e6d2'];
  for (let i = 0; i < count; i += 1) {
    const x = -width / 2 + (i / (count - 1)) * width;
    const flag = mesh(box(0.03, 0.045, 0.004), material || new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.8 }), x, y - Math.sin((i / count) * Math.PI) * 0.05, 0);
    group.add(flag);
  }
  const line = mesh(box(width, 0.004, 0.004), new THREE.MeshStandardMaterial({ color: '#6b5b45', roughness: 0.9 }), 0, y, 0);
  group.add(line);
  return group;
}

export function boat({ scale = 1, material, sailMaterial } = {}) {
  const group = new THREE.Group();
  group.add(mesh(box(0.12 * scale, 0.02 * scale, 0.04 * scale), material, 0, 0.012, 0));
  const sail = mesh(cone(0.03 * scale, 0.1 * scale, 4), sailMaterial, 0.01, 0.07 * scale, 0);
  group.add(sail);
  return group;
}

export function ferry({ material, windowMaterial } = {}) {
  const group = new THREE.Group();
  group.add(mesh(box(0.2, 0.03, 0.06), material, 0, 0.02, 0));
  group.add(mesh(box(0.14, 0.03, 0.05), windowMaterial, 0, 0.05, 0));
  group.add(mesh(cyl(0.006, 0.006, 0.05, 6), material, -0.05, 0.08, 0));
  return group;
}

export function camel({ material } = {}) {
  const group = new THREE.Group();
  group.add(mesh(sphere(0.025, 12), material, 0, 0.03, 0));
  group.add(mesh(sphere(0.018, 10), material, 0.03, 0.055, 0));
  group.add(mesh(box(0.01, 0.04, 0.01), material, -0.015, 0.01, 0.012));
  group.add(mesh(box(0.01, 0.04, 0.01), material, 0.015, 0.01, -0.012));
  return group;
}

export function yak({ material } = {}) {
  const group = new THREE.Group();
  group.add(mesh(sphere(0.03, 12), material, 0, 0.032, 0));
  group.add(mesh(sphere(0.018, 10), material, 0.036, 0.05, 0));
  group.add(mesh(box(0.05, 0.012, 0.012), material, -0.01, 0.06, 0));
  return group;
}

/** 月洞门（园林）。 */
export function moonGate({ radius = 0.11, thickness = 0.03, material } = {}) {
  const group = new THREE.Group();
  const ring = mesh(torus(radius, thickness * 0.4, 8), material);
  group.add(ring);
  group.add(mesh(box(radius * 2.2, thickness, 0.02), material, 0, -radius - thickness * 0.4, 0));
  return group;
}

/** 石拱小桥。 */
export function stoneBridge({ span = 0.4, material } = {}) {
  const group = new THREE.Group();
  const arch = mesh(torus(span * 0.4, 0.02, 8, Math.PI), material, 0, span * 0.32, 0);
  group.add(arch);
  group.add(mesh(box(span, 0.02, 0.06), material, 0, span * 0.32 + 0.01, 0));
  return group;
}

/** 中式灯笼柱（一到两根，用于城门/楼阁前）。 */
export function lanternPole({ height = 0.3, material, glowMaterial } = {}) {
  const group = new THREE.Group();
  group.add(mesh(cyl(0.006, 0.006, height, 6), material, 0, height / 2, 0));
  group.add(mesh(sphere(0.022, 12), glowMaterial, 0, height + 0.012, 0));
  return group;
}

/** 檐铃：挂在屋檐四角的小铜铃，是中式楼阁最容易加分的细节。 */
export function eaveBells({ count = 4, radius = 0.3, y = 0, material }) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    group.add(mesh(cyl(0.0022, 0.0022, 0.03, 6), material, x, y - 0.015, z));
    const bell = mesh(cone(0.014, 0.026, 10), material, x, y - 0.042, z);
    bell.rotation.x = Math.PI;
    group.add(bell);
  }
  return group;
}

/** 脊兽：正脊两端的小兽，宫殿与城门楼上都有。 */
export function ridgeBeasts({ width = 0.4, y = 0, material, count = 2 }) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const side = count === 1 ? 1 : i * 2 - 1;
    const beast = mesh(box(0.026, 0.032, 0.022), material, (side * width) / 2, y + 0.016, 0);
    beast.rotation.z = side * 0.3;
    group.add(beast);
    group.add(mesh(cone(0.008, 0.026, 6), material, (side * width) / 2 + side * 0.012, y + 0.03, 0));
  }
  return group;
}

/** 门钉板门：城门口那种钉着门钉的厚木门。 */
export function studdedDoor({ width = 0.16, height = 0.2, y = 0, z = 0, material, studMaterial, rows = 4, cols = 3 }) {
  const group = new THREE.Group();
  group.add(mesh(box(width, height, 0.018), material, 0, y + height / 2, z));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = -width / 2 + (width / cols) * (c + 0.5);
      const yy = y + (height / rows) * (r + 0.5);
      group.add(mesh(sphere(0.006, 8), studMaterial, x, yy, z + 0.012));
    }
  }
  group.add(mesh(cyl(0.014, 0.014, 0.008, 12), studMaterial, 0, y + height * 0.5, z + 0.014));
  return group;
}

/** 平座栏杆：塔身每层的回廊栏杆。 */
export function balustrade({ width = 0.4, y = 0, z = 0, material, posts = 8 }) {
  const group = new THREE.Group();
  for (let i = 0; i < posts; i += 1) {
    const x = -width / 2 + (width / (posts - 1)) * i;
    group.add(mesh(box(0.01, 0.028, 0.01), material, x, y + 0.014, z));
  }
  group.add(mesh(box(width, 0.008, 0.012), material, 0, y + 0.03, z));
  group.add(mesh(box(width, 0.008, 0.012), material, 0, y + 0.008, z));
  return group;
}

/** 格窗：带竖棂与横棂的木格窗（比一块深色板更像窗户）。 */
export function latticeWindow({ width = 0.2, height = 0.1, y = 0, z = 0, cols = 3, rows = 2, frameMaterial, paneMaterial }) {
  const group = new THREE.Group();
  group.add(mesh(box(width, height, 0.012), frameMaterial, 0, y + height / 2, z));
  group.add(mesh(box(width * 0.86, height * 0.82, 0.006), paneMaterial, 0, y + height / 2, z + 0.006));
  for (let c = 1; c < cols; c += 1) {
    const x = -width / 2 + (width / cols) * c;
    group.add(mesh(box(0.005, height * 0.86, 0.008), frameMaterial, x, y + height / 2, z + 0.008));
  }
  for (let r = 1; r < rows; r += 1) {
    const yy = y + (height / rows) * r;
    group.add(mesh(box(width * 0.88, 0.005, 0.008), frameMaterial, 0, yy, z + 0.008));
  }
  return group;
}

/** 檐口瓦当：沿檐口排一圈小圆瓦，近看立刻有质感。 */
export function eaveTiles({ width = 0.4, y = 0, z = 0, count = 12, material }) {
  const group = new THREE.Group();
  for (let i = 0; i < count; i += 1) {
    const x = -width / 2 + (width / (count - 1)) * i;
    const tile = mesh(cyl(0.007, 0.007, 0.006, 8), material, x, y, z);
    tile.rotation.x = Math.PI / 2;
    group.add(tile);
  }
  return group;
}

/** 匾额：深色底板 + 金边，挂在门楣上，是中式建筑最好认的细节之一。 */
export function plaque({ width = 0.2, height = 0.06, y = 0, z = 0, material, trimMaterial }) {
  const group = new THREE.Group();
  group.add(mesh(box(width, height, 0.012), material, 0, y + height / 2, z));
  group.add(mesh(box(width * 1.08, height * 0.12, 0.014), trimMaterial, 0, y + height * 0.94, z + 0.002));
  group.add(mesh(box(width * 1.08, height * 0.12, 0.014), trimMaterial, 0, y + height * 0.06, z + 0.002));
  for (let i = 1; i < 4; i += 1) {
    group.add(mesh(box(width * 0.08, height * 0.62, 0.014), trimMaterial, -width / 2 + (width / 4) * i, y + height / 2, z + 0.003));
  }
  return group;
}

/** 屋面瓦垄：沿屋面坡度排几道瓦线，近看立刻有瓦作质感。 */
export function roofTiles({ width = 0.4, height = 0.12, y = 0, z = 0, rows = 3, material }) {
  const group = new THREE.Group();
  for (let r = 0; r < rows; r += 1) {
    const t = (r + 1) / (rows + 1);
    const line = mesh(box(width * (1 - t * 0.42), 0.006, 0.01), material, 0, y + height * t, z - t * height * 0.35);
    group.add(line);
  }
  for (let c = -2; c <= 2; c += 1) {
    const ridge = mesh(box(0.012, height * 0.9, 0.012), material, (c * width) / 5, y + height * 0.5, z - height * 0.18);
    group.add(ridge);
  }
  return group;
}

/** 院墙 + 山门：把单体放进一个院子里，看起来不再是孤零零一座房子。 */
export function courtyard({ width = 1.4, depth = 1.1, wallMaterial, roofMaterial, height = 0.09 }) {
  const group = new THREE.Group();
  const halfW = width / 2;
  const halfD = depth / 2;
  const segments = [
    { w: width, d: 0.04, x: 0, z: -halfD },
    { w: 0.04, d: depth, x: -halfW, z: 0 },
    { w: 0.04, d: depth, x: halfW, z: 0 },
    { w: width * 0.36, d: 0.04, x: -halfW * 0.6, z: halfD },
    { w: width * 0.36, d: 0.04, x: halfW * 0.6, z: halfD },
  ];
  segments.forEach((segment) => {
    group.add(mesh(box(segment.w, height, segment.d), wallMaterial, segment.x, height / 2, segment.z));
    const cap = mesh(box(segment.w * 1.06, 0.012, segment.d * 1.6), roofMaterial, segment.x, height + 0.006, segment.z);
    group.add(cap);
  });
  // 山门
  group.add(mesh(box(0.2, height * 1.9, 0.06), wallMaterial, 0, height * 0.95, halfD));
  group.add(mesh(box(0.1, height * 1.2, 0.02), new THREE.MeshStandardMaterial({ color: '#2b2018', roughness: 0.9 }), 0, height * 0.6, halfD + 0.04));
  const gateRoof = chineseRoof({ width: 0.34, height: 0.07, material: roofMaterial, ridgeMaterial: roofMaterial, layers: 2, flare: 1.2 });
  gateRoof.position.set(0, height * 1.9, halfD);
  group.add(gateRoof);
  return group;
}

/** 按城市配置往地标上叠加专属部件，让同一原型也能区分开。 */
export function applyProps(group, props = [], config = {}) {
  if (!props.length) return group;
  const palette = config.palette || {};
  const dark = new THREE.MeshStandardMaterial({ color: '#3b3226', roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ color: palette.stoneColor || '#cfc4ad', roughness: 0.82 });
  const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 0.75 });
  const green = new THREE.MeshStandardMaterial({ color: '#4f7f5a', roughness: 0.85 });
  const water = new THREE.MeshStandardMaterial({ color: '#2f6f86', roughness: 0.25, metalness: 0.35, transparent: true, opacity: 0.9 });
  const sand = new THREE.MeshStandardMaterial({ color: '#d9c08a', roughness: 0.95 });
  const rock = new THREE.MeshStandardMaterial({ color: palette.rockColor || '#8b7f6d', roughness: 0.95 });
  const glow = new THREE.MeshStandardMaterial({ color: '#f2c879', emissive: '#a06a14', emissiveIntensity: 1.1 });

  props.forEach((prop) => {
    switch (prop) {
      case 'water': {
        const disc = waterDisc({ radius: 0.66, material: water });
        group.add(disc);
        break;
      }
      case 'river': {
        const river = mesh(box(1.3, 0.02, 0.34), water, 0, 0.01, 0.2);
        group.add(river);
        break;
      }
      case 'lake': {
        group.add(waterDisc({ radius: 0.7, material: water }));
        group.add(mesh(box(0.5, 0.014, 0.06), stone, 0.1, 0.02, 0.28));
        break;
      }
      case 'pond': {
        group.add(mesh(cyl(0.3, 0.3, 0.016, 32), water, 0.26, 0.012, 0.2));
        break;
      }
      case 'bridge': {
        const bridge = stoneBridge({ span: 0.44, material: stone });
        bridge.position.set(0.06, 0.005, 0.26);
        group.add(bridge);
        break;
      }
      case 'boat': {
        const littleBoat = boat({ material: wood, sailMaterial: new THREE.MeshStandardMaterial({ color: '#f0e6d2', roughness: 0.7 }) });
        littleBoat.position.set(0.3, 0.02, 0.34);
        group.add(littleBoat);
        break;
      }
      case 'ferry': {
        const ship = ferry({ material: new THREE.MeshStandardMaterial({ color: '#d9d2c4', roughness: 0.5 }), windowMaterial: glow });
        ship.position.set(-0.32, 0.02, 0.34);
        group.add(ship);
        break;
      }
      case 'courtyard': {
        const yard = courtyard({
          width: config.courtyardWidth || 1.5,
          depth: config.courtyardDepth || 1.15,
          wallMaterial: stone,
          roofMaterial: new THREE.MeshStandardMaterial({ color: palette.roofColor || '#8f3a2c', roughness: 0.6 }),
        });
        group.add(yard);
        break;
      }
      case 'trees': {
        const trees = treeRow({ count: 5, spread: 0.8, y: 0.02, z: 0.3, material: green, trunkMaterial: wood, scale: 1.1 });
        group.add(trees);
        break;
      }
      case 'garden': {
        const trees = treeRow({ count: 4, spread: 0.5, y: 0.02, z: 0.26, material: green, trunkMaterial: wood, scale: 0.9 });
        group.add(trees);
        const gate = moonGate({ radius: 0.1, material: stone });
        gate.position.set(-0.3, 0.13, 0.24);
        group.add(gate);
        break;
      }
      case 'mountains': {
        const range = mountainCluster({ radius: 1.0, height: 0.34, material: rock, count: 4 });
        range.position.set(0, 0, -0.42);
        group.add(range);
        break;
      }
      case 'snow': {
        const cap = mesh(cone(0.16, 0.12, 7), new THREE.MeshStandardMaterial({ color: '#eef2f4', roughness: 0.7 }), -0.36, 0.3, -0.3);
        group.add(cap);
        break;
      }
      case 'dune': {
        const hills = dune({ radius: 0.6, height: 0.2, material: sand, count: 3 });
        hills.position.set(0, 0, -0.4);
        group.add(hills);
        break;
      }
      case 'camel': {
        const animal = camel({ material: new THREE.MeshStandardMaterial({ color: '#b98a56', roughness: 0.9 }) });
        animal.position.set(0.34, 0.01, 0.3);
        animal.scale.setScalar(1.3);
        group.add(animal);
        break;
      }
      case 'yak': {
        const animal = yak({ material: new THREE.MeshStandardMaterial({ color: '#4a3a2c', roughness: 0.9 }) });
        animal.position.set(-0.34, 0.01, 0.3);
        group.add(animal);
        break;
      }
      case 'flags': {
        const flags = prayerFlags({ count: 10, width: 0.8, y: 0.42 });
        flags.position.set(0, 0, 0.22);
        group.add(flags);
        break;
      }
      case 'buddha': {
        const niche = mesh(cyl(0.09, 0.09, 0.018, 20, false), dark, 0.28, 0.2, 0.19);
        niche.rotation.x = Math.PI / 2;
        group.add(niche);
        const statue = mesh(cone(0.04, 0.13, 12), new THREE.MeshStandardMaterial({ color: '#d9c9a3', roughness: 0.8 }), 0.28, 0.2, 0.22);
        group.add(statue);
        const halo = mesh(torus(0.05, 0.006, 8), glow, 0.28, 0.24, 0.2);
        group.add(halo);
        break;
      }
      case 'caves': {
        for (let i = 0; i < 7; i += 1) {
          const hole = mesh(cyl(0.025, 0.025, 0.014, 12), dark, -0.4 + i * 0.12, 0.18 + (i % 3) * 0.12, 0.19);
          hole.rotation.x = Math.PI / 2;
          group.add(hole);
        }
        break;
      }
      case 'lamps': {
        const lamps = lampRow({ count: 7, width: 0.62, y: 0.14, z: 0.26, material: glow });
        group.add(lamps);
        break;
      }
      case 'poles': {
        [-0.34, 0.34].forEach((x) => {
          const pole = lanternPole({ height: 0.34, material: dark, glowMaterial: glow });
          pole.position.set(x, 0.02, 0.26);
          group.add(pole);
        });
        break;
      }
      case 'wall': {
        const wallLeft = mesh(box(0.5, 0.2, 0.14), stone, -0.6, 0.1, 0.14);
        const wallRight = mesh(box(0.5, 0.2, 0.14), stone, 0.6, 0.1, 0.14);
        group.add(wallLeft, wallRight);
        break;
      }
      case 'harbour': {
        const water2 = mesh(box(1.4, 0.02, 0.5), water, 0, 0.01, 0.42);
        group.add(water2);
        const pier = mesh(box(1.1, 0.02, 0.08), stone, 0, 0.03, 0.3);
        group.add(pier);
        break;
      }
      case 'spring': {
        group.add(mesh(cyl(0.2, 0.22, 0.04, 28), stone, -0.32, 0.03, 0.3));
        for (let i = 0; i < 3; i += 1) {
          group.add(mesh(cyl(0.014, 0.014, 0.08, 8), water, -0.38 + i * 0.06, 0.08, 0.3));
        }
        break;
      }
      default:
        break;
    }
  });
  return group;
}
