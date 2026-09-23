// 光照 uniform 工具：把 JS 端算好的太阳状态喂给自定义着色器。

import * as THREE from 'three';
import { PALETTE } from './config.js';

export function solarUniforms() {
  return {
    uDeclination: { value: 0 },
    uEoT: { value: 0 },
    uUTCHours: { value: 0 },
    uSunColor: { value: new THREE.Color(PALETTE.sunDay) },
    uAmbientColor: { value: new THREE.Color(PALETTE.skyDay) },
    uSunIntensity: { value: 1 },
    uAmbientIntensity: { value: 0.5 },
    uNightFactor: { value: 0 },
  };
}

export function applySolarUniforms(material, state) {
  const uniforms = material.uniforms;
  uniforms.uDeclination.value = state.geometry.declination;
  uniforms.uEoT.value = state.geometry.equationOfTime;
  uniforms.uUTCHours.value = state.utcHours;
  uniforms.uSunColor.value.setRGB(...state.sunRgb);
  uniforms.uAmbientColor.value.setRGB(...state.ambientRgb);
  uniforms.uSunIntensity.value = state.sunIntensity;
  uniforms.uAmbientIntensity.value = state.ambientIntensity;
  uniforms.uNightFactor.value = state.nightFactor;
}
