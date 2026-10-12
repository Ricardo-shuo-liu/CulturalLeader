// 360° 剪影环幕：坐在环形剧场中央看这座城的两千年。
// - 天幕圆筒：半径 12.5，任何机位都在场内；天空色随日照三段切换，夜间叠星
// - 日月按真实方位角挂在环上：地图上的晨昏线扫到哪里，环幕上的日月就在哪个方位
// - 三层剪影视差：远层山影 / 中层城郭（随年份连续生长）/ 近层脚手架、工匠、驼队、船、火盆
// - 事件与地标建造同步：地标在锁定点立起时，环幕中层同步出现脚手架与半成的剪影

import * as THREE from 'three';
import { ringPosition, skyPalette, skyPhase } from './millennium_style.js';

export const RING_RADIUS = 12.5;
export const RING_HEIGHT = 8;
export const LAYER_RADII = { far: 12.0, mid: 10.5, near: 8.8 };
const LAYER_COLORS = { far: '#22323f', mid: '#131c25', near: '#0a1015' };
const MID_HEIGHTS = { wall: 0.9, gate: 1.05, palace: 0.85, pagoda: 1.6, house: 0.42, tower: 1.9 };

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function plane(width, height, color, opacity) {
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.translate(0, height / 2, 0); // 原点放在底部：scale.y 就是「长高」
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

function placeOnRing(mesh, bearing, radius, lift = 0) {
  const position = ringPosition(bearing, radius, lift);
  mesh.position.set(position.x, position.y, position.z);
  mesh.lookAt(0, position.y, 0);
}

function skyCanvas(phase) {
  const altitude = phase === 'day' ? 20 : phase === 'golden' ? 0 : phase === 'twilight' ? -8 : -20;
  const palette = skyPalette(altitude);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(0.55, palette.mid);
  gradient.addColorStop(0.82, palette.low);
  gradient.addColorStop(1, palette.ground);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 256);
  if (phase === 'night' || phase === 'twilight') {
    const random = seeded(20261012);
    ctx.fillStyle = 'rgba(255, 244, 214, 0.85)';
    for (let index = 0; index < 90; index += 1) {
      const x = Math.floor(random() * 512);
      const y = Math.floor(random() * 120);
      ctx.globalAlpha = 0.35 + random() * 0.6;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowCanvas(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.35, 'rgba(255,240,200,0.35)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function workerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a1015';
  for (let frame = 0; frame < 2; frame += 1) {
    const offset = frame * 16;
    ctx.fillRect(offset + 8, 2, 3, 3);
    ctx.fillRect(offset + 7, 5, 5, 6);
    ctx.fillRect(offset + 7, 11, 2, 4);
    ctx.fillRect(offset + 10, 11, 2, 4);
    ctx.fillRect(offset + (frame ? 12 : 3), frame ? 1 : 5, 2, 2);
    ctx.fillRect(offset + 10, frame ? 2 : 6, 3, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(0.5, 1);
  return texture;
}

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {number} options.bearing 城市方位（弧度，0 = 正北）
 */
export function createRing({ scene, bearing }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // ── 天幕 ──
  const state = { visible: true, event: 0, growing: 0, builtRatio: 0, landmarkState: 'absent', landmarkProgress: 0, phase: '', flash: 0 };
  let skyTexture = null;
  const skyMaterial = new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(RING_RADIUS, RING_RADIUS, RING_HEIGHT, 72, 1, true), skyMaterial);
  sky.position.y = RING_HEIGHT / 2 - 1.6;
  sky.renderOrder = -9;
  group.add(sky);

  // ── 日月 ──
  const sunMaterial = new THREE.MeshBasicMaterial({
    map: glowCanvas('#fff0c8'),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), sunMaterial);
  sun.renderOrder = -8;
  group.add(sun);
  const moonMaterial = sunMaterial.clone();
  moonMaterial.map = glowCanvas('#dfe8f6');
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), moonMaterial);
  moon.renderOrder = -8;
  group.add(moon);

  // ── 远层：山影（一整圈锯齿山脊）──
  const farGroup = new THREE.Group();
  farGroup.renderOrder = -7;
  group.add(farGroup);
  (() => {
    const random = seeded(7);
    const segments = 120;
    const positions = [];
    for (let index = 0; index < segments; index += 1) {
      const a = bearing + (index / segments - 0.5) * Math.PI * 2;
      const b = bearing + ((index + 1) / segments - 0.5) * Math.PI * 2;
      const h1 = 0.7 + random() * 1.5;
      const h2 = 0.7 + random() * 1.5;
      const p1 = ringPosition(a, LAYER_RADII.far);
      const p2 = ringPosition(b, LAYER_RADII.far);
      positions.push(p1.x, 0, p1.z, p2.x, 0, p2.z, p2.x, h2, p2.z);
      positions.push(p1.x, 0, p1.z, p2.x, h2, p2.z, p1.x, h1, p1.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(LAYER_COLORS.far),
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    farGroup.add(new THREE.Mesh(geometry, material));
  })();

  // ── 中层：城郭主体（随年份长高；谁在长，谁就在施工）──
  const midGroup = new THREE.Group();
  midGroup.renderOrder = -6;
  group.add(midGroup);
  const midElements = [];
  (() => {
    const definitions = [
      { key: 'wall', width: 3.4, height: MID_HEIGHTS.wall, offset: -0.22 },
      { key: 'wallB', width: 3.4, height: MID_HEIGHTS.wall, offset: 0.22 },
      { key: 'gate', width: 0.5, height: MID_HEIGHTS.gate, offset: 0 },
      { key: 'palace', width: 1.5, height: MID_HEIGHTS.palace, offset: -0.05 },
      { key: 'pagoda', width: 0.42, height: MID_HEIGHTS.pagoda, offset: 0.3 },
      { key: 'house1', width: 0.34, height: MID_HEIGHTS.house, offset: -0.34 },
      { key: 'house2', width: 0.3, height: MID_HEIGHTS.house, offset: -0.42 },
      { key: 'house3', width: 0.3, height: MID_HEIGHTS.house, offset: 0.4 },
      { key: 'tower1', width: 0.36, height: MID_HEIGHTS.tower, offset: -0.28 },
      { key: 'tower2', width: 0.32, height: MID_HEIGHTS.tower * 0.85, offset: 0.12 },
      { key: 'tower3', width: 0.3, height: MID_HEIGHTS.tower * 0.7, offset: 0.34 },
      { key: 'landmark', width: 0.5, height: 2.3, offset: 0.02 },
    ];
    definitions.forEach((definition) => {
      const mesh = plane(
        definition.width,
        definition.height,
        definition.key.startsWith('tower') ? '#1b2733' : LAYER_COLORS.mid,
        definition.key === 'landmark' ? 0.92 : 0.86,
      );
      placeOnRing(mesh, bearing + definition.offset, LAYER_RADII.mid);
      midGroup.add(mesh);
      midElements.push({ ...definition, mesh, ratio: 0 });
    });
  })();

  // ── 近层：脚手架 / 工匠 / 船 / 驼队 / 火盆 ──
  const nearGroup = new THREE.Group();
  nearGroup.renderOrder = -5;
  group.add(nearGroup);

  const scaffoldGroup = new THREE.Group();
  nearGroup.add(scaffoldGroup);
  for (let index = 0; index < 3; index += 1) {
    const frame = new THREE.Group();
    [-0.5, 0.5].forEach((offsetX) => {
      const pole = new THREE.Mesh(
        new THREE.PlaneGeometry(0.06, 2.4),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(LAYER_COLORS.near),
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      pole.position.set(offsetX, 1.2, 0);
      frame.add(pole);
    });
    for (let bar = 0; bar < 3; bar += 1) {
      const beam = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.06),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(LAYER_COLORS.near),
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beam.position.set(0, 0.6 + bar * 0.7, 0);
      frame.add(beam);
    }
    placeOnRing(frame, bearing + (index - 1) * 0.16, LAYER_RADII.near);
    scaffoldGroup.add(frame);
  }
  scaffoldGroup.visible = false;

  const workerTextureShared = workerTexture();
  const workers = [];
  for (let index = 0; index < 8; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      map: workerTextureShared,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.2), material);
    const angle = bearing + ((index % 4) - 1.5) * 0.09;
    placeOnRing(mesh, angle, LAYER_RADII.near - 0.15);
    mesh.position.y = 0.35 + (index % 3) * 0.55;
    nearGroup.add(mesh);
    workers.push({ mesh, phase: index * 0.7, baseAngle: angle, baseY: mesh.position.y });
  }
  const workerGroup = new THREE.Group();
  workers.forEach((worker) => workerGroup.add(worker.mesh));
  nearGroup.add(workerGroup);
  workerGroup.visible = false;

  const boatMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#0d141a'),
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const boats = [];
  for (let index = 0; index < 4; index += 1) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), boatMaterial);
    hull.position.y = 0.06;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.34), boatMaterial);
    sail.position.set(0.05, 0.3, 0);
    boat.add(hull, sail);
    nearGroup.add(boat);
    boats.push({ boat, angle: bearing - 0.3 + index * 0.2, speed: 0.004 + index * 0.0012 });
  }
  const caravanMaterial = boatMaterial.clone();
  const caravans = [];
  for (let index = 0; index < 3; index += 1) {
    const camel = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.16), caravanMaterial);
    nearGroup.add(camel);
    caravans.push({ camel, angle: bearing + 0.42 + index * 0.05, speed: 0.003 });
  }

  const fireMaterial = new THREE.MeshBasicMaterial({
    map: glowCanvas('#ffb870'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fire = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), fireMaterial);
  placeOnRing(fire, bearing + 0.05, LAYER_RADII.mid + 0.2);
  fire.position.y = 0.5;
  group.add(fire);

  const skyFlash = new THREE.Mesh(
    new THREE.CylinderGeometry(RING_RADIUS - 0.2, RING_RADIUS - 0.2, RING_HEIGHT, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffb870'),
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  skyFlash.position.copy(sky.position);
  group.add(skyFlash);

  function setSkyPhase(next) {
    if (next === state.phase) return;
    state.phase = next;
    skyTexture?.dispose();
    skyTexture = skyCanvas(next);
    skyMaterial.map = skyTexture;
    skyMaterial.needsUpdate = true;
  }

  function elementRatioFor(element, params, landmark) {
    switch (element.key) {
      case 'wall':
      case 'wallB':
        return Math.min(1, params.walls || 0);
      case 'gate':
        return Math.min(1, params.gate || 0);
      case 'palace':
        return Math.min(1, params.palace || 0);
      case 'pagoda':
        return params.pagoda > 0 ? 1 : 0;
      case 'house1':
      case 'house2':
      case 'house3':
        return Math.min(1, params.houses || 0);
      case 'tower1':
      case 'tower2':
      case 'tower3':
        return Math.min(1, params.towers || 0);
      case 'landmark': {
        if (!landmark) return 0;
        if (landmark.state === 'absent') return 0;
        if (landmark.state === 'ruins') return 0.28;
        return Math.max(0.08, Math.min(1, landmark.progress || 0));
      }
      default:
        return 0;
    }
  }

  function update(dt, options = {}) {
    if (!state.visible) return 0;
    const {
      params = {},
      altitude = 0,
      azimuth = 180,
      landmark = null,
      event = 0,
      time = performance.now() / 1000,
    } = options;
    setSkyPhase(skyPhase(altitude));
    state.params = params;

    // 日月按真实方位角挂在环上
    const azimuthRad = (azimuth * Math.PI) / 180;
    state.sunAzimuth = azimuth;
    const sunY = Math.max(0.2, Math.min(RING_HEIGHT - 2.6, 0.6 + altitude * 0.06 + 0.3));
    const sunPosition = ringPosition(azimuthRad, RING_RADIUS - 0.3, sunY);
    sun.position.set(sunPosition.x, sunPosition.y, sunPosition.z);
    sun.lookAt(0, sunPosition.y, 0);
    sunMaterial.opacity = altitude > -6 ? Math.min(0.95, 0.25 + Math.max(0, altitude) * 0.03) : 0;
    const moonPosition = ringPosition(azimuthRad + Math.PI, RING_RADIUS - 0.4, 1.4 + Math.max(0, -altitude) * 0.05);
    moon.position.set(moonPosition.x, moonPosition.y, moonPosition.z);
    moon.lookAt(0, moonPosition.y, 0);
    moonMaterial.opacity = altitude < 2 ? 0.8 : 0;

    // 中层：按年份连续长高；谁在长，谁就「在施工」
    let growing = 0;
    let visibleCount = 0;
    midElements.forEach((element) => {
      const ratio = elementRatioFor(element, params, landmark);
      element.mesh.visible = ratio > 0.01;
      if (element.mesh.visible) visibleCount += 1;
      if (Math.abs(ratio - element.ratio) > 0.004) growing += 1;
      element.ratio = ratio;
      element.mesh.scale.set(1, Math.max(0.001, ratio), 1);
    });
    state.growing = growing;
    state.builtRatio = midElements.length ? visibleCount / midElements.length : 0;
    state.landmarkState = landmark?.state || 'absent';
    state.landmarkProgress = landmark?.progress || 0;

    // 施工中：脚手架与工匠上场
    const busy = Math.min(1, growing * 0.22 + (landmark?.state === 'building' ? 0.7 : 0));
    scaffoldGroup.visible = busy > 0.08;
    workerGroup.visible = busy > 0.08;
    if (scaffoldGroup.visible) {
      scaffoldGroup.children.forEach((frame, index) => {
        const growth = landmark?.state === 'building' ? 0.6 + (landmark.progress || 0) * 0.9 : 0.5 + busy * 0.4;
        frame.scale.set(1, Math.max(0.3, growth + Math.sin(time * 2 + index) * 0.04), 1);
      });
    }
    workers.forEach((worker, index) => {
      const frame = Math.floor((time * 2.4 + worker.phase) % 2);
      worker.mesh.material.map.offset.x = frame * 0.5;
      const swing = Math.sin(time * 1.6 + index) * 0.05;
      placeOnRing(worker.mesh, worker.baseAngle + swing * 0.02, LAYER_RADII.near - 0.15, worker.baseY * (0.4 + busy * 0.6));
    });

    // 船与驼队：只在有水路 / 丝路的城市出现
    const boatsVisible = (params.boats || 0) > 0.05;
    boats.forEach((item, index) => {
      item.boat.visible = boatsVisible;
      if (!boatsVisible) return;
      item.angle -= item.speed * dt;
      placeOnRing(item.boat, item.angle, LAYER_RADII.near + 0.1, 0.06 + index * 0.004);
      item.boat.rotation.z = Math.sin(time * 0.8 + index) * 0.03;
    });
    const caravansVisible = Boolean(params.caravans);
    caravans.forEach((item, index) => {
      item.camel.visible = caravansVisible;
      if (!caravansVisible) return;
      item.angle += item.speed * dt;
      placeOnRing(item.camel, item.angle, LAYER_RADII.near - 0.05, 0.08 + Math.abs(Math.sin(time * 3 + index)) * 0.02);
    });

    // 事件：火光、烟与天幕泛光
    state.event = Math.max(state.event, Math.min(1, Number(event) || 0));
    state.event = Math.max(0, state.event - dt * 0.6);
    const flicker = 0.6 + Math.sin(time * 7) * 0.12 + Math.random() * 0.1;
    fireMaterial.opacity = Math.max(0, state.event * 0.85 * flicker) + (altitude < -6 ? 0.12 * flicker : 0);
    fire.scale.setScalar(0.8 + state.event * 1.4 + Math.sin(time * 5) * 0.05);
    skyFlash.material.opacity = state.event * 0.22 * flicker;

    state.flash = Math.min(1, 0.55 + growing * 0.05 + state.event * 0.5);
    return state.flash;
  }

  function flash() {
    state.event = 1;
  }

  function setVisible(visible) {
    state.visible = Boolean(visible);
    group.visible = state.visible;
  }

  function dispose() {
    scene.remove(group);
    skyTexture?.dispose();
    sky.geometry.dispose();
    skyMaterial.dispose();
    sun.geometry.dispose();
    sunMaterial.map?.dispose();
    sunMaterial.dispose();
    moon.geometry.dispose();
    moonMaterial.map?.dispose();
    moonMaterial.dispose();
    [farGroup, midGroup].forEach((target) => {
      target.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    });
    scaffoldGroup.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
    });
    workers.forEach((worker) => {
      worker.mesh.geometry.dispose();
      worker.mesh.material.dispose();
    });
    boats.forEach((item) => {
      item.boat.children.forEach((child) => child.geometry.dispose());
    });
    boatMaterial.dispose();
    caravans.forEach((item) => item.camel.geometry.dispose());
    caravanMaterial.dispose();
    fire.geometry.dispose();
    fireMaterial.map?.dispose();
    fireMaterial.dispose();
    skyFlash.geometry.dispose();
    skyFlash.material.dispose();
    workerTextureShared.dispose();
  }

  return {
    group,
    update,
    flash,
    setVisible,
    isVisible: () => state.visible,
    brightness: () => state.flash,
    debug: () => ({
      visible: state.visible,
      layers: 3,
      radius: RING_RADIUS,
      bearing: Number(bearing.toFixed(3)),
      phase: state.phase,
      builtRatio: Number(state.builtRatio.toFixed(2)),
      growing: state.growing,
      landmarkState: state.landmarkState,
      landmarkProgress: Number(state.landmarkProgress.toFixed(2)),
      event: Number(state.event.toFixed(2)),
      sunAzimuth: Number((state.sunAzimuth ?? 0).toFixed(1)),
      parts: {
        walls: Number(((state.params || {}).walls || 0).toFixed(2)),
        pagoda: Number(((state.params || {}).pagoda || 0).toFixed(2)),
        towers: Number(((state.params || {}).towers || 0).toFixed(2)),
      },
    }),
    dispose,
  };
}
