// 敦煌风格壁画地台：紧贴沙盘的矩形纹样边框（联珠/卷草/忍冬 + 四角藻井），
// 外圈再铺莲花、云气与飘带。纹样都落在默认视角可见的范围内。

import * as THREE from 'three';
import { NOISE_GLSL, SOLAR_GLSL } from './shaders.js';
import { PALETTE } from './config.js';
import { solarUniforms } from './lighting.js';

const EARTH = '#7a4130';
const OCHRE = '#a25a33';
const AZURITE = '#2e6e8e';
const MALACHITE = '#3f7f63';
const GOLD = '#d4ab34';
const CHALK = '#efe2c8';

// 世界单位；画布像素与单位换算：PIXELS_PER_UNIT
const MURAL_SIZE = { width: 34, depth: 24, y: -0.2 };
const CANVAS = { width: 2048, height: 1446 };
const PX = CANVAS.width / MURAL_SIZE.width; // ≈ 60.2 像素/单位

function patina(ctx, width, height, seed = 11) {
  let value = seed;
  const random = () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
  for (let i = 0; i < 1500; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const r = 4 + random() * 30;
    ctx.fillStyle =
      random() > 0.45
        ? `rgba(56, 28, 18, ${0.02 + random() * 0.07})`
        : `rgba(232, 206, 164, ${0.02 + random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 260; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const r = 3 + random() * 11;
    ctx.fillStyle = `rgba(36, 18, 12, ${0.05 + random() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + random()), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function beadRun(ctx, x1, y1, x2, y2, { gap = 14, radius = 5, colors = [GOLD, CHALK] } = {}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const count = Math.max(2, Math.floor(length / gap));
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    ctx.fillStyle = colors[0];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors[1];
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 沿矩形路径画卷草纹（带叶片）。 */
function vineRun(ctx, x1, y1, x2, y2, { amplitude = 8, periods = 14, color = MALACHITE, leaf = AZURITE } = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const nx = -dy / (length || 1);
  const ny = dx / (length || 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  const steps = Math.max(32, Math.floor(length / 6));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const wave = Math.sin(t * Math.PI * 2 * periods) * amplitude;
    const x = x1 + dx * t + nx * wave;
    const y = y1 + dy * t + ny * wave;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.lineWidth = 1;
  for (let i = 0; i < periods; i += 1) {
    const t = (i + 0.5) / periods;
    const wave = Math.sin(t * Math.PI * 2 * periods) * amplitude;
    const x = x1 + dx * t + nx * (wave + 10);
    const y = y1 + dy * t + ny * (wave + 10);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx) + (i % 2 ? 0.5 : -0.5));
    ctx.fillStyle = leaf;
    ctx.beginPath();
    ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function honeysuckleRun(ctx, x1, y1, x2, y2, { size = 11, gap = 30, color = CHALK } = {}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const count = Math.max(2, Math.floor(length / gap));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    for (let k = -1; k <= 1; k += 1) {
      ctx.beginPath();
      ctx.arc(x + k * size * 0.6, y, size * 0.45, Math.PI * 0.1, Math.PI * 1.15);
      ctx.stroke();
    }
  }
}

function lotus(ctx, x, y, radius, petalColor = CHALK, coreColor = GOLD) {
  for (let ring = 0; ring < 2; ring += 1) {
    const r = radius * (ring === 0 ? 1 : 0.62);
    const petals = ring === 0 ? 12 : 8;
    ctx.fillStyle = ring === 0 ? petalColor : AZURITE;
    for (let i = 0; i < petals; i += 1) {
      const angle = (i / petals) * Math.PI * 2 + ring * 0.3;
      ctx.save();
      ctx.translate(x + Math.cos(angle) * r * 0.55, y + Math.sin(angle) * r * 0.55);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = coreColor;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function caisson(ctx, x, y, size) {
  for (let i = 0; i < 4; i += 1) {
    const s = size * (1 - i * 0.2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.PI / 4) * i);
    ctx.strokeStyle = [GOLD, AZURITE, MALACHITE, CHALK][i];
    ctx.lineWidth = i === 0 ? 4 : 2.6;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  lotus(ctx, x, y, size * 0.3, CHALK, GOLD);
}

function cloudScroll(ctx, x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.42, Math.PI * 0.2, Math.PI * 1.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.12, size * 0.3, Math.PI, Math.PI * 2.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - size * 0.65, y + size * 0.42);
  ctx.quadraticCurveTo(x - size * 1.5, y + size * 0.7, x - size * 2.4, y + size * 0.25);
  ctx.stroke();
}

function ribbon(ctx, x, y, length, angle, color, alpha = 0.55) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k += 1) {
    ctx.lineWidth = 4.5 - k * 1.2;
    ctx.beginPath();
    ctx.moveTo(0, k * 5 - 5);
    ctx.bezierCurveTo(length * 0.35, -18 + k * 8, length * 0.7, 22 - k * 7, length, -4 + k * 4);
    ctx.stroke();
  }
  ctx.restore();
}

export function buildMuralTexture() {
  const { width, height } = CANVAS;
  const cx = width / 2;
  const cy = height / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const base = ctx.createRadialGradient(cx, cy, 60, cx, cy, width * 0.6);
  base.addColorStop(0, OCHRE);
  base.addColorStop(0.5, EARTH);
  base.addColorStop(1, '#5b2c21');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  patina(ctx, width, height);

  // 紧贴沙盘的矩形边框：内 ±2.45/±1.85 单位，外 ±3.05/±2.35 单位
  const inner = { x: 2.45 * PX, y: 1.85 * PX };
  const outer = { x: 3.05 * PX, y: 2.35 * PX };
  const rect = (halfX, halfY) => [
    [cx - halfX, cy - halfY],
    [cx + halfX, cy - halfY],
    [cx + halfX, cy + halfY],
    [cx - halfX, cy + halfY],
  ];
  const innerR = rect(inner.x, inner.y);
  const outerR = rect(outer.x, outer.y);

  // 外圈粗：联珠 + 卷草；内圈细：忍冬
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = outerR[i];
    const [x2, y2] = outerR[(i + 1) % 4];
    beadRun(ctx, x1, y1, x2, y2, { gap: 15, radius: 6 });
  }
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = outerR[i];
    const [x2, y2] = outerR[(i + 1) % 4];
    vineRun(ctx, x1, y1, x2, y2, { amplitude: 9, periods: Math.max(6, Math.round(Math.hypot(x2 - x1, y2 - y1) / 90)) });
  }
  for (let i = 0; i < 4; i += 1) {
    const [x1, y1] = innerR[i];
    const [x2, y2] = innerR[(i + 1) % 4];
    honeysuckleRun(ctx, x1, y1, x2, y2, { size: 12, gap: 34 });
  }

  // 四角藻井
  const corners = [
    [cx - outer.x - 46, cy - outer.y - 46],
    [cx + outer.x + 46, cy - outer.y - 46],
    [cx + outer.x + 46, cy + outer.y + 46],
    [cx - outer.x - 46, cy + outer.y + 46],
  ];
  corners.forEach(([x, y]) => caisson(ctx, x, y, 104));

  // 外圈放射纹样（4.3~6.5 单位，拉远时可见）
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    lotus(ctx, cx + Math.cos(angle) * 4.6 * PX, cy + Math.sin(angle) * 4.6 * PX, 30, CHALK, GOLD);
  }
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    cloudScroll(ctx, cx + Math.cos(angle) * 5.8 * PX, cy + Math.sin(angle) * 5.2 * PX, 38, 'rgba(238, 224, 198, 0.5)');
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ribbon(ctx, cx + Math.cos(angle) * 3.6 * PX, cy + Math.sin(angle) * 3.6 * PX, 150, angle, GOLD, 0.5);
  }

  // 中央掏空：只保留沙盘范围之外
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  ctx.beginPath();
  const halfX = 2.18 * PX;
  const halfY = 1.62 * PX;
  ctx.ellipse(cx, cy, halfX, halfY, 0, 0, Math.PI * 2);
  ctx.fill();

  // 掏空边缘羽化
  const feather = ctx.createRadialGradient(cx, cy, Math.min(halfX, halfY) * 0.82, cx, cy, Math.max(halfX, halfY) * 1.12);
  feather.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  feather.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, halfX * 1.12, halfY * 1.12, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = feather;
  ctx.fillRect(cx - halfX * 1.2, cy - halfY * 1.2, halfX * 2.4, halfY * 2.4);
  ctx.restore();

  // 外围淡出
  const edge = ctx.createRadialGradient(cx, cy, 6.2 * PX, cx, cy, 11 * PX);
  edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edge.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** 壁画地台：铺在沙盘四周，随时间段整体变暗或微亮。 */
export function createMural() {
  const texture = buildMuralTexture();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...solarUniforms(),
      uMap: { value: texture },
      uDim: { value: 0.92 },
      uTime: { value: 0 },
      uLngPerX: { value: 0 },
      uLngAtZero: { value: 105 },
      uInk: { value: new THREE.Color(PALETTE.inkDeep) },
      uWarm: { value: new THREE.Color('#e8c79a') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vWorldX;
      void main() {
        vUv = uv;
        vWorldX = position.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      ${SOLAR_GLSL}

      uniform sampler2D uMap;
      uniform float uDim;
      uniform float uTime;
      uniform float uLngPerX;
      uniform float uLngAtZero;
      uniform vec3 uInk;
      uniform vec3 uWarm;

      varying vec2 vUv;
      varying float vWorldX;

      void main() {
        vec4 texel = texture2D(uMap, vUv);
        if (texel.a < 0.01) discard;

        float lng = clamp(uLngAtZero + vWorldX * uLngPerX, 60.0, 150.0);
        float alt = sunAltitudeAt(lng, 35.0);
        float localNight = smoothstep(3.0, -8.0, alt);
        float lamp = mix(0.62, 0.22, localNight);

        vec3 color = texel.rgb * lamp;
        color = mix(color, uInk, 0.18 * (1.0 - localNight));
        color += uWarm * (1.0 - localNight) * 0.06;

        float grain = fbm(vUv * vec2(160.0, 120.0) + uTime * 0.01, 2);
        color *= 0.9 + 0.2 * grain;

        gl_FragColor = vec4(color, texel.a * uDim);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(MURAL_SIZE.width, MURAL_SIZE.depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = MURAL_SIZE.y;
  mesh.frustumCulled = false;
  return { mesh, material };
}
