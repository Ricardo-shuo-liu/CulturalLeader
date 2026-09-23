// 共享 GLSL 片段：噪声、天文日照（逐片元按经度计算晨昏线）。

export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p, int octaves) {
  float total = 0.0;
  float amplitude = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    total += valueNoise(p) * amplitude;
    sum += amplitude;
    p *= 2.0;
    amplitude *= 0.5;
  }
  return total / max(sum, 0.0001);
}
`;

export const SOLAR_GLSL = /* glsl */ `
uniform float uDeclination;   // 太阳赤纬（度）
uniform float uEoT;           // 均时差（分钟）
uniform float uUTCHours;      // UTC 小时（含小数）
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uSunIntensity;
uniform float uAmbientIntensity;
uniform float uNightFactor;

const float PI = 3.14159265359;

float sunAltitudeAt(float lng, float lat) {
  float H = radians(15.0 * (uUTCHours + uEoT / 60.0 + lng / 15.0 - 12.0));
  float dec = radians(uDeclination);
  float phi = radians(lat);
  float sinAlt = sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H);
  return degrees(asin(clamp(sinAlt, -1.0, 1.0)));
}

float sunAzimuthAt(float lng, float lat) {
  float H = radians(15.0 * (uUTCHours + uEoT / 60.0 + lng / 15.0 - 12.0));
  float dec = radians(uDeclination);
  float phi = radians(lat);
  float az = degrees(atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)));
  return mod(az + 180.0 + 360.0, 360.0);
}

vec3 sunDirectionAt(float lng, float lat) {
  float alt = radians(sunAltitudeAt(lng, lat));
  float az = radians(sunAzimuthAt(lng, lat));
  return vec3(cos(alt) * sin(az), cos(alt) * cos(az), sin(alt));
}
`;
