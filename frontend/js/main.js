// 主程序：浮雕沙盘舞台 + 真实日照 + 城市光点 + 地标升起 + 数字人语音。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BACKDROP, PALETTE, STAGE } from './config.js';
import { createBackdrop } from './curtain.js';
import { buildBorders, buildGround, buildSky, buildTerrain, createDust, worldPosition } from './terrain.js';
import { applySolarUniforms } from './lighting.js';
import { createCityPoints } from './citypoints.js';
import { createMural } from './mural.js';
import { createRoute } from './route.js';
import { applyLandmarkLighting, createLandmarkScene, landmarkFactory } from './landmarks.js';
import { createAvatar } from './avatar.js';
import { VoiceIO } from './voice.js';
import { createUI } from './ui.js';
import { LNG_AT_ZERO, LNG_PER_X } from './geo.js';
import { CHINA_OUTLINE } from './data/china-outline.js';
import { RANGES } from './data/ranges.js';
import { sampleLighting, smoothstep, sunAltitudeAt, utcHours } from './solar.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

const clockState = { live: true, override: null };

function beijingParts(date) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function dateFromBeijingMinutes(minutes) {
  const today = beijingParts(new Date());
  return new Date(
    Date.UTC(today.year, today.month, today.day, Math.floor(minutes / 60) - 8, minutes % 60, 0),
  );
}

function sceneDate() {
  if (clockState.live || !clockState.override) return new Date();
  return clockState.override;
}

function parseUrlOverrides() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('t');
  if (raw) {
    if (/^\d{1,2}:\d{2}$/.test(raw)) {
      const [hours, minutes] = raw.split(':').map(Number);
      clockState.override = dateFromBeijingMinutes(hours * 60 + minutes);
    } else {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) clockState.override = parsed;
    }
    if (clockState.override) clockState.live = false;
  }
  if (params.get('live') === '0') clockState.live = false;
}

async function boot() {
  parseUrlOverrides();

  const response = await fetch('/api/cities');
  if (!response.ok) throw new Error('城市数据加载失败');
  const cities = await response.json();

  const handlers = {};
  const ui = createUI({ cities, handlers });

  const canvas = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, STAGE.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.inkDeep);

  const camera = new THREE.PerspectiveCamera(STAGE.camera.fov, 1, 0.1, 200);
  camera.position.set(...STAGE.camera.position);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...STAGE.camera.target);
  controls.enableDamping = true;
  controls.dampingFactor = STAGE.camera.damping;
  controls.minDistance = STAGE.camera.minDistance;
  controls.maxDistance = STAGE.camera.maxDistance;
  controls.minPolarAngle = STAGE.camera.minPolar;
  controls.maxPolarAngle = STAGE.camera.maxPolar;
  controls.screenSpacePanning = false;
  controls.enablePan = true;
  controls.update();

  const homePosition = camera.position.clone();
  const homeTarget = controls.target.clone();

  // 天穹（保证任何视角都不会出现纯黑）
  const sky = buildSky();
  scene.add(sky.mesh);
  scene.background = null;

  // 敦煌风格壁画地台（沙盘四周）
  const mural = createMural();
  mural.material.uniforms.uLngPerX.value = LNG_PER_X * 1.6;
  mural.material.uniforms.uLngAtZero.value = LNG_AT_ZERO;
  mural.mesh.renderOrder = -3;
  scene.add(mural.mesh);

  // 地面光池
  const ground = buildGround();
  ground.mesh.renderOrder = -2;
  ground.material.uniforms.uLngPerX.value = LNG_PER_X * 1.8;
  ground.material.uniforms.uLngAtZero.value = LNG_AT_ZERO;
  scene.add(ground.mesh);

  // 尘埃微粒
  const dust = createDust();
  scene.add(dust.points);

  // 幕布（舞台后方）
  const backdrop = createBackdrop();
  backdrop.halves.forEach(({ mesh, material }) => {
    mesh.renderOrder = -4;
    material.uniforms.uLngPerX.value = LNG_PER_X * 2.2;
    material.uniforms.uLngAtZero.value = LNG_AT_ZERO;
  });
  scene.add(backdrop.group);

  // 浮雕地形与国境描边
  const terrain = buildTerrain(CHINA_OUTLINE, { ranges: RANGES });
  scene.add(terrain.mesh);
  const borderGlow = buildBorders(CHINA_OUTLINE, {
    lift: 0.03,
    opacity: 0.20,
    color: '#7fd3e0',
    linewidth: 6.0,
  });
  const borderMain = buildBorders(CHINA_OUTLINE, {
    lift: 0.05,
    opacity: 0.85,
    color: '#f0e4c8',
    linewidth: 2.6,
  });
  scene.add(borderGlow.object);
  scene.add(borderMain.object);

  // 城市光点
  const cityWorld = cities.map((city) => worldPosition(city.lng, city.lat, RANGES, 0));
  const cityPoints = createCityPoints(cities, cityWorld);
  cityPoints.mesh.renderOrder = 2;
  scene.add(cityPoints.mesh);

  // 地标与内场灯光
  const landmark = createLandmarkScene();
  scene.add(landmark.root);
  const cityStage = new THREE.Group();
  landmark.root.add(cityStage);

  let landmarkGroup = null;
  let landmarkToken = 0;
  let landmarkProgress = 0;
  let landmarkTarget = 0;

  function setLandmark(key) {
    const token = (landmarkToken += 1);
    window.setTimeout(() => {
      if (token !== landmarkToken) return;
      if (landmarkGroup) {
        cityStage.remove(landmarkGroup);
        landmarkGroup.traverse((object) => {
          if (object.geometry) object.geometry.dispose();
        });
      }
      landmarkGroup = landmarkFactory(key);
      landmarkGroup.scale.setScalar(0.85);
      cityStage.add(landmarkGroup);
    }, 40);
  }

  // 数字人与语音
  const avatar = await createAvatar(document.getElementById('avatar-canvas'));

  let muted = false;
  let sessionId = null;
  let activeCity = null;
  let backdropOpen = 0;
  let backdropTarget = 0;

  const voice = new VoiceIO({
    onToken: (text) => ui.appendToken(text),
    onSentence: (text) => {
      voice.enqueue(text);
      ui.setSpeech(text, muted);
    },
    onDone: () => ui.endAssistant(),
    onError: (message) => {
      ui.toast(message);
      ui.endAssistant();
    },
    onSpeakStart: (text) => ui.setSpeech(text, muted),
    onIdle: () => {
      avatar.setSpeaking(false);
      ui.setSpeech(null);
    },
    onRecognized: (text) => {
      if (!text) return;
      ui.addChat('user', text);
      askCity(text);
    },
    onRecognizeError: (message) => ui.toast(message),
  });

  function speak(text) {
    if (!text) return;
    if (!muted) voice.enqueue(text);
    ui.setSpeech(text, muted);
  }

  // 路线规划（LKH-3.0.14）
  let route = null;

  // 相机补间
  const tween = { active: false, start: 0, duration: 0, from: {}, to: {} };

  function flyTo(position, target, duration = STAGE.transitionMs) {
    tween.active = true;
    tween.start = performance.now();
    tween.duration = duration;
    tween.from = { position: camera.position.clone(), target: controls.target.clone() };
    tween.to = { position: position.clone(), target: target.clone() };
    controls.enabled = false;
  }

  function updateTween(now) {
    if (!tween.active) return;
    const t = clamp((now - tween.start) / tween.duration, 0, 1);
    const k = easeInOutCubic(t);
    camera.position.lerpVectors(tween.from.position, tween.to.position, k);
    controls.target.lerpVectors(tween.from.target, tween.to.target, k);
    if (t >= 1) {
      tween.active = false;
      controls.enabled = true;
      controls.update();
    }
  }

  async function askCity(text) {
    if (!activeCity) {
      ui.toast('先在地图上点选一座城市');
      return;
    }
    try {
      ui.beginAssistant();
      sessionId = await voice.ask(activeCity.slug, text, sessionId);
    } catch (error) {
      ui.toast(error.message || '提问失败');
      ui.endAssistant();
    }
  }

  async function openCity(slug) {
    const index = cities.findIndex((item) => item.slug === slug);
    if (index < 0) return;
    const city = cities[index];
    activeCity = city;
    sessionId = null;
    backdropTarget = 1;
    ui.setActive(slug);
    ui.showPanel(city);
    voice.stopSpeaking();

    const spot = cityWorld[index];
    cityStage.position.copy(spot);
    setLandmark(city.landmark_key);
    landmarkTarget = 1;
    landmarkProgress = 0;

    const direction = camera.position.clone().sub(controls.target).normalize();
    const focus = spot.clone();
    focus.y += 0.25;
    const camPosition = spot.clone().add(direction.multiplyScalar(3.0));
    camPosition.y = Math.max(camPosition.y, spot.y + 1.55);
    flyTo(camPosition, focus, STAGE.transitionMs);

    try {
      const detail = await fetch(`/api/cities/${slug}`).then((r) => (r.ok ? r.json() : null));
      if (detail) activeCity = { ...city, ...detail };
    } catch (error) {
      console.warn('[stage] 城市详情加载失败', error);
    }
    if (activeCity.slug !== slug) return;
    if (activeCity.narration) {
      if (!muted) voice.enqueue(activeCity.narration);
      ui.setSpeech(activeCity.narration, muted);
    }
  }

  function closeCity() {
    activeCity = null;
    sessionId = null;
    backdropTarget = 0;
    landmarkTarget = 0;
    ui.setActive(null);
    ui.hidePanel();
    voice.stopSpeaking();
    ui.setSpeech(null);
    flyTo(homePosition, homeTarget, STAGE.closeMs);
  }

  handlers.onCitySelect = (slug) => {
    // 路线规划模式下，点城市（含地图上的文字标签）是加入/移除，而不是进入城市
    if (route?.active) {
      route.toggle(slug);
      return;
    }
    openCity(slug);
  };
  handlers.onCityHover = (slug) => {
    const index = slug ? cities.findIndex((city) => city.slug === slug) : -1;
    cityPoints.setHover(index);
  };
  handlers.onCloseCity = () => closeCity();
  handlers.onReplay = () => {
    if (!activeCity?.narration) return;
    voice.stopSpeaking();
    voice.enqueue(activeCity.narration);
    ui.setSpeech(activeCity.narration, muted);
  };
  handlers.onAsk = (text) => {
    ui.addChat('user', text);
    askCity(text);
  };
  handlers.onMicStart = () => voice.startRecording();
  handlers.onMicEnd = () => voice.stopRecording();
  handlers.onTimeChange = (minutes) => {
    clockState.live = false;
    clockState.override = dateFromBeijingMinutes(minutes);
  };
  handlers.onLive = () => {
    clockState.live = true;
    clockState.override = null;
    ui.toast('已回到实时日照');
  };

  document.getElementById('mute-btn').addEventListener('click', () => {
    muted = !muted;
    if (muted) voice.stopSpeaking();
    ui.setMuted(muted);
  });

  if (!avatar.hasVrm) {
    ui.toast('未找到 VRM 形象，已使用程序化水墨绢人（放入 frontend/assets/avatar.vrm 可替换）');
  }

  // 交互：光点悬停与点选
  let hoverIndex = -1;

  renderer.domElement.addEventListener('pointermove', (event) => {
    const positions = cityPoints.screenPositions(camera, window.innerWidth, window.innerHeight);
    let hover = -1;
    let best = STAGE.cityHoverPx;
    positions.forEach((position) => {
      const distance = Math.hypot(position.x - event.clientX, position.y - event.clientY);
      if (position.visible && distance < best) {
        best = distance;
        hover = position.index;
      }
    });
    if (hover !== hoverIndex) {
      hoverIndex = hover;
      cityPoints.setHover(hover);
      renderer.domElement.style.cursor = hover >= 0 ? 'pointer' : 'grab';
    }
  });

  renderer.domElement.addEventListener('pointerdown', () => {
    renderer.domElement.style.cursor = 'grabbing';
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    renderer.domElement.style.cursor = hoverIndex >= 0 ? 'pointer' : 'grab';
    if (hoverIndex >= 0 && event.button === 0) {
      const slug = cities[hoverIndex].slug;
      if (route?.active) route.toggle(slug);
      else openCity(slug);
    }
  });

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    borderGlow.material.resolution.set(width, height);
    borderMain.material.resolution.set(width, height);
    avatar.resize(
      Math.round(Math.min(440, Math.max(220, width * 0.3))),
      Math.round(Math.min(600, Math.max(300, height * 0.74))),
    );
  }

  window.addEventListener('resize', resize);
  resize();

  let lastTime = performance.now();

  function frame(now) {
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const date = sceneDate();
    const state = sampleLighting(date);
    state.utcHours = utcHours(date);
    const beijing = beijingParts(date);

    updateTween(now);
    controls.update();

    mural.material.uniforms.uTime.value = now / 1000;
    applySolarUniforms(mural.material, state);
    ground.material.uniforms.uTime.value = now / 1000;
    applySolarUniforms(ground.material, state);
    applySolarUniforms(sky.material, state);
    dust.material.uniforms.uTime.value = now / 1000;
    dust.material.uniforms.uNightFactor.value = state.nightFactor;
    dust.material.uniforms.uOpacity.value = 0.28 + state.nightFactor * 0.3;

    // 幕布开合
    const duration = backdropTarget > backdropOpen ? STAGE.transitionMs : STAGE.closeMs;
    const step = (delta * 1000) / duration;
    backdropOpen = backdropTarget > backdropOpen
      ? Math.min(backdropTarget, backdropOpen + step)
      : Math.max(backdropTarget, backdropOpen - step);
    const open = easeInOutCubic(backdropOpen);

    backdrop.halves.forEach(({ material }) => {
      applySolarUniforms(material, state);
      material.uniforms.uTime.value = now / 1000;
      material.uniforms.uOpen.value = open;
    });

    // 地标升起
    landmarkTarget > landmarkProgress
      ? (landmarkProgress = Math.min(landmarkTarget, landmarkProgress + delta * 1.6))
      : (landmarkProgress = Math.max(landmarkTarget, landmarkProgress - delta * 2.2));
    const rise = landmarkTarget > 0 ? easeOutBack(clamp(landmarkProgress, 0, 1)) : landmarkProgress;
    cityStage.visible = landmarkProgress > 0.01;
    cityStage.scale.setScalar(Math.max(0.001, rise));
    cityStage.position.y = (1 - clamp(landmarkProgress, 0, 1)) * 0.35;

    applySolarUniforms(terrain.material, state);
    terrain.material.uniforms.uTime.value = now / 1000;
    terrain.material.uniforms.uOpacity.value = 1 - open * 0.15;

    cityPoints.setNight(
      cities.map((city) => smoothstep(3, -8, sunAltitudeAt(city.lng, city.lat, date))),
    );
    cityPoints.material.uniforms.uTime.value = now / 1000;
    cityPoints.material.uniforms.uNightFactor.value = state.nightFactor;
    cityPoints.material.uniforms.uOpacity.value = 1 - open * 0.35;

    applyLandmarkLighting(landmark.lights, state, Math.max(0.25, landmarkProgress));

    route?.update(delta);

    avatar.setEnergy(muted ? 0 : voice.level());
    avatar.setSpeaking(!muted && voice.speaking);
    avatar.setNight(state.nightFactor);
    avatar.update(delta);

    renderer.render(scene, camera);
    avatar.render();

    ui.updateLabels(cityPoints.screenPositions(camera, window.innerWidth, window.innerHeight));
    ui.updateTimeboard({
      date,
      phaseLabel: state.phaseLabel,
      altitude: state.altitude,
      azimuth: state.azimuth,
      live: clockState.live,
      minutes: beijing.minutes,
    });

    requestAnimationFrame(frame);
  }

  route = createRoute({
    scene,
    cities,
    onSelectionChange: (slugs) => {
      const badges = {};
      slugs.forEach((slug, index) => {
        badges[slug] = index + 1;
      });
      ui.setBadges(badges);
    },
    onResult: (result) => {
      const badges = {};
      result.order.forEach((slug, index) => {
        badges[slug] = index + 1;
      });
      ui.setBadges(badges);
      speak(
        `本次路线共 ${result.names.length} 座城市，最优顺序是 ${result.names.join('、然后')}，` +
          `总里程约 ${Math.round(result.distance_km)} 公里，由 ${result.solver} 求解。`,
      );
    },
    onError: (message) => ui.toast(message),
  });

  const routeButton = document.getElementById('route-btn');
  routeButton.addEventListener('click', () => {
    const next = !route.active;
    route.setActive(next);
    document.body.classList.toggle('route-mode', next);
    if (next) ui.hidePanel();
    ui.toast(next ? '路线规划：点击城市加入或移除，选好后点“求解最优路线”' : '已退出路线规划');
  });

  window.__cl = {
    openCity,
    closeCity,
    route: () => ({
      active: route?.active || false,
      selected: route?.selected || [],
      result: route?.result || null,
    }),
    routeActivate: () => document.getElementById('route-btn').click(),
    routeToggle: (slug) => route.toggle(slug),
    routeSolve: () => route.solve(),
    camera: () => ({
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    }),
    screen: (lng, lat) => {
      const vector = worldPosition(lng, lat, RANGES, 0.05).project(camera);
      return {
        x: (vector.x * 0.5 + 0.5) * window.innerWidth,
        y: (-vector.y * 0.5 + 0.5) * window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    },
    debug: () => ({
      open: backdropOpen,
      target: backdropTarget,
      city: activeCity ? activeCity.slug : null,
      muted,
      landmark: landmarkProgress,
      cameraDistance: camera.position.distanceTo(controls.target),
    }),
  };

  ui.setLoading(false);
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  const loading = document.getElementById('loading');
  if (loading) {
    loading.textContent = `启动失败：${error.message}`;
    loading.classList.remove('hidden');
  }
});
