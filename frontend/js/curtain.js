// 舞台后方的水墨幕布：两片对开，拉开时露出后墙，为整个场景提供幕布质感与日照氛围。

import * as THREE from 'three';
import { NOISE_GLSL, SOLAR_GLSL } from './shaders.js';
import { BACKDROP, PALETTE } from './config.js';
import { solarUniforms } from './lighting.js';

const SEGMENTS_X = 120;
const SEGMENTS_Y = 48;

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uOpen;
  uniform float uSide;
  uniform float uInner;
  uniform float uBaseX;
  uniform float uFoldCount;
  uniform float uFoldDepth;
  uniform float uSpread;

  varying vec2 vLocalUv;
  varying float vFold;
  varying float vDistFromInner;

  void main() {
    vLocalUv = uv;
    vec3 pos = position;

    float t = uTime * 0.36;
    float distFromInner = abs(uv.x - uInner);
    vDistFromInner = distFromInner;

    float pleat = sin(uv.x * 3.14159265 * uFoldCount) * 0.5 + 0.5;
    float breath = sin(uv.x * 6.2831853 * 0.6 + t * 0.5) * 0.5 + 0.5;
    float drape = 0.7 + 0.3 * sin(uv.y * 2.6 - t * 0.3);
    float depth = (pleat * 0.8 + breath * 0.2) * drape * (1.0 - uOpen * 0.5);

    pos.z += depth * uFoldDepth;
    pos.x += uSide * uOpen * (uSpread * (0.85 + 0.3 * distFromInner));

    vFold = depth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  ${NOISE_GLSL}
  ${SOLAR_GLSL}

  uniform float uTime;
  uniform float uOpen;
  uniform float uStageSpan;
  uniform float uLngPerX;
  uniform float uLngAtZero;
  uniform vec2 uPointerUv;
  uniform vec3 uInkBase;
  uniform vec3 uInkDeep;
  uniform vec3 uMountain;
  uniform vec3 uPaper;

  varying vec2 vLocalUv;
  varying float vFold;
  varying float vDistFromInner;

  void main() {
    float worldX = (vLocalUv.x - 0.5) * uStageSpan;
    float lng = clamp(uLngAtZero + worldX * uLngPerX, 60.0, 150.0);
    float localAltitude = sunAltitudeAt(lng, 35.0);
    float localNight = smoothstep(3.0, -8.0, localAltitude);
    float twilight = smoothstep(-10.0, -1.0, localAltitude) * (1.0 - smoothstep(0.0, 7.0, localAltitude));

    float silk = fbm(vLocalUv * vec2(6.0, 3.2) + vec2(uTime * 0.012, 0.0), 3);
    float fine = fbm(vLocalUv * vec2(30.0, 18.0), 2);

    vec3 dayColor = mix(uInkDeep, uInkBase, silk * 0.6 + 0.3);
    dayColor += uMountain * (0.14 + 0.1 * fine);
    vec3 nightColor = uInkDeep * (0.38 + 0.24 * silk);
    vec3 color = mix(dayColor, nightColor, localNight);
    color += uPaper * (1.0 - localNight) * 0.05;

    float sheen = pow(smoothstep(0.2, 0.95, abs(vFold) * 4.0), 1.5);
    color += mix(uPaper, vec3(0.62, 0.72, 0.86), localNight) * sheen * 0.2;

    color += mix(uPaper, vec3(1.0, 0.68, 0.38), 0.6) * twilight * 0.2;

    // 远山剪影（两层，越远越淡）
    float ridgeFar = 0.34 + 0.05 * fbm(vec2(vLocalUv.x * 2.6, 3.0), 4);
    float ridgeNear = 0.24 + 0.045 * fbm(vec2(vLocalUv.x * 4.4 + 9.0, 7.0), 4);
    float bandFar = 1.0 - smoothstep(ridgeFar - 0.04, ridgeFar + 0.02, vLocalUv.y);
    float bandNear = 1.0 - smoothstep(ridgeNear - 0.03, ridgeNear + 0.02, vLocalUv.y);
    color = mix(color, uInkDeep * 0.85, bandFar * 0.45);
    color = mix(color, uInkDeep * 0.6, bandNear * 0.5);
    // 山脊上的微光
    float crest = 1.0 - smoothstep(0.0, 0.012, abs(vLocalUv.y - ridgeNear));
    color += mix(uPaper, vec3(0.7, 0.8, 0.95), localNight) * crest * 0.10;

    // 夜空星点
    float starCell = hash21(floor(vLocalUv * vec2(420.0, 240.0)));
    float star = step(0.9975, starCell) * smoothstep(0.42, 0.85, vLocalUv.y);
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + starCell * 90.0);
    color += vec3(0.85, 0.9, 1.0) * star * twinkle * uNightFactor * 0.9;

    float spot = smoothstep(0.34, 0.0, distance(vLocalUv, uPointerUv));
    color += uPaper * spot * 0.05 * (1.0 - localNight * 0.6);

    float edge = (1.0 - smoothstep(0.0, 0.22, vDistFromInner)) * uOpen;
    color += mix(uPaper, vec3(1.0, 0.72, 0.42), 0.4) * edge * 0.4;

    // 幕布底边融入地面，顶边略亮
    float vertical = smoothstep(0.06, 0.42, vLocalUv.y);
    float topLight = smoothstep(0.55, 1.0, vLocalUv.y) * 0.35;
    color *= 0.8 + topLight;

    float alpha = mix(0.99, 0.72, edge) * vertical;
    gl_FragColor = vec4(color, alpha);
  }
`;

function backdropMaterial(side) {
  const halfWidth = BACKDROP.width / 2;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      ...solarUniforms(),
      uTime: { value: 0 },
      uOpen: { value: 0 },
      uSide: { value: side },
      uInner: { value: side < 0 ? 1 : 0 },
      uBaseX: { value: side < 0 ? -halfWidth / 2 : halfWidth / 2 },
      uLngPerX: { value: 0 },
      uLngAtZero: { value: 105 },
      uPointerUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSpread: { value: BACKDROP.spread },
      uFoldCount: { value: BACKDROP.foldCount },
      uFoldDepth: { value: BACKDROP.foldDepth },
      uStageSpan: { value: BACKDROP.width },
      uInkBase: { value: new THREE.Color(PALETTE.inkBase) },
      uInkDeep: { value: new THREE.Color(PALETTE.inkDeep) },
      uMountain: { value: new THREE.Color('#16323a') },
      uPaper: { value: new THREE.Color(PALETTE.paper) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
}

export function createBackdrop() {
  const group = new THREE.Group();
  const halfWidth = BACKDROP.width / 2;

  const halves = [-1, 1].map((side) => {
    const geometry = new THREE.PlaneGeometry(halfWidth, BACKDROP.height, SEGMENTS_X, SEGMENTS_Y);
    const material = backdropMaterial(side);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((side * halfWidth) / 2, BACKDROP.height / 2 - 6.2, 0);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { mesh, material };
  });

  group.position.z = BACKDROP.z;
  return { group, halves };
}
