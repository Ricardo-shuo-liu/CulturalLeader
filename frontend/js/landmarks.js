// 程序化地标：用基础几何体 + 程序化贴图拼出可辨认且细节丰富的城市地标。

import * as THREE from 'three';
import { PALETTE } from './config.js';

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: options.roughness ?? 0.62,
    metalness: options.metalness ?? 0.08,
    emissive: new THREE.Color(options.emissive || '#000000'),
    emissiveIntensity: options.emissiveIntensity ?? 0,
    side: options.side || THREE.FrontSide,
    map: options.map || null,
  });
}

/** 程序化贴图工具：瓦垄、砖纹、窗棂、彩画额枋、幕墙网格。 */
function canvasTexture(width, height, draw, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  return texture;
}

function tileTexture(base = '#2f5c9c', dark = '#1d3c69') {
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 3;
      for (let x = 0; x <= w; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1.6;
      for (let x = 4; x <= w; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    },
    [26, 3],
  );
}

function brickTexture(base = '#8a6a52', line = '#6d5140') {
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      for (let y = 0; y <= h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        const offset = (y / 16) % 2 === 0 ? 0 : 16;
        for (let x = offset; x <= w; x += 32) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + 16);
          ctx.stroke();
        }
      }
    },
    [4, 2],
  );
}

function latticeTexture(base = '#8f2f26', line = '#f0dfae') {
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 3;
      for (let i = 0; i <= 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo((i * w) / 4, 0);
        ctx.lineTo((i * w) / 4, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, (i * h) / 4);
        ctx.lineTo(w, (i * h) / 4);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(240, 223, 174, 0.55)';
      ctx.lineWidth = 2;
      for (let x = 0; x <= w; x += 16) {
        for (let y = 0; y <= h; y += 16) {
          ctx.beginPath();
          ctx.arc(x, y, 21, 0, Math.PI / 2);
          ctx.stroke();
        }
      }
    },
    [2, 1],
  );
}

function beamTexture() {
  return canvasTexture(
    256,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#1f5c57';
      ctx.fillRect(0, 0, w, h);
      const colors = ['#e8dcc3', '#c9a227', '#9e3b2e'];
      for (let band = 0; band < 3; band += 1) {
        ctx.fillStyle = colors[band];
        ctx.fillRect(0, 6 + band * 18, w, 5);
      }
      ctx.strokeStyle = '#e8dcc3';
      ctx.lineWidth = 4;
      for (let x = 8; x < w; x += 32) {
        ctx.beginPath();
        ctx.arc(x, h / 2, 9, Math.PI * 0.2, Math.PI * 1.3);
        ctx.stroke();
      }
    },
    [3, 1],
  );
}

function curtainWallTexture(base = '#b9c6cf', line = '#7d8b96') {
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      for (let x = 0; x <= w; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 233, 176, 0.35)';
      for (let x = 4; x < w; x += 16) {
        for (let y = 4; y < h; y += 16) {
          ctx.fillRect(x, y, 8, 8);
        }
      }
    },
    [6, 6],
  );
}

function pillarRing(group, count, radius, height, mat, y = 0, thickness = 0.012) {
  const geometry = new THREE.CylinderGeometry(thickness, thickness, height, 10);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const pillar = new THREE.Mesh(geometry, mat);
    pillar.position.set(Math.cos(angle) * radius, y + height / 2, Math.sin(angle) * radius);
    group.add(pillar);
  }
}

function railingRing(group, count, radius, y, mat) {
  const post = new THREE.CylinderGeometry(0.006, 0.006, 0.035, 8);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const mesh = new THREE.Mesh(post, mat);
    mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    group.add(mesh);
  }
}

// ───────────────────────── 北京 · 天坛祈年殿 ─────────────────────────
function tiantan() {
  const group = new THREE.Group();
  const marble = material('#e6dcc7', { roughness: 0.72 });
  const red = material('#9e3b2e', { roughness: 0.55 });
  const roof = material('#2f5c9c', { roughness: 0.4, metalness: 0.14, map: tileTexture() });
  const roofPlain = material('#2b5490', { roughness: 0.42, metalness: 0.12 });
  const gold = material('#d9a648', { metalness: 0.62, roughness: 0.3, emissive: '#3a2a08', emissiveIntensity: 0.7 });
  const windows = material('#8f2f26', { roughness: 0.6, map: latticeTexture(), emissive: '#2a0d08', emissiveIntensity: 0.35 });

  const terraces = [
    { r: 0.64, h: 0.05, y: 0.025 },
    { r: 0.55, h: 0.05, y: 0.075 },
    { r: 0.46, h: 0.05, y: 0.125 },
  ];
  terraces.forEach((tier, index) => {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(tier.r, tier.r + 0.02, tier.h, 64), marble);
    base.position.y = tier.y;
    group.add(base);
    railingRing(group, 48 - index * 6, tier.r - 0.012, tier.y + tier.h / 2 + 0.02, marble);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(tier.r - 0.012, 0.004, 6, 64), marble);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = tier.y + tier.h / 2 + 0.035;
    group.add(rail);
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.31, 0.22, 40), windows);
  body.position.y = 0.26;
  group.add(body);
  pillarRing(group, 12, 0.3, 0.24, red, 0.15, 0.014);

  const eaves = [
    { r: 0.54, y: 0.4, h: 0.13 },
    { r: 0.44, y: 0.55, h: 0.12 },
    { r: 0.34, y: 0.68, h: 0.11 },
  ];
  eaves.forEach((eave, index) => {
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(eave.r * 0.34, eave.r, eave.h, 48, 1, true),
      index === 0 ? roof : roofPlain,
    );
    cone.position.y = eave.y;
    group.add(cone);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(eave.r, 0.011, 8, 64), marble);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = eave.y - eave.h / 2;
    group.add(rim);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.05, 6), gold);
      tip.position.set(Math.cos(angle) * eave.r, eave.y - eave.h / 2 + 0.012, Math.sin(angle) * eave.r);
      tip.rotation.set(Math.cos(angle) * 0.9, 0, -Math.sin(angle) * 0.9);
      group.add(tip);
    }
  });

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.055, 28, 20), gold);
  finial.position.y = 0.81;
  group.add(finial);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.075, 12), gold);
  flame.position.y = 0.9;
  group.add(flame);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 8, 24), gold);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.87;
  group.add(collar);

  return group;
}

// ───────────────────────── 上海 · 东方明珠 ─────────────────────────
function pearl() {
  const group = new THREE.Group();
  const steel = material('#cbd8e2', { metalness: 0.6, roughness: 0.28 });
  const sphereMat = material('#d8536a', {
    roughness: 0.3,
    emissive: '#8e1b2e',
    emissiveIntensity: 1.15,
    map: curtainWallTexture('#e07c8d', '#a83b50'),
  });
  const plaza = material('#9fb2bd', { roughness: 0.6, metalness: 0.25 });

  const plazaMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.03, 40), plaza);
  plazaMesh.position.y = 0.015;
  group.add(plazaMesh);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.08, 32), plaza);
  skirt.position.y = 0.07;
  group.add(skirt);

  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const radius = 0.17;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.036, 0.52, 16), steel);
    leg.position.set(Math.cos(angle) * radius * 0.55, 0.28, Math.sin(angle) * radius * 0.55);
    leg.rotation.set(-Math.sin(angle) * 0.16, 0, Math.cos(angle) * 0.16);
    group.add(leg);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.02, 16), plaza);
    pad.position.set(Math.cos(angle) * radius * 0.95, 0.05, Math.sin(angle) * radius * 0.95);
    group.add(pad);
  }

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.055, 1.06, 24), steel);
  shaft.position.y = 0.55;
  group.add(shaft);

  const spheres = [
    { y: 0.42, r: 0.16 },
    { y: 0.68, r: 0.125 },
    { y: 0.9, r: 0.088 },
  ];
  spheres.forEach((item) => {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(item.r, 40, 28), sphereMat);
    sphere.position.y = item.y;
    group.add(sphere);
    const equator = new THREE.Mesh(new THREE.TorusGeometry(item.r * 1.005, 0.005, 6, 48), steel);
    equator.rotation.x = Math.PI / 2;
    equator.position.y = item.y;
    group.add(equator);
    for (let k = -1; k <= 1; k += 1) {
      const bandRadius = Math.sqrt(Math.max(item.r ** 2 - (k * item.r * 0.5) ** 2, 0.0004));
      const band = new THREE.Mesh(new THREE.TorusGeometry(bandRadius * 1.005, 0.0035, 6, 40), steel);
      band.rotation.x = Math.PI / 2;
      band.position.y = item.y + k * item.r * 0.5;
      group.add(band);
    }
  });

  [0.24, 0.55, 0.78, 1.0, 1.1].forEach((y, index) => {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.022 - index * 0.001, 16, 12), steel);
    dot.position.y = y;
    group.add(dot);
  });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.34, 10), steel);
  mast.position.y = 1.28;
  group.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 14, 10),
    material('#ffe9b0', { emissive: '#ff5a4a', emissiveIntensity: 2.0, roughness: 0.3 }),
  );
  beacon.position.y = 1.46;
  group.add(beacon);

  return group;
}

// ───────────────────────── 广州 · 广州塔 ─────────────────────────
function cantonTower() {
  const group = new THREE.Group();
  const shell = material('#bcc9d2', {
    metalness: 0.5,
    roughness: 0.32,
    side: THREE.DoubleSide,
    map: curtainWallTexture('#c3cfd8', '#8e9ba6'),
  });
  const rib = material('#57c08a', { emissive: '#12503a', emissiveIntensity: 0.95, roughness: 0.38 });
  const steel = material('#98a7b3', { metalness: 0.55, roughness: 0.3 });

  const height = 1.18;
  const radiusAt = (t) => 0.105 + 0.27 * ((t - 0.62) / 0.62) ** 2;

  const profile = [];
  for (let i = 0; i <= 44; i += 1) {
    const t = i / 44;
    profile.push(new THREE.Vector2(radiusAt(t), t * height));
  }
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 72), shell));

  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    const points = [];
    for (let j = 0; j <= 26; j += 1) {
      const t = j / 26;
      const r = radiusAt(t) * 1.015;
      const twist = angle + t * 1.25;
      points.push(new THREE.Vector3(Math.cos(twist) * r, t * height, Math.sin(twist) * r));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.0042, 6, false), rib));
  }

  for (let k = 1; k <= 8; k += 1) {
    const t = k / 9;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radiusAt(t) * 1.02, 0.0042, 6, 56), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = t * height;
    group.add(ring);
  }

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.022, 32), steel);
  deck.position.y = height + 0.01;
  group.add(deck);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.005, 6, 40), steel);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = height + 0.026;
  group.add(rail);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 0.3, 10), steel);
  mast.position.y = height + 0.16;
  group.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 14, 10),
    material('#ffe9b0', { emissive: '#ffc24a', emissiveIntensity: 1.8, roughness: 0.3 }),
  );
  beacon.position.y = height + 0.32;
  group.add(beacon);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.025, 40), steel);
  base.position.y = 0.012;
  group.add(base);

  return group;
}

// ───────────────────────── 西安 · 钟楼 ─────────────────────────
function bellTower() {
  const group = new THREE.Group();
  const brick = material('#8a6a52', { roughness: 0.78, map: brickTexture() });
  const red = material('#9e3b2e', { roughness: 0.55 });
  const roofMat = material('#2f6a5c', { roughness: 0.48, map: tileTexture('#2f6a5c', '#1d4a40') });
  const beam = material('#1f5c57', { roughness: 0.5, map: beamTexture() });
  const windows = material('#8f2f26', { roughness: 0.6, map: latticeTexture(), emissive: '#2a0d08', emissiveIntensity: 0.3 });
  const gold = material('#d9a648', { metalness: 0.58, roughness: 0.32, emissive: '#3a2a08', emissiveIntensity: 0.55 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.15, 0.66), brick);
  base.position.y = 0.075;
  group.add(base);
  for (let i = 0; i < 3; i += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.06), brick);
    step.position.set(0, 0.02 + i * 0.035, 0.33 + (2 - i) * 0.055);
    group.add(step);
  }
  const coping = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.7), material('#a08a6d', { roughness: 0.7 }));
  coping.position.y = 0.16;
  group.add(coping);

  const tiers = [
    { y: 0.17, size: 0.44, height: 0.26, roof: 0.42, wall: 0.4, roofHeight: 0.2 },
    { y: 0.47, size: 0.34, height: 0.22, roof: 0.34, wall: 0.32, roofHeight: 0.17 },
  ];

  tiers.forEach((tier) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(tier.wall, tier.height, tier.wall), windows);
    wall.position.y = tier.y + tier.height / 2;
    group.add(wall);

    const half = tier.size / 2;
    const pillarGeometry = new THREE.CylinderGeometry(0.013, 0.013, tier.height, 10);
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        if (i > 0 && i < 3 && j > 0 && j < 3) continue;
        const pillar = new THREE.Mesh(pillarGeometry, red);
        pillar.position.set(-half + (i * tier.size) / 3, tier.y + tier.height / 2, -half + (j * tier.size) / 3);
        group.add(pillar);
      }
    }

    const frieze = new THREE.Mesh(new THREE.BoxGeometry(tier.size + 0.06, 0.035, tier.size + 0.06), beam);
    frieze.position.y = tier.y + tier.height;
    group.add(frieze);

    const bracket = new THREE.BoxGeometry(0.026, 0.02, 0.026);
    for (let i = 0; i <= 6; i += 1) {
      for (let j = 0; j <= 6; j += 1) {
        if (i > 0 && i < 6 && j > 0 && j < 6) continue;
        const mesh = new THREE.Mesh(bracket, gold);
        mesh.position.set(
          -half - 0.03 + (i * (tier.size + 0.06)) / 6,
          tier.y + tier.height + 0.03,
          -half - 0.03 + (j * (tier.size + 0.06)) / 6,
        );
        group.add(mesh);
      }
    }

    const roof = new THREE.Mesh(new THREE.ConeGeometry(tier.roof, tier.roofHeight, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = tier.y + tier.height + tier.roofHeight / 2 + 0.04;
    group.add(roof);

    const ridgeLength = Math.hypot(tier.roof, tier.roofHeight);
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, ridgeLength * 0.7), gold);
      ridge.position.set(
        Math.cos(angle) * tier.roof * 0.42,
        tier.y + tier.height + tier.roofHeight * 0.55,
        Math.sin(angle) * tier.roof * 0.42,
      );
      ridge.lookAt(0, tier.y + tier.height + tier.roofHeight + 0.04, 0);
      group.add(ridge);
      const beast = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), gold);
      beast.position.set(
        Math.cos(angle) * tier.roof * 0.74,
        tier.y + tier.height + 0.05,
        Math.sin(angle) * tier.roof * 0.74,
      );
      group.add(beast);
    }
  });

  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, 0.1, 12), gold);
  finial.position.y = 0.86;
  group.add(finial);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 18, 14), gold);
  orb.position.y = 0.93;
  group.add(orb);

  return group;
}

// ───────────────────────── 成都 · 天府熊猫塔 ─────────────────────────
function pandaTower() {
  const group = new THREE.Group();
  const shaft = material('#c3cdd6', {
    metalness: 0.48,
    roughness: 0.35,
    map: curtainWallTexture('#c8d2da', '#93a0aa'),
  });
  const glass = material('#9e8cd8', {
    roughness: 0.26,
    metalness: 0.2,
    emissive: '#3b2b6e',
    emissiveIntensity: 1.0,
    map: curtainWallTexture('#b3a4e2', '#6f5fb0'),
  });
  const steel = material('#9aa8b4', { metalness: 0.55, roughness: 0.3 });

  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.025, 40), steel);
  plaza.position.y = 0.012;
  group.add(plaza);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.105, 1.12, 28), shaft);
  body.position.y = 0.57;
  group.add(body);

  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.006, 1.1, 0.006), steel);
    line.position.set(Math.cos(angle) * 0.085, 0.57, Math.sin(angle) * 0.085);
    group.add(line);
  }

  const nodes = [0.26, 0.47, 0.68, 0.88, 1.06];
  nodes.forEach((y, index) => {
    const radius = 0.094 - index * 0.009;
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 22), glass);
    sphere.position.y = y;
    group.add(sphere);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.03, 0.0045, 6, 40), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y - radius * 0.55;
    group.add(ring);
  });

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.09, 24), glass);
  crown.position.y = 1.18;
  group.add(crown);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.011, 0.42, 10), steel);
  mast.position.y = 1.43;
  group.add(mast);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 12, 10),
    material('#ffe9b0', { emissive: '#ffb84a', emissiveIntensity: 1.8, roughness: 0.3 }),
  );
  beacon.position.y = 1.65;
  group.add(beacon);

  return group;
}

function generic() {
  const group = new THREE.Group();
  const stone = material('#b7a98f', { roughness: 0.8, map: brickTexture('#b7a98f', '#9a8c74') });
  const glow = material('#f2c879', { emissive: '#8a5a12', emissiveIntensity: 0.9 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.1, 40), stone);
  base.position.y = 0.05;
  group.add(base);
  const middle = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.36, 32), stone);
  middle.position.y = 0.28;
  group.add(middle);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.26, 32), glow);
  top.position.y = 0.59;
  group.add(top);
  return group;
}

const BUILDERS = {
  tiantan,
  pearl,
  canton_tower: cantonTower,
  bell_tower: bellTower,
  panda_tower: pandaTower,
  generic,
};

export function landmarkFactory(key) {
  const builder = BUILDERS[key] || generic;
  const group = builder();
  group.rotation.y = Math.PI * 0.08;
  return group;
}

export function createLandmarkScene() {
  const root = new THREE.Group();

  const sunLight = new THREE.DirectionalLight(PALETTE.sunDay, 1.0);
  sunLight.position.set(-2.5, 3.0, 4.0);
  root.add(sunLight);

  const fillLight = new THREE.HemisphereLight(PALETTE.skyDay, '#0B1A1F', 0.6);
  root.add(fillLight);

  const rimLight = new THREE.DirectionalLight(PALETTE.gold, 0.6);
  rimLight.position.set(3.0, 1.4, -2.5);
  root.add(rimLight);

  const stageLight = new THREE.PointLight(PALETTE.paper, 0.0, 6, 2);
  stageLight.position.set(0, 1.8, 1.0);
  root.add(stageLight);

  return { root, lights: { sunLight, fillLight, rimLight, stageLight } };
}

export function applyLandmarkLighting(lights, state, openAmount = 1) {
  const { sunLight, fillLight, rimLight, stageLight } = lights;
  const altitude = state.altitude;
  const azimuth = state.azimuth;
  const altitudeRad = (Math.max(altitude, -12) * Math.PI) / 180;
  const azimuthRad = (azimuth * Math.PI) / 180;
  const distance = 5;

  sunLight.color.setRGB(...state.sunRgb);
  sunLight.intensity = state.sunIntensity * (altitude < 0 ? 0.6 : 1.0);
  sunLight.position.set(
    Math.cos(altitudeRad) * Math.sin(azimuthRad) * distance,
    Math.max(Math.sin(altitudeRad), 0.12) * distance,
    -Math.cos(altitudeRad) * Math.cos(azimuthRad) * distance,
  );

  fillLight.color.setRGB(...state.ambientRgb);
  fillLight.intensity = state.ambientIntensity + state.nightFactor * 0.3;

  rimLight.intensity = 0.4 + state.nightFactor * 0.6;
  rimLight.color.set(state.nightFactor > 0.5 ? '#7C93C8' : PALETTE.gold);

  stageLight.intensity = 0.5 * openAmount * (1.0 - state.nightFactor * 0.35);
}
