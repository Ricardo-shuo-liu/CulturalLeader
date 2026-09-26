// 主程序：浮雕沙盘舞台 + 真实日照 + 城市光点 + 地标升起 + 数字人语音。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BACKDROP, PALETTE, STAGE } from './config.js';
import { createBackdrop } from './curtain.js';
import { buildBorders, buildGround, buildSky, buildTerrain, createDust, heightAt, worldPosition } from './terrain.js';
import { applySolarUniforms } from './lighting.js';
import { createCityPoints } from './citypoints.js';
import { createMural } from './mural.js';
import { createRoute } from './route.js';
import { createCityLayer } from './map/city_layer.js';
import { createProvinceLayer } from './map/province_layer.js';
import { createTripPlanner } from './map/trip_planner.js';
import { applyLandmarkLighting, createLandmarkScene, landmarkFactory } from './landmarks.js';
import { createFayHuman } from './fay/fay_live2d.js';
import { VoiceIO } from './voice.js';
import { createUI } from './ui.js';
import { KM_PER_UNIT, LNG_AT_ZERO, LNG_PER_X, unprojectScene } from './geo.js';
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

  // 全国地级市标注（排除已有讲解的 5 座重点城市）
  const cityLayer = createCityLayer({
    scene,
    terrainHeight: (lng, lat) => heightAt(lng, lat, RANGES),
    exclude: new Set(cities.map((city) => city.name)),
  });
  cityLayer.setOpacity(0.9);

  // 省级图层：省界 + 省会标签 + 飞到指定省份
  const provinceLayer = createProvinceLayer({ scene, camera, controls });
  provinceLayer.onFly((position, target) => flyTo(position, target, STAGE.transitionMs));

  // 行程工作台
  const planner = createTripPlanner({
    onSpeak: (text) => {
      if (!text) return;
      if (!muted) voice.enqueue(text);
      ui.setSpeech(text, muted);
    },
  });

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
  // 数字人：Fay 风格 Live2D（模型与配置见 frontend/assets/live2d/）
  const human = await createFayHuman({
    canvas: document.getElementById('live2d-canvas'),
    container: document.getElementById('live2d-stage'),
    announce: (message) => ui.toast(message),
  });

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
      human.setSpeaking(false);
      ui.setSpeech(null);
    },
    onRecognized: (text) => {
      if (!text) return;
      ui.addChat('user', text);
      askCity(text);
    },
    onRecognizeError: (message) => ui.toast(message),
    onHuman: (message) => human.playAction(message?.Data?.Action),
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

  function showCityCard(city) {
    if (!city) return;
    const card = document.getElementById('city-card');
    document.getElementById('city-card-name').textContent = city.name;
    document.getElementById('city-card-meta').textContent = `${city.province || ''} · ${city.tier === 'prefecture' ? '地级市' : '重点城市'}`;
    card.classList.remove('hidden');
    card.__city = city;
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

  // 交互：光点悬停与点选
  let hoverIndex = -1;

  renderer.domElement.addEventListener('pointermove', (event) => {
    // 让数字人的视线跟随鼠标（Fay 规范：ParamEyeBallX/Y + 头部角度）
    human.focus(event.clientX, window.innerHeight - event.clientY);
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
  let pointerDownAt = null;
  renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerDownAt = { x: event.clientX, y: event.clientY };
  });

  renderer.domElement.addEventListener('pointerup', (event) => {
    renderer.domElement.style.cursor = hoverIndex >= 0 ? 'pointer' : 'grab';
    if (event.button !== 0) return;
    // 拖拽旋转视角后不应触发点击
    if (pointerDownAt && Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y) > 6) {
      pointerDownAt = null;
      return;
    }
    pointerDownAt = null;

    // 1) 重点城市（带讲解）
    if (hoverIndex >= 0) {
      const slug = cities[hoverIndex].slug;
      if (route?.active) route.toggle(slug);
      else openCity(slug);
      return;
    }

    // 2) 普通地级市 → 城市卡片
    const layerPositions = cityLayer.screenPositions(camera, window.innerWidth, window.innerHeight);
    let layerHit = -1;
    let best = 20;
    layerPositions.forEach((position) => {
      const distance = Math.hypot(position.x - event.clientX, position.y - event.clientY);
      if (position.visible && distance < best) {
        best = distance;
        layerHit = position.index;
      }
    });
    if (layerHit >= 0) {
      showCityCard(cityLayer.cities[layerHit]);
      return;
    }

    // 3) 点击省份区块 → 飞到该省（放大后可继续看该省城市）
    const ndc = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, point)) return;
    const geo = unprojectScene(point.x, -point.z);
    const province = provinceLayer.provinceAt(geo.lng, geo.lat);
    if (province) {
      provinceLayer.flyToProvince(province);
      ui.toast(`${province.name} · 已飞入该省，继续放大看该省城市`);
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
    human.resize(
      Math.round(Math.min(440, Math.max(220, width * 0.3))),
      Math.round(Math.min(600, Math.max(300, height * 0.74))),
    );
  }

  // ── 导航抽屉开关 ──
  const drawer = document.getElementById('drawer');
  const drawerBackdrop = document.getElementById('drawer-backdrop');

  function toggleDrawer(open) {
    drawer.classList.toggle('open', open);
    drawerBackdrop.classList.toggle('show', open);
  }

  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    toggleDrawer(!drawer.classList.contains('open'));
  });
  document.getElementById('drawer-close')?.addEventListener('click', () => toggleDrawer(false));
  drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));

  // 省份选择：直接飞到指定省份（下拉 + 按钮）
  const provinceSelect = document.getElementById('province-select');
  if (provinceSelect) {
    provinceLayer.provinces
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      .forEach((province) => {
        const option = document.createElement('option');
        option.value = province.adcode;
        option.textContent = province.name;
        provinceSelect.appendChild(option);
      });
    document.getElementById('province-go')?.addEventListener('click', () => {
      const province = provinceLayer.provinces.find((item) => item.adcode === provinceSelect.value);
      if (!province) {
        ui.toast('先在列表里选一个省份');
        return;
      }
      provinceLayer.flyToProvince(province);
      ui.toast(`已飞到 ${province.name}`);
      toggleDrawer(false);
    });
  }

  // 行程规划入口（用城市卡片里选过的城市，否则用北京）
  document.getElementById('planner-open')?.addEventListener('click', () => {
    const card = document.getElementById('city-card');
    const city = card?.__city || cities[0];
    toggleDrawer(false);
    planner.open(city);
  });

  // 城市搜索：回车定位到该城市（放大到省级尺度后会自动显示该省的城市）
  function focusCityByName(name) {
    const city = cityLayer.search(name);
    if (!city) {
      ui.toast('没有找到该城市，试试“西安”或“洛阳”');
      return null;
    }
    const target = worldPosition(city.lng, city.lat, RANGES, 0);
    cityLayer.setHighlight(cityLayer.cities.findIndex((item) => item.name === city.name));
    ui.toast(`${city.name} · ${city.province || ''}`);
    // 飞到"省级视野"：按目标视野宽度（约 550 公里）反推相机距离
    const fovRad = (camera.fov * Math.PI) / 180;
    const targetUnits = 550 / KM_PER_UNIT;
    const distance = Math.max(
      STAGE.camera.minDistance,
      targetUnits / (2 * Math.tan(fovRad / 2) * Math.max(camera.aspect, 0.5)),
    );
    const direction = camera.position.clone().sub(controls.target).normalize();
    const position = target.clone().add(direction.multiplyScalar(distance));
    position.y = Math.max(position.y, target.y + distance * 0.45);
    flyTo(position, target, STAGE.transitionMs);
    return city.name;
  }

  const searchInput = document.getElementById('city-search');
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    focusCityByName(searchInput.value);
  });

  // 城市卡片按钮
  document.getElementById('city-card-close')?.addEventListener('click', () => {
    document.getElementById('city-card').classList.add('hidden');
  });
  document.getElementById('city-card-enter')?.addEventListener('click', () => {
    const card = document.getElementById('city-card');
    const city = card.__city;
    card.classList.add('hidden');
    if (city) planner.open(city);
  });

  window.addEventListener('resize', resize);
  resize();

  // 画质开关（记住上次选择）
  document.getElementById('quality-select')?.addEventListener('change', (event) => {
    applyQuality(event.target.value);
    ui.toast(`画质已切换为${event.target.selectedOptions[0]?.textContent?.replace('画质：', '') || event.target.value}`);
  });

  let lastTime = performance.now();
  const perf = { samples: [], quality: 0, slowSeconds: 0, fastSeconds: 0 };

  // 画质预设：手动选择后不再自动降级（自动降级只作用于"高"档）
  const QUALITY_PRESETS = {
    high: { pixelRatio: Math.min(window.devicePixelRatio || 1, STAGE.maxPixelRatio), particles: true },
    medium: { pixelRatio: 1.25, particles: true },
    low: { pixelRatio: 1, particles: false },
  };
  let qualityLevel = localStorage.getItem('cl-quality') || 'high';

  applyQualityInitial(qualityLevel);

  function applyQualityInitial(level) {
    const preset = QUALITY_PRESETS[level] || QUALITY_PRESETS.high;
    renderer.setPixelRatio(preset.pixelRatio);
    dust.points.visible = preset.particles;
    const select = document.getElementById('quality-select');
    if (select) select.value = level;
  }

  function applyQuality(level) {
    const preset = QUALITY_PRESETS[level] || QUALITY_PRESETS.high;
    qualityLevel = level;
    perf.quality = 0;
    perf.slowSeconds = 0;
    renderer.setPixelRatio(preset.pixelRatio);
    dust.points.visible = preset.particles;
    localStorage.setItem('cl-quality', level);
    const select = document.getElementById('quality-select');
    if (select && select.value !== level) select.value = level;
  }

  /** 自适应画质：持续掉帧时先降像素比，再关掉尘埃粒子（保证交互流畅）。 */
  function applyAdaptiveQuality(delta) {
    const list = perf.samples.slice(-60);
    if (list.length < 45) return;
    const avg = list.reduce((sum, value) => sum + value, 0) / list.length;
    const fps = 1000 / Math.max(avg, 0.001);
    if (fps < 42) {
      perf.slowSeconds += delta;
      perf.fastSeconds = 0;
    } else if (fps > 55) {
      perf.fastSeconds += delta;
      perf.slowSeconds = 0;
    } else {
      perf.slowSeconds = Math.max(0, perf.slowSeconds - delta * 0.5);
      perf.fastSeconds = 0;
    }
    if (qualityLevel !== 'high') return; // 手动选了中/低画质就不再自动降级
    if (perf.slowSeconds > 2 && perf.quality < 2) {
      perf.quality += 1;
      perf.slowSeconds = 0;
      if (perf.quality === 1) {
        renderer.setPixelRatio(1);
      } else {
        dust.points.visible = false;
        dust.points.visible = false;
      }
      console.warn(`[stage] 帧率偏低，自适应画质降到第 ${perf.quality} 级`);
    }
  }

  function frame(now) {
    const delta = Math.min(0.05, (now - lastTime) / 1000);
    perf.samples.push(delta * 1000);
    if (perf.samples.length > 120) perf.samples.shift();
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

    cityLayer.setOpacity(planner.isOpen() ? 0 : 0.9);
    // 光点在屏幕上的大小基本恒定：相机拉近时按比例缩小，避免加色光斑铺满屏幕
    const cameraDistance = camera.position.length();
    cityLayer.setScale(Math.max(0.32, Math.min(1.15, cameraDistance / 6.4)));
    cityLayer.update(camera, now / 1000, window.innerWidth, window.innerHeight);
    cityLayer.updateLabels(cityLayer.screenPositions(camera, window.innerWidth, window.innerHeight), window.innerWidth, window.innerHeight);
    provinceLayer.update(cityLayer.state.viewKm || Infinity);
    perf.frame = (perf.frame || 0) + 1;
    if (perf.frame % 8 === 0) {
      provinceLayer.updateLabels(camera, window.innerWidth, window.innerHeight);
    }
    applyAdaptiveQuality(delta);

    human.setEnergy(muted ? 0 : voice.level());
    human.setSpeaking(!muted && voice.speaking);
    human.setNight(state.nightFactor);
    human.update(delta);

    renderer.render(scene, camera);

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
    human: () => ({
      hasModel: human.hasModel,
      ready: human.ready,
      lipSyncParameter: human.config?.lipSync?.parameter || null,
      idleGroup: human.config?.motions?.idle?.group || null,
      speakGroup: human.config?.motions?.speak?.group || null,
      runtimeLoaded: Boolean(window.PIXI?.live2d),
      coreLoaded: Boolean(window.Live2DCubismCore),
      notice: document.querySelector('.live2d-notice-title')?.textContent || '',
    }),
    humanProbe: () => human.debug?.() ?? null,
    humanMeasure: () => human.measure?.() ?? null,
    perf: () => {
      const list = perf.samples.slice(-90).sort((a, b) => a - b);
      if (!list.length) return null;
      const avg = list.reduce((sum, value) => sum + value, 0) / list.length;
      return {
        fps: Math.round(1000 / Math.max(avg, 0.001)),
        avgMs: Number(avg.toFixed(2)),
        p95Ms: Number(list[Math.floor(list.length * 0.95) - 1]?.toFixed(2) || avg.toFixed(2)),
        quality: perf.quality,
      };
    },
    planner: () => ({ open: planner.isOpen() }),
    plannerOpen: (city) => planner.open(city),
    plannerClose: () => planner.close(),
    plannerReload: () => planner.reload(),
    cityLayer: () => ({
      level: cityLayer.state.level,
      visible: cityLayer.state.visibleCount,
      labels: cityLayer.state.labelCount || 0,
      total: cityLayer.cities.length,
      viewKm: cityLayer.state.viewKm || 0,
    }),
    focusCity: (name) => focusCityByName(name),
    province: () => ({
      visible: provinceLayer.state.visible,
      opacity: Number((provinceLayer.state.opacity || 0).toFixed(2)),
      labels: provinceLayer.state.labelCount || 0,
      total: provinceLayer.provinces.length,
      viewKm: Math.round(cityLayer.state.viewKm || 0),
    }),
    flyProvince: (name) => {
      const province = provinceLayer.provinces.find((item) => item.name.includes(name));
      if (!province) return null;
      provinceLayer.flyToProvince(province);
      return province.name;
    },
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
