// 中国浮雕沙盘：CPU 生成高度场与国境遮罩，GPU 逐片元按真实经纬度计算日照。

import * as THREE from 'three';
import { NOISE_GLSL, SOLAR_GLSL } from './shaders.js';
import { GROUND as GROUND_SIZE, PALETTE, STAGE } from './config.js';
import { project } from './geo.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RANGES } from './data/ranges.js';
import { solarUniforms } from './lighting.js';

export const LNG_RANGE = [73, 135];
export const LAT_RANGE = [18, 53];

const KM_PER_DEG_LAT = 110.57;
const KM_PER_DEG_LNG = 111.32 * Math.cos((35 * Math.PI) / 180);

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

function ridgedNoise(x, y, octaves = 4) {
  let total = 0;
  let amplitude = 0.5;
  let sum = 0;
  let px = x;
  let py = y;
  for (let i = 0; i < octaves; i += 1) {
    const n = valueNoise(px, py);
    total += (1 - Math.abs(2 * n - 1)) ** 2 * amplitude;
    sum += amplitude;
    px *= 2.02;
    py *= 2.02;
    amplitude *= 0.5;
  }
  return total / sum;
}

function spineMetrics(lng, lat, spine) {
  const px = lng * KM_PER_DEG_LNG;
  const py = lat * KM_PER_DEG_LAT;
  let bestDistance = Infinity;
  let bestAlong = 0;
  let accumulated = 0;
  let total = 0;
  const segments = [];
  for (let i = 0; i < spine.length - 1; i += 1) {
    const x1 = spine[i][0] * KM_PER_DEG_LNG;
    const y1 = spine[i][1] * KM_PER_DEG_LAT;
    const x2 = spine[i + 1][0] * KM_PER_DEG_LNG;
    const y2 = spine[i + 1][1] * KM_PER_DEG_LAT;
    const length = Math.hypot(x2 - x1, y2 - y1);
    segments.push({ x1, y1, x2, y2, length });
    total += length;
  }
  for (const segment of segments) {
    const { x1, y1, x2, y2, length } = segment;
    const dx = x2 - x1;
    const dy = y2 - y1;
    let t = 0;
    if (length > 0) t = ((px - x1) * dx + (py - y1) * dy) / (length * length);
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const distance = Math.hypot(px - cx, py - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = total > 0 ? (accumulated + t * length) / total : 0;
    }
    accumulated += length;
  }
  return { distance: bestDistance, along: bestAlong };
}

function ridgeEnvelope(along) {
  const head = Math.min(1, Math.max(0, along / 0.14));
  const tail = Math.min(1, Math.max(0, (1 - along) / 0.14));
  return head * head * (3 - 2 * head) * (tail * tail * (3 - 2 * tail));
}

/** 相对高度 0..1，叠加十条主脊。 */
export function heightAt(lng, lat, ranges = RANGES) {
  let height = 0;
  for (const range of ranges) {
    const { distance, along } = spineMetrics(lng, lat, range.spine);
    if (distance > range.widthKm * 1.8) continue;
    const profile = Math.exp(-((distance / range.widthKm) ** 2) * 2.1);
    const envelope = ridgeEnvelope(along);
    if (profile * envelope < 0.004) continue;
    const ridged = ridgedNoise(lng * 2.6, lat * 2.6, 4);
    const detail = 0.42 + 0.58 * (ridged * range.roughness + (1 - range.roughness) * 0.6);
    const saddle = 0.82 + 0.18 * valueNoise(lng * 0.9 + 11.3, lat * 0.9 + 7.1);
    height += range.peak * profile * envelope * detail * saddle;
  }
  return Math.min(height, 1.5) / 1.5;
}

/** 经纬度 → 网格 uv（与地形顶点 uv 一致）。 */
export function gridUv(lng, lat) {
  return {
    u: (lng - LNG_RANGE[0]) / (LNG_RANGE[1] - LNG_RANGE[0]),
    v: (lat - LAT_RANGE[0]) / (LAT_RANGE[1] - LAT_RANGE[0]),
  };
}

/** 经纬度 → 世界坐标（y 轴向上，北为 -z）。 */
export function worldPosition(lng, lat, ranges = RANGES, lift = 0) {
  const point = project(lng, lat);
  return new THREE.Vector3(point.x, heightAt(lng, lat, ranges) * STAGE.relief + lift, -point.y);
}

/** 把国境多边形画进离屏画布，得到陆地遮罩（供地形透明度使用）。 */
export function buildLandMask(rings, width = 512, height = 288) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([lng, lat], index) => {
      const uv = gridUv(lng, lat);
      const px = uv.u * width;
      const py = (1 - uv.v) * height;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');

  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    width,
    height,
    /** 双线性采样，返回 0..1 的陆地权重。 */
    sample(u, v) {
      const x = Math.min(width - 1.001, Math.max(0, u * width));
      const y = Math.min(height - 1.001, Math.max(0, (1 - v) * height));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const at = (px, py) => data[(py * width + px) * 4 + 3] / 255;
      const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
      const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    },
  };
}

const TERRAIN_VERTEX = /* glsl */ `
  attribute float aLng;
  attribute float aLat;
  attribute float aLand;
  attribute float aHeight;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vLng;
  varying float vLat;
  varying float vLand;
  varying float vHeight;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vNormal = normal;
    vLng = aLng;
    vLat = aLat;
    vLand = aLand;
    vHeight = aHeight;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TERRAIN_FRAGMENT = /* glsl */ `
  ${NOISE_GLSL}
  ${SOLAR_GLSL}

  uniform vec3 uLand;
  uniform vec3 uLandHigh;
  uniform vec3 uRidge;
  uniform vec3 uPaper;
  uniform float uRelief;
  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vLng;
  varying float vLat;
  varying float vLand;
  varying float vHeight;
  varying vec3 vWorldPos;

  const vec3 DAY_COLOR = vec3(1.000, 0.953, 0.878);
  const vec3 LOW_COLOR = vec3(1.000, 0.729, 0.439);
  const vec3 DUSK_COLOR = vec3(0.612, 0.498, 0.659);
  const vec3 MOON_COLOR = vec3(0.231, 0.290, 0.420);

  void main() {
    float alt = sunAltitudeAt(vLng, vLat);
    float az = radians(sunAzimuthAt(vLng, vLat));
    float altitude = radians(alt);

    // 场景坐标：x 向东，y 向上，z 向南（北为 -z）
    vec3 sunDir = vec3(cos(altitude) * sin(az), sin(altitude), -cos(altitude) * cos(az));
    vec3 lightDir = sunDir;
    if (alt < 0.0) {
      lightDir = normalize(vec3(-sunDir.x, max(0.22, abs(sunDir.y) * 0.55), -sunDir.z));
    }

    vec3 n = normalize(vNormal);
    float lambert = max(dot(n, lightDir), 0.0);
    float sky = 0.5 + 0.5 * n.y;

    float dayMix = smoothstep(2.0, 16.0, alt);
    float lowMix = smoothstep(-4.0, 2.0, alt);
    float dayness = smoothstep(-14.0, -4.0, alt);
    vec3 warm = mix(LOW_COLOR, DAY_COLOR, dayMix);
    vec3 tint = mix(MOON_COLOR, mix(DUSK_COLOR, warm, lowMix), dayness);
    float intensity = mix(0.14, 1.0, smoothstep(-14.0, 14.0, alt));

    float heightRatio = clamp(vHeight, 0.0, 1.0);
    vec3 base = mix(uLand, uLandHigh, smoothstep(0.05, 0.75, heightRatio));
    base = mix(base, uRidge, smoothstep(0.45, 1.0, heightRatio));

    float ink = fbm(vUv * vec2(26.0, 15.0), 3);
    vec3 color = base * (uAmbientColor * (uAmbientIntensity * 1.75) + tint * intensity * (0.5 + 0.9 * lambert));
    color *= 0.9 + 0.25 * ink;
    color += uPaper * sky * intensity * 0.05 * (0.4 + heightRatio);

    // 高处的雪线
    color = mix(color, uPaper, smoothstep(0.78, 1.0, heightRatio) * (0.25 + 0.35 * lambert) * dayness);

    // 黄金时刻：太阳低角度时地平线附近的暖光（平坦地形也能感到"早上/傍晚"）
    float golden = smoothstep(-4.0, 3.0, alt) * (1.0 - smoothstep(6.0, 26.0, alt));
    color += vec3(1.0, 0.72, 0.45) * golden * 0.16;

    // 地平线附近的暖带
    float twilight = smoothstep(-10.0, -1.0, alt) * (1.0 - smoothstep(0.0, 7.0, alt));
    color += mix(uPaper, vec3(1.0, 0.68, 0.38), 0.6) * twilight * 0.18 * (0.3 + heightRatio);

    float landAlpha = clamp(vLand * 1.25, 0.0, 1.0);
    float reliefAlpha = smoothstep(0.03, 0.3, heightRatio);
    float alpha = max(landAlpha, reliefAlpha) * uOpacity;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * 生成浮雕地形。
 * @returns {{ mesh: THREE.Mesh, material: THREE.ShaderMaterial }}
 */
export function buildTerrain(rings, { cols = STAGE.grid.cols, rows = STAGE.grid.rows, ranges = RANGES } = {}) {
  const mask = buildLandMask(rings);
  const count = cols * rows;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const lngs = new Float32Array(count);
  const lats = new Float32Array(count);
  const lands = new Float32Array(count);
  const heights = new Float32Array(count);
  const heightField = new Float32Array(count);
  const xs = new Float32Array(count);
  const zs = new Float32Array(count);

  for (let row = 0; row < rows; row += 1) {
    const v = row / (rows - 1);
    const lat = LAT_RANGE[0] + (LAT_RANGE[1] - LAT_RANGE[0]) * v;
    for (let col = 0; col < cols; col += 1) {
      const u = col / (cols - 1);
      const lng = LNG_RANGE[0] + (LNG_RANGE[1] - LNG_RANGE[0]) * u;
      const index = row * cols + col;
      const point = project(lng, lat);
      const height = heightAt(lng, lat, ranges);
      const y = height * STAGE.relief;

      xs[index] = point.x;
      zs[index] = -point.y;
      heightField[index] = y;
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = -point.y;
      uvs[index * 2] = u;
      uvs[index * 2 + 1] = v;
      lngs[index] = lng;
      lats[index] = lat;
      lands[index] = mask.sample(u, v);
      heights[index] = height;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const left = row * cols + Math.max(0, col - 1);
      const right = row * cols + Math.min(cols - 1, col + 1);
      const down = Math.max(0, row - 1) * cols + col;
      const up = Math.min(rows - 1, row + 1) * cols + col;

      const dx = xs[right] - xs[left] || 0.0001;
      const dz = zs[up] - zs[down] || -0.0001;
      const nx = -(heightField[right] - heightField[left]) / dx;
      const nz = -(heightField[up] - heightField[down]) / dz;
      const length = Math.hypot(nx, 1, nz) || 1;
      normals[index * 3] = nx / length;
      normals[index * 3 + 1] = 1 / length;
      normals[index * 3 + 2] = nz / length;
    }
  }

  const indices = [];
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aLng', new THREE.BufferAttribute(lngs, 1));
  geometry.setAttribute('aLat', new THREE.BufferAttribute(lats, 1));
  geometry.setAttribute('aLand', new THREE.BufferAttribute(lands, 1));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    uniforms: {
      ...solarUniforms(),
      uLand: { value: new THREE.Color(PALETTE.land) },
      uLandHigh: { value: new THREE.Color(PALETTE.landHigh) },
      uRidge: { value: new THREE.Color(PALETTE.ridge) },
      uPaper: { value: new THREE.Color(PALETTE.paper) },
      uRelief: { value: STAGE.relief },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}

/** 国境与省界描边：加粗线（像素宽度），在小比例下依然清晰。 */
export function buildBorders(
  rings,
  { lift = 0.02, color = PALETTE.paper, opacity = 0.62, linewidth = 2.4 } = {},
) {
  const positions = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [lng1, lat1] = ring[i];
      const [lng2, lat2] = ring[i + 1];
      const a = project(lng1, lat1);
      const b = project(lng2, lat2);
      positions.push(a.x, lift, -a.y, b.x, lift, -b.y);
    }
  }
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const material = new LineMaterial({
    color: new THREE.Color(color),
    linewidth,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  const lines = new LineSegments2(geometry, material);
  lines.frustumCulled = false;
  return { object: lines, material };
}


const GROUND_VERTEX = /* glsl */ `
  varying vec2 vPlane;
  varying float vWorldX;

  void main() {
    vPlane = position.xy;
    vWorldX = position.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  ${NOISE_GLSL}
  ${SOLAR_GLSL}

  uniform float uTime;
  uniform float uLngPerX;
  uniform float uLngAtZero;
  uniform vec3 uInk;
  uniform vec3 uPaper;

  varying vec2 vPlane;
  varying float vWorldX;

  void main() {
    // 以世界尺度计算光池，改地面尺寸也不会变形
    float r = length(vec2(vPlane.x / 6.4, vPlane.y / 4.4));
    float pool = smoothstep(1.05, 0.05, r);
    vec2 cloudUv = vPlane * 0.16;
    float clouds = fbm(cloudUv + vec2(uTime * 0.004, 0.0), 3);
    float fine = fbm(cloudUv * 3.6, 2);

    float lng = clamp(uLngAtZero + vWorldX * uLngPerX, 60.0, 150.0);
    float alt = sunAltitudeAt(lng, 35.0);
    float localNight = smoothstep(3.0, -8.0, alt);
    float twilight = smoothstep(-10.0, -1.0, alt) * (1.0 - smoothstep(0.0, 8.0, alt));

    vec3 base = mix(uInk, uMountainColor(), clouds * 0.55) * (0.7 + 0.5 * fine);
    vec3 glow = mix(vec3(0.16, 0.26, 0.30), vec3(0.03, 0.06, 0.09), localNight);
    vec3 color = base + glow * pool * 1.5;
    color += vec3(1.0, 0.72, 0.42) * twilight * pool * 0.10;
    color += uPaper * pool * (1.0 - localNight) * 0.02;

    float alpha = smoothstep(1.1, 0.0, r) * (0.40 + 0.3 * clouds);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`.replace('uMountainColor()', 'vec3(0.086, 0.196, 0.227)');

/** 舞台地面：中心光池 + 墨云纹理，并随时段与经度改变色调。 */
export function buildGround() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE.width, GROUND_SIZE.depth, 72, 52),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        ...solarUniforms(),
        uTime: { value: 0 },
        uLngPerX: { value: 0 },
        uLngAtZero: { value: 105 },
        uInk: { value: new THREE.Color(PALETTE.inkDeep) },
        uPaper: { value: new THREE.Color(PALETTE.paper) },
      },
      vertexShader: GROUND_VERTEX,
      fragmentShader: GROUND_FRAGMENT,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.075;
  mesh.frustumCulled = false;
  return { mesh, material: mesh.material };
}

/** 空气中缓慢上浮的尘埃微粒，夜间更明显。 */
export function createDust(count = 760) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 17;
    positions[i * 3 + 1] = Math.random() * 5.6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 13 - 1.5;
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2.8, 0), 20);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uNightFactor: { value: 0 },
      uOpacity: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uNightFactor;
      varying float vSeed;
      void main() {
        vSeed = aSeed;
        vec3 pos = position;
        pos.y = mod(position.y + uTime * (0.045 + 0.05 * aSeed), 5.6);
        pos.x += sin(uTime * 0.12 + aSeed * 31.0) * 0.3;
        pos.z += cos(uTime * 0.09 + aSeed * 17.0) * 0.22;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = (1.1 + fract(aSeed * 7.0) * 2.0) * (1.0 + uNightFactor * 0.7) * (6.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNightFactor;
      uniform float uOpacity;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = smoothstep(1.0, 0.0, d) * uOpacity;
        vec3 warm = mix(vec3(0.75, 0.82, 0.9), vec3(1.0, 0.84, 0.55), uNightFactor);
        gl_FragColor = vec4(warm, alpha * (0.5 + 0.5 * fract(vSeed * 13.0)));
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, material };
}


/** 天穹：大球内侧的渐变背景，保证任何视角都不会看到纯黑。 */
export function buildSky() {
  const geometry = new THREE.SphereGeometry(120, 48, 32);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      ...solarUniforms(),
      uTop: { value: new THREE.Color('#0a151c') },
      uHorizon: { value: new THREE.Color('#16242b') },
      uGround: { value: new THREE.Color(PALETTE.inkDeep) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SOLAR_GLSL}
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      varying vec3 vDir;

      void main() {
        float h = vDir.y;
        vec3 sky = mix(uHorizon, uTop, smoothstep(0.0, 0.75, h));
        vec3 color = mix(uGround, sky, smoothstep(-0.28, 0.06, h));
        color *= mix(0.72, 1.0, 1.0 - uNightFactor * 0.55);
        color += uSunColor * uSunIntensity * smoothstep(0.25, -0.05, abs(h)) * 0.05;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, material };
}
