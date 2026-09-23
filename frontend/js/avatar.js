// 数字人：优先加载 VRM（three-vrm），否则使用程序化"敦煌彩塑"形象。
// 形象刻意采用壁画式垂眸含笑（不用写实眼球），避免恐怖谷；口型、手势与飘带随语音驱动。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PALETTE } from './config.js';

const AVATAR_URL = '/assets/avatar.vrm';

/** 卡通着色用的阶梯渐变，让颜色像壁画平涂。 */
function toonGradient(steps = [0.32, 0.62, 0.86, 1.0]) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((value, index) => {
    const gray = Math.round(value * 255);
    data[index * 4] = gray;
    data[index * 4 + 1] = gray;
    data[index * 4 + 2] = gray;
    data[index * 4 + 3] = 255;
  });
  const texture = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const GRADIENT = { value: null };

function toonMaterial(color, options = {}) {
  return new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: GRADIENT.value,
    emissive: new THREE.Color(options.emissive || '#000000'),
    emissiveIntensity: options.emissiveIntensity ?? 0.2,
  });
}

/** 衣袍上的敦煌纹样（联珠 + 卷草），程序化绘制。 */
function robeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2f5f6b';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(232, 220, 195, 0.85)';
  for (let x = 16; x < 256; x += 32) {
    ctx.beginPath();
    ctx.arc(x, 34, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#c9a227';
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let x = 0; x <= 256; x += 8) {
    const y = 140 + Math.sin((x / 256) * Math.PI * 4) * 16;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(159, 62, 50, 0.85)';
  for (let x = 24; x < 256; x += 64) {
    ctx.beginPath();
    ctx.ellipse(x, 200, 22, 9, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

/** 头光/背光：壁画里佛龛式的光背。 */
function buildHalo() {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 20, 128, 128, 126);
  gradient.addColorStop(0, 'rgba(255, 226, 168, 0.55)');
  gradient.addColorStop(0.55, 'rgba(242, 200, 121, 0.22)');
  gradient.addColorStop(1, 'rgba(242, 200, 121, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255, 232, 180, 0.55)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const disc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 1.15),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  group.add(disc);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.008, 8, 64),
    new THREE.MeshBasicMaterial({ color: '#ffdca0', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending }),
  );
  group.add(ring);
  return group;
}

function buildPresenter() {
  const group = new THREE.Group();
  const skin = toonMaterial('#f0dcc8');
  const skinShade = toonMaterial('#e0c3ad');
  const hair = toonMaterial('#241d24');
  const robe = new THREE.MeshToonMaterial({ color: '#f2ece0', gradientMap: GRADIENT.value, map: robeTexture() });
  const robeInner = toonMaterial('#9e3b2e');
  const gold = toonMaterial('#e0b45c', { emissive: '#4a3408', emissiveIntensity: 0.5 });
  const sash = toonMaterial('#9fd3d8', { emissive: '#1d4a52', emissiveIntensity: 0.25 });
  const blush = new THREE.MeshBasicMaterial({ color: '#d98a7a', transparent: true, opacity: 0.35 });
  const ink = new THREE.MeshBasicMaterial({ color: '#2a2027' });

  // 头光
  const halo = buildHalo();
  halo.position.set(0, 1.72, -0.34);
  group.add(halo);

  // 躯干（交领衣袍）
  const torsoProfile = [
    new THREE.Vector2(0.3, 0.0),
    new THREE.Vector2(0.32, 0.24),
    new THREE.Vector2(0.33, 0.52),
    new THREE.Vector2(0.28, 0.78),
    new THREE.Vector2(0.2, 0.98),
    new THREE.Vector2(0.1, 1.12),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 48), robe);
  torso.scale.set(1.05, 1.0, 0.78);
  group.add(torso);

  // 交领
  const collarLeft = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.05), robeInner);
  collarLeft.position.set(-0.09, 0.95, 0.2);
  collarLeft.rotation.z = 0.34;
  const collarRight = collarLeft.clone();
  collarRight.position.x = 0.09;
  collarRight.rotation.z = -0.34;
  group.add(collarLeft, collarRight);

  // 腰带
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 10, 48), gold);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.52;
  belt.scale.set(1, 0.78, 1);
  group.add(belt);

  // 肩与手臂
  const arms = [];
  [-1, 1].forEach((side) => {
    const arm = new THREE.Group();
    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.15, 0.62, 24, 1, true),
      robe,
    );
    sleeve.position.y = -0.28;
    arm.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 8, 32), robeInner);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.58;
    arm.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), skin);
    hand.scale.set(0.8, 1.1, 0.5);
    hand.position.y = -0.64;
    arm.add(hand);
    arm.position.set(side * 0.24, 1.02, 0.04);
    arm.rotation.z = side * -0.22;
    arm.rotation.x = 0.16;
    group.add(arm);
    arms.push({ arm, side });
  });

  // 脖子与头
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.16, 20), skinShade);
  neck.position.y = 1.1;
  group.add(neck);

  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185, 40, 30), skin);
  skull.scale.set(0.94, 1.06, 0.92);
  head.add(skull);

  // 垂眸：闭眼弧线（壁画式），避免写实眼球的诡异感
  const eyeGeometry = new THREE.TorusGeometry(0.03, 0.006, 6, 20, Math.PI * 0.95);
  const eyeLeft = new THREE.Mesh(eyeGeometry, ink);
  eyeLeft.rotation.set(Math.PI / 2, 0, Math.PI * 0.06);
  eyeLeft.position.set(-0.062, 0.012, 0.15);
  const eyeRight = eyeLeft.clone();
  eyeRight.position.x = 0.062;
  eyeRight.rotation.z = -Math.PI * 0.06;
  head.add(eyeLeft, eyeRight);

  const browGeometry = new THREE.TorusGeometry(0.036, 0.0045, 6, 20, Math.PI * 0.7);
  const browLeft = new THREE.Mesh(browGeometry, ink);
  browLeft.rotation.set(Math.PI / 2, 0, Math.PI * 0.15);
  browLeft.position.set(-0.066, 0.065, 0.15);
  const browRight = browLeft.clone();
  browRight.position.x = 0.066;
  browRight.rotation.z = Math.PI * 0.85;
  head.add(browLeft, browRight);

  // 腮红
  [-1, 1].forEach((side) => {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), blush);
    dot.position.set(side * 0.105, -0.025, 0.135);
    dot.rotation.y = side * 0.5;
    head.add(dot);
  });

  // 唇：随语音开合
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.026, 20, 14), toonMaterial('#b5443c'));
  mouth.position.set(0, -0.065, 0.156);
  mouth.scale.set(1.15, 0.3, 0.45);
  head.add(mouth);

  // 发髻与花钿
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.193, 40, 26, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hair,
  );
  hairCap.position.y = 0.025;
  head.add(hairCap);
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 18), hair);
  bun.position.set(0, 0.19, -0.03);
  bun.scale.set(1, 0.85, 1);
  head.add(bun);
  const bunRing = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.012, 8, 28), gold);
  bunRing.rotation.x = Math.PI / 2.3;
  bunRing.position.set(0, 0.17, -0.03);
  head.add(bunRing);
  const ornament = new THREE.Mesh(new THREE.CircleGeometry(0.02, 14), gold);
  ornament.position.set(0, 0.085, 0.175);
  head.add(ornament);
  [-1, 1].forEach((side) => {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 8), gold);
    pin.rotation.z = Math.PI / 2 + side * 0.5;
    pin.position.set(side * 0.12, 0.19, -0.02);
    head.add(pin);
  });

  head.position.y = 1.25;
  group.add(head);

  // 披帛飘带
  const ribbons = [];
  [-1, 1].forEach((side) => {
    const points = [
      new THREE.Vector3(side * 0.22, 1.04, -0.06),
      new THREE.Vector3(side * 0.42, 0.86, -0.16),
      new THREE.Vector3(side * 0.3, 0.6, -0.24),
      new THREE.Vector3(side * 0.5, 0.34, -0.3),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.022, 8, false), sash);
    group.add(ribbon);
    ribbons.push({ ribbon, side, base: ribbon.rotation.z });
  });

  group.userData = { mouth, head, arms, ribbons, halo, torso, eyeLeft, eyeRight };
  return group;
}

async function loadVrm(scene) {
  let vrmModule;
  try {
    vrmModule = await import('@pixiv/three-vrm');
  } catch (error) {
    console.warn('[avatar] three-vrm 模块不可用，使用占位形象', error);
    return null;
  }
  const { VRMLoaderPlugin, VRMUtils } = vrmModule;
  if (!VRMLoaderPlugin) return null;

  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      AVATAR_URL,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        if (!vrm) {
          resolve(null);
          return;
        }
        try {
          VRMUtils?.removeUnnecessaryVertices?.(gltf.scene);
          VRMUtils?.combineSkeletons?.(gltf.scene);
        } catch (error) {
          console.warn('[avatar] VRM 优化步骤跳过', error);
        }
        vrm.scene.traverse((object) => {
          object.frustumCulled = false;
        });
        vrm.scene.rotation.y = Math.PI;
        scene.add(vrm.scene);
        resolve(vrm);
      },
      undefined,
      (error) => {
        console.warn('[avatar] VRM 加载失败', error);
        resolve(null);
      },
    );
  });
}

export async function createAvatar(canvas) {
  GRADIENT.value = toonGradient();

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 0.75, 0.1, 30);
  camera.position.set(0, 1.32, 3.0);
  camera.lookAt(0, 1.24, 0);

  const keyLight = new THREE.DirectionalLight(new THREE.Color('#fff3e0'), 1.5);
  keyLight.position.set(-1.4, 2.4, 2.6);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(new THREE.Color(PALETTE.gold), 1.2);
  rimLight.position.set(1.6, 1.8, -2.2);
  scene.add(rimLight);

  const ambient = new THREE.HemisphereLight(new THREE.Color('#bcd6e4'), new THREE.Color('#26343c'), 1.0);
  scene.add(ambient);

  const vrm = await loadVrm(scene);
  const presenter = vrm ? null : buildPresenter();
  if (presenter) scene.add(presenter);

  if (vrm) {
    // 让 VRM 自动适配画布：按包围盒缩放到约 1.9 单位高并居中
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0.01) {
      const scale = 1.9 / size.y;
      vrm.scene.scale.setScalar(scale);
      const scaled = new THREE.Box3().setFromObject(vrm.scene);
      const center = new THREE.Vector3();
      scaled.getCenter(center);
      vrm.scene.position.x -= center.x;
      vrm.scene.position.z -= center.z;
      vrm.scene.position.y -= scaled.min.y;
    }
    if (vrm.lookAt) {
      const target = new THREE.Object3D();
      target.position.set(0, 1.3, 3.2);
      scene.add(target);
      vrm.lookAt.target = target;
    }
  }

  const state = { mouth: 0, energy: 0, speaking: false, time: 0, blink: 0, nextBlink: 2.4, gesture: 0 };

  function resize(width, height) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  return {
    hasVrm: Boolean(vrm),
    resize,
    setEnergy(value) {
      state.energy = Math.max(0, Math.min(1, value));
    },
    setSpeaking(value) {
      state.speaking = Boolean(value);
    },
    setNight(nightFactor) {
      keyLight.intensity = 1.5 - nightFactor * 0.6;
      keyLight.color.set(nightFactor > 0.6 ? '#9db3dd' : '#fff3e0');
      ambient.intensity = 1.0 - nightFactor * 0.35;
      rimLight.intensity = 1.2 + nightFactor * 0.5;
    },
    update(delta) {
      state.time += delta;
      const targetMouth = state.speaking ? Math.min(1, state.energy * 2.6) : 0;
      state.mouth += (targetMouth - state.mouth) * Math.min(1, delta * 16);

      if (state.time > state.nextBlink) {
        state.blink = 1;
        state.nextBlink = state.time + 3.2 + Math.random() * 3.4;
      }
      state.blink = Math.max(0, state.blink - delta * 5);

      const breath = Math.sin(state.time * 1.35) * 0.012;
      const sway = Math.sin(state.time * 0.7) * 0.022;
      const nod = state.speaking ? Math.sin(state.time * 3.1) * 0.02 * (0.4 + state.energy) : Math.sin(state.time * 0.9) * 0.008;
      const gestureTarget = state.speaking ? 1 : 0;
      state.gesture += (gestureTarget - state.gesture) * Math.min(1, delta * 2.6);

      if (vrm) {
        const manager = vrm.expressionManager;
        if (manager) {
          manager.setValue('aa', state.mouth);
          manager.setValue('blink', state.blink);
          manager.setValue('happy', state.speaking ? 0.25 : 0.1);
        }
        vrm.scene.position.y = breath;
        vrm.scene.rotation.z = sway * 0.5;
        vrm.update(delta);
      }

      if (presenter) {
        const data = presenter.userData;
        data.mouth.scale.y = 0.28 + state.mouth * 2.1;
        data.head.rotation.x = nod;
        data.head.rotation.y = Math.sin(state.time * 0.55) * 0.05;
        data.head.rotation.z = sway * 0.35;
        presenter.position.y = breath;
        presenter.rotation.z = sway * 0.4;
        // 说话时右臂抬起做讲解手势，左臂稳定
        data.arms.forEach(({ arm, side }) => {
          const lift = side > 0 ? state.gesture : state.gesture * 0.25;
          const swing = Math.sin(state.time * 1.6 + (side > 0 ? 0 : 1.2)) * 0.05 * state.gesture;
          arm.rotation.z = side * (-0.22 - lift * 0.34) + swing;
          arm.rotation.x = 0.16 - lift * 0.22;
        });
        // 飘带随呼吸轻摆
        data.ribbons.forEach(({ ribbon, side }, index) => {
          ribbon.rotation.z = Math.sin(state.time * 0.9 + index * 1.7) * 0.05 + side * 0.02;
          ribbon.rotation.x = Math.sin(state.time * 1.1 + index) * 0.03;
        });
        data.halo.rotation.z = Math.sin(state.time * 0.4) * 0.03;
      }
    },
    render() {
      renderer.render(scene, camera);
    },
  };
}
