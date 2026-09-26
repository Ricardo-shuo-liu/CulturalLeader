// Fay 风格 Live2D 数字人客户端（迁移自 Fay 的数字人驱动约定，按本项目重构）：
//  - 遵循 Fay《Live2D 模型制作要求》：Cubism 5 / model3 v3 / LipSync 组驱动 ParamMouthOpenY
//  - 遵循 Fay《标准动作改造说明》：服务端只给通用动作语义，前端映射到具体动作编号
//  - 口型由音频包络实时驱动（0~1），眨眼/视线由 SDK 与指针驱动
//
// 依赖：pixi.min.js → live2dcubismcore.global.js → cubism4.min.js（在 index.html 中按序引入）

import { resolveAction } from './fay_actions.js';

const DEFAULT_CONFIG = {
  enabled: true,
  model: 'model/model.model3.json',
  scale: 1.0,
  anchor: [0.5, 1.0],
  position: [0, 0],
  lipSync: { groupId: 'LipSync', parameter: 'ParamMouthOpenY', volume: 1.0, minOpen: 0, maxOpen: 1 },
  eyeBlink: { groupId: 'EyeBlink' },
  motions: {
    idle: { group: 'Idle', index: 0 },
    speak: { group: 'TapBody', index: null },
    greet: { group: 'TapBody', index: 0 },
  },
  expressions: { neutral: '', happy: '' },
  actions: {},
  night: { brightness: 0.8, saturation: 1.05 },
};

const CONFIG_URL = '/assets/live2d/config.json';
const BASE_DIR = '/assets/live2d/';

async function loadConfig() {
  try {
    const response = await fetch(CONFIG_URL, { cache: 'no-cache' });
    if (!response.ok) return { ...DEFAULT_CONFIG };
    const payload = await response.json();
    return {
      ...DEFAULT_CONFIG,
      ...payload,
      lipSync: { ...DEFAULT_CONFIG.lipSync, ...(payload.lipSync || {}) },
      motions: { ...DEFAULT_CONFIG.motions, ...(payload.motions || {}) },
      expressions: { ...DEFAULT_CONFIG.expressions, ...(payload.expressions || {}) },
      night: { ...DEFAULT_CONFIG.night, ...(payload.night || {}) },
    };
  } catch (error) {
    console.warn('[fay] 读取 Live2D 配置失败，使用默认值', error);
    return { ...DEFAULT_CONFIG };
  }
}

function showNotice(container, title, lines) {
  if (!container) return;
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'live2d-notice';
  box.innerHTML =
    `<div class="live2d-notice-title">${title}</div>` +
    lines.map((line) => `<div class="live2d-notice-line">${line}</div>`).join('');
  container.appendChild(box);
}

/**
 * 创建 Fay 风格 Live2D 数字人。
 * @param {{canvas: HTMLCanvasElement, container: HTMLElement, announce?: (msg:string)=>void}} options
 */
export async function createFayHuman({ canvas, container, announce }) {
  const config = await loadConfig();
  const state = {
    model: null,
    app: null,
    mouth: 0,
    energy: 0,
    speaking: false,
    time: 0,
    nightFactor: 0,
    ready: false,
    hasModel: false,
    lastAction: null,
  };

  if (!config.enabled) {
    showNotice(container, '数字人已关闭', ['在 assets/live2d/config.json 中把 enabled 设为 true 即可启用']);
    return createStub();
  }

  const PIXI = window.PIXI;
  if (!PIXI || !PIXI.live2d) {
    showNotice(container, 'Live2D 运行时未加载', [
      '需要按顺序引入 pixi.min.js → live2dcubismcore.global.js → cubism4.min.js',
      '这些文件已随项目放在 frontend/vendor/live2d/',
    ]);
    return createStub();
  }

  const modelUrl = BASE_DIR + String(config.model).replace(/^\/+/, '');

  try {
    const head = await fetch(modelUrl, { method: 'HEAD' });
    if (!head.ok) throw new Error(`模型文件不存在：${modelUrl}`);
  } catch (error) {
    showNotice(container, '还没有放入 Live2D 形象', [
      '1. 把 Cubism 5 导出的整个目录放到 <b>frontend/assets/live2d/model/</b>',
      '2. 目录内需有 <b>*.model3.json</b>',
      '3. 在 <b>frontend/assets/live2d/config.json</b> 里把 model 指向该文件',
      '4. 运行校验：<b>python tools/check_live2d_model.py</b>',
      '详见 docs/数字人（Live2D）接入说明.md',
    ]);
    announce?.('未检测到 Live2D 模型，请看右下角说明放入形象');
    return createStub();
  }

  const app = new PIXI.Application({
    view: canvas,
    transparent: true,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  state.app = app;

  let model = null;
  try {
    const Live2DModel = PIXI.live2d.Live2DModel;
    model = await Live2DModel.from(modelUrl, {
      autoInteract: true,
      motionPreload: PIXI.live2d.MotionPreloadStrategy?.IDLE ?? undefined,
    });
    model.anchor?.set?.(config.anchor[0], config.anchor[1]);
    model.scale.set(config.scale);
    model.position.set(config.position[0], config.position[1]);
    app.stage.addChild(model);
    state.model = model;
    state.hasModel = true;
    state.ready = true;
    model.motion?.(config.motions.idle.group, config.motions.idle.index ?? undefined);
    fitModel(app.renderer.width, app.renderer.height);
  } catch (error) {
    console.error('[fay] Live2D 模型加载失败', error);
    showNotice(container, 'Live2D 模型加载失败', [
      `模型路径：${modelUrl}`,
      `${error.message || error}`,
      '请确认导出的目录结构完整（.moc3 / 贴图 / physics3.json 等随 model3.json 一起）',
    ]);
    return createStub();
  }

  const coreModel = () => model?.internalModel?.coreModel;

  function parameterIndex(id) {
    const core = coreModel();
    if (!core || typeof core.getParameterIndex !== 'function') return -1;
    try {
      return core.getParameterIndex(id);
    } catch (error) {
      return -1;
    }
  }

  function parameterValue(id) {
    const core = coreModel();
    if (!core || typeof core.getParameterValueById !== 'function') return null;
    try {
      return core.getParameterValueById(id);
    } catch (error) {
      return null;
    }
  }

  const lipSyncAvailable = parameterIndex(config.lipSync.parameter) >= 0;
  if (!lipSyncAvailable) {
    console.warn(`[fay] 模型缺少口型参数 ${config.lipSync.parameter}，口型将不可见`);
  }

  function setParameter(id, value) {
    const core = coreModel();
    if (!core || typeof core.setParameterValueById !== 'function') return;
    try {
      core.setParameterValueById(id, value);
    } catch (error) {
      /* 模型缺少该参数时忽略 */
    }
  }

  /** 把模型缩放到画布：以高度为准适配，config.scale 作为相对倍数。 */
  function fitModel(width, height) {
    if (!model) return null;
    const bounds = model.getLocalBounds();
    const modelWidth = bounds.width || model.width || 1;
    const modelHeight = bounds.height || model.height || 1;
    if (modelHeight < 1) return null;
    const fit = (height * 0.92) / modelHeight;
    model.scale.set(fit * config.scale);
    const scaledWidth = modelWidth * fit * config.scale;
    const scaledHeight = modelHeight * fit * config.scale;
    // Live2D 模型的变换原点在「底边中心」（实测 getBounds 验证），因此直接把原点放到画布底部中心
    model.position.set(width / 2 + config.position[0], height + config.position[1]);
    state.fit = {
      fit,
      scaledWidth,
      scaledHeight,
      modelWidth,
      modelHeight,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      position: { x: model.position.x, y: model.position.y },
      scale: model.scale.x,
      canvas: { width, height },
      onScreen: model.getBounds(),
    };
    return state.fit;
  }

  function playMotion(kind) {
    const spec = config.motions[kind];
    if (!spec || !model?.motion) return;
    try {
      model.motion(spec.group, spec.index ?? undefined);
    } catch (error) {
      console.warn('[fay] 动作播放失败', kind, error);
    }
  }

  function setExpression(name) {
    const id = config.expressions[name];
    if (!id || !model?.expression) return;
    try {
      model.expression(id);
    } catch (error) {
      /* 模型没有该表情时忽略 */
    }
  }

  function playAction(action) {
    const resolved = resolveAction(config, action);
    if (!resolved) return;
    state.lastAction = action;
    if (resolved.motion) playMotion(resolved.motion);
    if (resolved.expression) setExpression(resolved.expression);
  }

  // 口型驱动：挂在动作/物理更新「之后」，保证每帧最后写入的是我们的口型值
  // （模型动作（如官方 Idle）可能也带 ParamMouthOpenY 关键帧，必须在它们之后覆盖）
  function applyMouth() {
    const { minOpen = 0, maxOpen = 1 } = config.lipSync;
    const target = state.speaking ? Math.min(1, state.energy * (config.lipSync.volume || 1)) : 0;
    state.mouth += (target - state.mouth) * 0.45;
    const value = minOpen + (maxOpen - minOpen) * state.mouth;
    setParameter(config.lipSync.parameter, value);
    state.mouthWrites = (state.mouthWrites || 0) + 1;
    state.lastWritten = value;
    state.lastWrittenAt = performance.now();
  }

  const internal = model.internalModel;
  if (internal && typeof internal.update === 'function') {
    const originalUpdate = internal.update.bind(internal);
    internal.update = (...args) => {
      originalUpdate(...args);
      applyMouth();
    };
  } else {
    app.ticker.add(applyMouth);
  }

  function createStub() {
    return {
      hasModel: false,
      ready: false,
      setEnergy() {},
      setSpeaking() {},
      setNight() {},
      update() {},
      render() {},
      resize() {},
      focus() {},
      playAction() {},
      speakSentence() {},
      stopSpeaking() {},
    };
  }

  return {
    hasModel: true,
    ready: true,
    get config() {
      return config;
    },
    setEnergy(value) {
      state.energy = Math.max(0, Math.min(1, value));
    },
    setSpeaking(value) {
      const next = Boolean(value);
      if (next && !state.speaking) playMotion('speak');
      if (!next && state.speaking) playMotion('idle');
      state.speaking = next;
      if (state.app?.ticker) state.app.ticker.maxFPS = next ? 60 : 30;
    },
    setNight(nightFactor) {
      state.nightFactor = nightFactor;
      const { brightness, saturation } = config.night;
      if (container) {
        const b = 1 - (1 - brightness) * nightFactor;
        const s = 1 - (saturation - 1) * nightFactor * 0.5;
        container.style.filter = `brightness(${b.toFixed(3)}) saturate(${s.toFixed(3)})`;
      }
    },
    update(delta) {
      // 呼吸/摇摆由模型自带的 Idle 动作负责，这里不再改 position（否则会破坏自适应）
      state.time += delta;
    },
    render() {
      /* PIXI 自行渲染 */
    },
    resize(width, height) {
      if (!state.app) return;
      try {
        state.app.renderer.resize(width, height);
        fitModel(width, height);
      } catch (error) {
        console.warn('[fay] 调整 Live2D 尺寸失败', error);
      }
    },
    focus(x, y) {
      if (!model?.focus) return;
      try {
        model.focus(x, y);
      } catch (error) {
        /* 忽略 */
      }
    },
    playAction,
    debug() {
      return {
        hasModel: state.hasModel,
        mouthParameter: config.lipSync.parameter,
        mouthIndex: parameterIndex(config.lipSync.parameter),
        mouthValue: parameterValue(config.lipSync.parameter),
        speaking: state.speaking,
        energy: state.energy,
        mouthWrites: state.mouthWrites || 0,
        lastWritten: state.lastWritten ?? null,
        fit: state.fit
          ? {
              mouthWrites: state.mouthWrites || 0,
        lastWritten: state.lastWritten ?? null,
        fit: state.fit.fit,
              scaledWidth: state.fit.scaledWidth,
              scaledHeight: state.fit.scaledHeight,
              bounds: state.fit.bounds,
              position: state.fit.position,
              canvas: state.fit.canvas,
              onScreen: {
                x: state.fit.onScreen?.x,
                y: state.fit.onScreen?.y,
                width: state.fit.onScreen?.width,
                height: state.fit.onScreen?.height,
              },
            }
          : null,
        canvas: state.app
          ? { width: state.app.renderer.width, height: state.app.renderer.height }
          : null,
      };
    },
    /** 回读模型渲染出的像素，用于验证"确实画出来了"。 */
    measure() {
      if (!state.model || !state.app?.renderer?.extract) return null;
      try {
        // PixiJS v6 返回 Uint8Array，v7 返回 {pixels,width,height}
        const result = state.app.renderer.extract.pixels(state.model);
        const pixels = result?.pixels ?? result;
        if (!pixels || typeof pixels.length !== 'number') {
          return { error: 'extract 返回空' };
        }
        const bounds = model.getBounds();
        const width = result?.width || Math.round(bounds.width) || 1;
        const height = result?.height || Math.round(bounds.height) || 1;
        let opaque = 0;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] > 10) opaque += 1;
        }
        const area = Math.min(pixels.length / 4, width * height) || 1;
        return { width, height, opaque, ratio: opaque / area };
      } catch (error) {
        return { error: String(error) };
      }
    },
    speakSentence({ action } = {}) {
      if (action) playAction(action);
    },
    stopSpeaking() {
      state.speaking = false;
      state.energy = 0;
    },
  };
}
