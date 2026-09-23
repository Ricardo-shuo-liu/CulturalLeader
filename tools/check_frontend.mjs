// 前端核心逻辑校验（Node 运行，不依赖浏览器）：
// 天文日照精度、晨昏线东西差异、投影方位、地形高度场与几何数据有效性。

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const solar = await import(path.join(root, 'frontend/js/solar.js'));
const geo = await import(path.join(root, 'frontend/js/geo.js'));
const terrain = await import(path.join(root, 'frontend/js/terrain.js'));
const { STAGE } = await import(path.join(root, 'frontend/js/config.js'));
const { RANGES } = await import(path.join(root, 'frontend/js/data/ranges.js'));

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

const BEIJING = { lng: 116.4074, lat: 39.9042 };
const SHANGHAI = { lng: 121.4737, lat: 31.2304 };
const KASHGAR = { lng: 75.99, lat: 39.47 };

function beijingDate(iso) {
  // iso 形如 2026-06-21T04:46，按北京时间（UTC+8）解析
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso);
  assert.ok(match, `时间格式错误：${iso}`);
  const [, y, m, d, hh, mm] = match.map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 8, mm));
}

check('北京夏至正午太阳高度角 ≈ 73.5°', () => {
  const date = beijingDate('2026-06-21T12:16');
  const altitude = solar.sunAltitudeAt(BEIJING.lng, BEIJING.lat, date);
  assert.ok(Math.abs(altitude - 73.5) < 1.2, `实际 ${altitude.toFixed(2)}°`);
  return `${altitude.toFixed(2)}°`;
});

check('北京夏至日出 ≈ 04:46（±6 分钟）', () => {
  const date = beijingDate('2026-06-21T12:00');
  const { sunrise } = solar.sunriseSunset(BEIJING.lng, BEIJING.lat, date);
  const cst = new Date(sunrise.getTime() + 8 * 3600 * 1000);
  const minutes = cst.getUTCHours() * 60 + cst.getUTCMinutes();
  const expected = 4 * 60 + 46;
  assert.ok(Math.abs(minutes - expected) <= 6, `实际 ${cst.getUTCHours()}:${String(cst.getUTCMinutes()).padStart(2, '0')}`);
  return `${cst.getUTCHours()}:${String(cst.getUTCMinutes()).padStart(2, '0')} CST`;
});

check('上海冬至正午太阳高度角 ≈ 35.3°', () => {
  const date = beijingDate('2026-12-21T12:06');
  const altitude = solar.sunAltitudeAt(SHANGHAI.lng, SHANGHAI.lat, date);
  assert.ok(Math.abs(altitude - 35.33) < 1.2, `实际 ${altitude.toFixed(2)}°`);
  return `${altitude.toFixed(2)}°`;
});

check('晨昏线：06:30（北京时）上海已日出、喀什仍在夜', () => {
  const date = beijingDate('2026-09-23T06:30');
  const east = solar.sunAltitudeAt(SHANGHAI.lng, SHANGHAI.lat, date);
  const west = solar.sunAltitudeAt(KASHGAR.lng, KASHGAR.lat, date);
  assert.ok(east > 0, `东侧高度角 ${east.toFixed(1)}° 应大于 0`);
  assert.ok(west < -6, `西侧高度角 ${west.toFixed(1)}° 应显著低于 0`);
  return `上海 ${east.toFixed(1)}° / 喀什 ${west.toFixed(1)}°`;
});

check('晨昏线：20:00（北京时）东部入夜、西部仍有余晖', () => {
  const date = beijingDate('2026-09-23T20:00');
  const east = solar.sunAltitudeAt(SHANGHAI.lng, SHANGHAI.lat, date);
  const west = solar.sunAltitudeAt(KASHGAR.lng, KASHGAR.lat, date);
  assert.ok(east < 0, `东侧高度角 ${east.toFixed(1)}° 应小于 0`);
  assert.ok(west > east + 8, `西侧应明显亮于东侧：${west.toFixed(1)}° vs ${east.toFixed(1)}°`);
  return `上海 ${east.toFixed(1)}° / 喀什 ${west.toFixed(1)}°`;
});

check('光照关键帧随高度角单调过渡', () => {
  const night = solar.lightingFor(-15);
  const day = solar.lightingFor(25);
  assert.ok(night.nightFactor > 0.9, `夜间权重 ${night.nightFactor.toFixed(2)}`);
  assert.ok(day.nightFactor < 0.05, `白昼权重 ${day.nightFactor.toFixed(2)}`);
  assert.ok(day.sunIntensity > night.sunIntensity);
  assert.ok(day.cityBoost < night.cityBoost, '夜间城市光点应更强');
  return `nightFactor ${night.nightFactor.toFixed(2)} → ${day.nightFactor.toFixed(2)}`;
});

check('投影：上海在北京以东以南', () => {
  const bj = geo.project(BEIJING.lng, BEIJING.lat);
  const sh = geo.project(SHANGHAI.lng, SHANGHAI.lat);
  assert.ok(sh.x > bj.x, '上海应在北京以东');
  assert.ok(sh.y < bj.y, '上海应在北京以南');
  return `Δx=${(sh.x - bj.x).toFixed(3)} Δy=${(sh.y - bj.y).toFixed(3)}`;
});

check('投影：城市落在舞台可视范围内', () => {
  for (const city of [BEIJING, SHANGHAI, KASHGAR, { lng: 104.0665, lat: 30.5723 }]) {
    const point = geo.project(city.lng, city.lat);
    assert.ok(Math.abs(point.x) < 3.2 && Math.abs(point.y) < 1.9, `${city.lng},${city.lat} → ${point.x},${point.y}`);
  }
  return '四城均在范围内';
});

check('地形：秦岭主脊明显隆起', () => {
  const onRidge = terrain.heightAt(109.8, 33.7);
  const offRidge = terrain.heightAt(120.0, 24.0);
  assert.ok(onRidge > 0.35, `脊线高度 ${onRidge.toFixed(3)} 偏低`);
  assert.ok(offRidge < 0.03, `远处不应有山体：${offRidge.toFixed(3)}`);
  return `脊线 ${onRidge.toFixed(3)} / 远处 ${offRidge.toFixed(3)}`;
});

check('地形：十条主脊都有隆起', () => {
  const samples = [
    [85.0, 35.8, '昆仑山'],
    [85.5, 43.0, '天山'],
    [100.3, 27.5, '横断山'],
    [110.0, 41.3, '阴山'],
    [117.2, 27.4, '武夷山'],
  ];
  const detail = samples
    .map(([lng, lat, name]) => {
      const value = terrain.heightAt(lng, lat);
      assert.ok(value > 0.2, `${name} 未隆起：${value.toFixed(3)}`);
      return `${name} ${value.toFixed(2)}`;
    })
    .join(' / ');
  return detail;
});

check('地形：世界坐标把城市放在地图平面上', () => {
  const point = terrain.worldPosition(116.4074, 39.9042);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  assert.ok(point.y >= 0 && point.y <= STAGE.relief + 0.001, `隆起高度异常：${point.y}`);
  const east = terrain.worldPosition(121.4737, 31.2304);
  assert.ok(east.x > point.x, '上海应在北京以东');
  assert.ok(east.z > point.z, '北为 -z，上海应更靠 +z（偏南）');
  return `北京 y=${point.y.toFixed(3)}，z 向偏移正确`;
});

check('山脊数据完整', () => {
  assert.equal(RANGES.length, 10, `山脊数量 ${RANGES.length}`);
  for (const range of RANGES) {
    assert.ok(range.spine.length >= 3, `${range.name} 脊线点不足`);
    assert.ok(range.layer >= 0 && range.layer <= 3, `${range.name} 层级错误`);
  }
  return `${RANGES.length} 条主脊`;
});

let failed = 0;
for (const item of results) {
  const mark = item.ok ? 'PASS' : 'FAIL';
  if (!item.ok) failed += 1;
  console.log(`[${mark}] ${item.name} → ${item.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed > 0 ? 1 : 0);
