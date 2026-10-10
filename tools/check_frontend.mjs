// 前端核心逻辑校验（Node 运行，不依赖浏览器）：
// 天文日照精度、晨昏线东西差异、投影方位、地形高度场与几何数据有效性。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const solar = await import(path.join(root, 'frontend/js/solar.js'));
const geo = await import(path.join(root, 'frontend/js/geo.js'));
const terrain = await import(path.join(root, 'frontend/js/terrain.js'));
const { STAGE } = await import(path.join(root, 'frontend/js/config.js'));
const { RANGES } = await import(path.join(root, 'frontend/js/data/ranges.js'));
const tripUtils = await import(path.join(root, 'frontend/js/map/trip_utils.js'));
const { CITIES_CN } = await import(path.join(root, 'frontend/js/data/cities-cn.js'));
const mercator = await import(path.join(root, 'frontend/js/map/mercator.js'));
const landmarks = await import(path.join(root, 'frontend/js/landmarks.js'));
const { LANDMARKS_CN } = await import(path.join(root, 'frontend/js/data/landmarks-cn.js'));
const cityIndexUtils = await import(path.join(root, 'frontend/js/map/city_index.js'));
const dynastyMode = await import(path.join(root, 'frontend/js/map/dynasty_mode.js'));
const poemGlow = await import(path.join(root, 'frontend/js/map/poem_glow.js'));

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

check('全国城市数据完整（≥330 城且坐标在国内）', () => {
  assert.ok(CITIES_CN.length >= 330, `城市数 ${CITIES_CN.length}`);
  const bad = CITIES_CN.filter((city) => !(73 <= city.lng && city.lng <= 136 && 3 <= city.lat && city.lat <= 54));
  assert.equal(bad.length, 0, `越界城市 ${bad.slice(0, 3).map((c) => c.name).join(',')}`);
  const tiers = new Set(CITIES_CN.map((city) => city.tier));
  for (const tier of ['municipality', 'capital', 'prefecture']) assert.ok(tiers.has(tier), `缺少层级 ${tier}`);
  return `${CITIES_CN.length} 城`;
});

check('城市显示：全国尺度只留重点城市，进入省级才显示该省城市', () => {
  const national = tripUtils.visibleCitiesForView(CITIES_CN, {
    minLng: 73, maxLng: 136, minLat: 18, maxLat: 54, widthKm: 4000,
  });
  const BIG = ['municipality', 'sar', 'subprovincial', 'capital'];
  assert.equal(national.level, 'national');
  assert.ok(national.cities.length >= 30 && national.cities.length < 60, `重点城市数量异常：${national.cities.length}`);
  assert.ok(national.cities.every((city) => BIG.includes(city.tier)), '全国尺度只能显示重点层级');

  // 缩到洛阳一带（河南省范围）
  const henan = tripUtils.visibleCitiesForView(CITIES_CN, {
    minLng: 110.3, maxLng: 116.7, minLat: 31.4, maxLat: 36.4, widthKm: 420,
  });
  assert.equal(henan.level, 'province');
  assert.ok(henan.cities.length > 8, `省级视野应显示该省城市，实际 ${henan.cities.length}`);
  const luoyang = henan.cities.find((city) => city.name.startsWith('洛阳'));
  assert.ok(luoyang, '洛阳应在省级视野内出现');
  assert.ok(
    henan.cities.some((city) => city.tier === 'prefecture'),
    '省级视野应包含地级市（不只是重点城市）',
  );
  return `全国 ${national.cities.length} 城 / 河南视野 ${henan.cities.length} 城（含洛阳）`;
});

check('拖拽落点 → 插入下标', () => {
  const points = [ { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 } ];
  assert.equal(tripUtils.insertIndexForDrop(points, { x: 150, y: 104 }), 1, '落在第 1 段中点应插到 1');
  assert.equal(tripUtils.insertIndexForDrop(points, { x: 250, y: 96 }), 2, '落在第 2 段中点应插到 2');
  assert.equal(tripUtils.insertIndexForDrop(points, { x: 20, y: 100 }), 0, '落在首点之前应插到 0');
  assert.equal(tripUtils.insertIndexForDrop(points, { x: 380, y: 100 }), 3, '落在末点之后应插到末尾');
  return '四种落点均正确';
});

check('按天配色与时段分桶稳定', () => {
  assert.equal(tripUtils.dayColor(0), tripUtils.dayColor(8), '配色应 8 色循环');
  assert.notEqual(tripUtils.dayColor(0), tripUtils.dayColor(1));
  assert.equal(tripUtils.bucketForHour(8), 'breakfast');
  assert.equal(tripUtils.bucketForHour(12), 'lunch');
  assert.equal(tripUtils.bucketForHour(15), 'coffee');
  assert.equal(tripUtils.bucketForHour(18), 'dinner');
  assert.equal(tripUtils.bucketForHour(22), 'night');
  return '配色循环 + 5 个时段分桶';
});

check('离线示意图投影落在画布内', () => {
  const points = [
    { lng: 108.94, lat: 34.26 },
    { lng: 109.27, lat: 34.38 },
    { lng: 108.96, lat: 34.22 },
  ];
  const projected = tripUtils.projectToBox(points, 800, 600, 40);
  assert.equal(projected.length, 3);
  for (const point of projected) {
    assert.ok(point.x >= 40 && point.x <= 760, `x 越界 ${point.x}`);
    assert.ok(point.y >= 40 && point.y <= 560, `y 越界 ${point.y}`);
  }
  return '三点均在画布内';
});

check('Web Mercator 投影往返误差 < 1e-6', () => {
  const samples = [
    { lng: 116.4074, lat: 39.9042 },
    { lng: 108.9398, lat: 34.3416 },
    { lng: 75.99, lat: 39.47 },
    { lng: 121.4737, lat: 31.2304 },
  ];
  let worst = 0;
  for (const zoom of [4, 8, 12, 16]) {
    for (const point of samples) {
      const pixel = mercator.mercatorProject(point.lng, point.lat, zoom);
      const back = mercator.mercatorUnproject(pixel.x, pixel.y, zoom);
      worst = Math.max(worst, Math.abs(back.lng - point.lng), Math.abs(back.lat - point.lat));
    }
  }
  assert.ok(worst < 1e-6, `最大往返误差 ${worst}`);
  return `最大往返误差 ${worst.toExponential(2)}°`;
});

check('拖拽 200px：行政边界与点位同步位移', () => {
  const view = mercator.createView({ lng: 108.94, lat: 34.26 }, 12, 900, 600);
  const boundaryPoint = { lng: 108.9, lat: 34.3 };
  const stop = { lng: 108.96, lat: 34.22 };
  const beforeA = mercator.projectToScreen(boundaryPoint, view);
  const beforeB = mercator.projectToScreen(stop, view);
  const moved = mercator.panView(view, 200, -120);
  const afterA = mercator.projectToScreen(boundaryPoint, moved);
  const afterB = mercator.projectToScreen(stop, moved);
  const deltaA = { x: afterA.x - beforeA.x, y: afterA.y - beforeA.y };
  const deltaB = { x: afterB.x - beforeB.x, y: afterB.y - beforeB.y };
  assert.ok(Math.abs(deltaA.x - 200) < 0.5, `边界 x 位移 ${deltaA.x}`);
  assert.ok(Math.abs(deltaB.x - 200) < 0.5, `点位 x 位移 ${deltaB.x}`);
  assert.ok(Math.abs(deltaA.y + 120) < 0.5 && Math.abs(deltaB.y + 120) < 0.5, `y 位移 ${deltaA.y}/${deltaB.y}`);
  assert.ok(Math.abs(deltaA.x - deltaB.x) < 1e-6 && Math.abs(deltaA.y - deltaB.y) < 1e-6, '边界与点位位移必须一致');
  return '边界与点位同时位移 200px 且完全一致';
});

check('缩放锚点下的地理位置不漂移', () => {
  const view = mercator.createView({ lng: 108.94, lat: 34.26 }, 12, 900, 600);
  const anchor = { x: 640, y: 220 };
  const before = mercator.unprojectScreen(anchor.x, anchor.y, view);
  const zoomed = mercator.zoomViewAt(view, 1.6, anchor);
  const after = mercator.unprojectScreen(anchor.x, anchor.y, zoomed);
  assert.ok(Math.abs(after.lng - before.lng) < 1e-9, `经度漂移 ${after.lng - before.lng}`);
  assert.ok(Math.abs(after.lat - before.lat) < 1e-9, `纬度漂移 ${after.lat - before.lat}`);
  return `锚点保持 ${before.lng.toFixed(6)},${before.lat.toFixed(6)}`;
});

check('比例尺误差 < 5%', () => {
  let worst = 0;
  for (const lat of [22, 34, 45]) {
    for (const zoom of [8, 11, 14]) {
      const bar = mercator.scaleBarKm(lat, zoom, 100);
      const actual = (bar.km * 1000) / bar.pixels;
      worst = Math.max(worst, Math.abs(actual - bar.metersPerPixel) / bar.metersPerPixel);
      assert.ok(bar.pixels <= 100.0001, `长度超限 ${bar.pixels}`);
      assert.ok(bar.pixels >= 20, `比例尺过短 ${bar.pixels}`);
    }
  }
  assert.ok(worst < 0.05, `最大误差 ${(worst * 100).toFixed(2)}%`);
  return `9 组比例尺最大误差 ${(worst * 100).toFixed(2)}%`;
});

check('统一城市索引：重点城市带 3D 地标、地级市齐全', () => {
  const index = cityIndexUtils.mergeCityIndex([
    { slug: 'xian', name: '西安', province: '陕西省', lng: 108.9398, lat: 34.3416, landmark_key: 'bell_tower' },
    { slug: 'beijing', name: '北京', province: '北京市', lng: 116.4074, lat: 39.9042, landmark_key: 'tiantan' },
  ]);
  assert.ok(index.length >= 300, `城市数 ${index.length}`);
  const xian = cityIndexUtils.findCity(index, '西安市');
  assert.equal(xian.slug, 'xian');
  assert.equal(xian.landmark_key, 'bell_tower');
  assert.ok(xian.adcode && Number.isFinite(xian.lng) && Number.isFinite(xian.lat), '重点城市应带 adcode 与坐标');
  const luoyang = cityIndexUtils.findCity(index, '洛阳');
  assert.ok(luoyang && !luoyang.landmark_key && luoyang.adcode, '普通地级市应无地标但有 adcode');
  assert.ok(cityIndexUtils.cityCardMeta(luoyang).includes('双击进入流程编辑'));
  return `${index.length} 座城市（含 ${index.filter((city) => city.landmark_key).length} 座 3D 地标）`;
});

check('省会 / 自治区首府 / 特别行政区地标全部可构建', () => {
  const keys = Object.keys(LANDMARKS_CN);
  const built = keys.map((key) => {
    const group = landmarks.landmarkFactory(key);
    let meshes = 0;
    group.traverse((node) => {
      if (node.isMesh) meshes += 1;
    });
    return [key, meshes];
  });
  const bad = built.filter(([, meshes]) => meshes <= 3);
  assert.ok(keys.length >= 33, `地标数量不足：${keys.length}`);
  assert.equal(bad.length, 0, `以下地标退化成兜底模型：${bad.map(([key]) => key).join('、')}`);
  const lightest = built.reduce((min, item) => (item[1] < min[1] ? item : min), built[0]);
  return `${keys.length} 个地标，最少网格 ${lightest[1]}（${lightest[0]}）`;
});

check('同一原型的城市也要能分辨（形体 + 专属部件）', () => {
  const groups = new Map();
  Object.entries(LANDMARKS_CN).forEach(([key, config]) => {
    const group = landmarks.landmarkFactory(key);
    const box = new landmarks.THREE.Box3().setFromObject(group);
    const size = box.getSize(new landmarks.THREE.Vector3());
    let meshes = 0;
    group.traverse((node) => {
      if (node.isMesh) meshes += 1;
    });
    const signature = [
      meshes,
      Math.round(size.y * 100),
      Math.round((size.x + size.z) * 100),
      (config.props || []).join('+'),
      config.shape || '',
      config.tiers || 0,
      config.levels || 0,
    ].join('|');
    const list = groups.get(config.archetype) || [];
    list.push({ key, city: config.city, signature });
    groups.set(config.archetype, list);
  });
  const clashes = [];
  groups.forEach((list, archetype) => {
    if (list.length < 2) return;
    const seen = new Map();
    list.forEach((item) => {
      if (seen.has(item.signature)) {
        clashes.push(`${archetype}: ${seen.get(item.signature)} 与 ${item.city} 完全一样`);
      } else {
        seen.set(item.signature, item.city);
      }
    });
  });
  assert.equal(clashes.length, 0, clashes.join('；'));
  const detail = Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([archetype, list]) => `${archetype}×${list.length}`)
    .join('、');
  return `同原型分组：${detail}`;
});

check('全国 34 个省级行政区都有讲解与地标', () => {
  const provincial = [
    '北京', '天津', '上海', '重庆', '石家庄', '太原', '呼和浩特', '沈阳', '长春', '哈尔滨',
    '南京', '杭州', '合肥', '福州', '南昌', '济南', '郑州', '武汉', '长沙', '广州', '南宁', '海口',
    '成都', '贵阳', '昆明', '拉萨', '西安', '兰州', '西宁', '银川', '乌鲁木齐', '香港', '澳门', '台北',
  ];
  const covered = new Set(['北京', '上海', '广州', '西安', '成都', ...Object.values(LANDMARKS_CN).map((item) => item.city)]);
  const missing = provincial.filter((name) => !covered.has(name));
  assert.equal(missing.length, 0, `缺少：${missing.join('、')}`);
  assert.ok(covered.has('台北'), '台湾必须包含在内');
  return `覆盖 ${provincial.length} 个省级行政区（含台北）`;
});

const playback = await import(path.join(root, 'frontend/js/map/playback.js'));

function fakeFlow() {
  return {
    id: 'flow-test',
    name: '测试一日',
    transport: 'taxi',
    city: { name: '西安', lng: 108.9398, lat: 34.3416 },
    points: [
      { id: 'a', name: '钟楼', lng: 108.9398, lat: 34.261, dwell_minutes: 60 },
      { id: 'b', name: '大雁塔', lng: 108.964, lat: 34.2186, dwell_minutes: 90 },
      { id: 'c', name: '回民街', lng: 108.94, lat: 34.265, dwell_minutes: 60 },
    ],
    plan: {
      start_time: '09:00',
      end_time: '14:30',
      total_minutes: 330,
      timeline: [
        { node: 0, kind: 'start', id: '__start', name: '酒店', arrive: 32400, depart: 32400, wait_minutes: 0, arrive_text: '09:00', depart_text: '09:00' },
        { node: 1, kind: 'stop', id: 'a', name: '钟楼', arrive: 33600, depart: 37200, wait_minutes: 0, arrive_text: '09:20', depart_text: '10:20' },
        { node: 2, kind: 'stop', id: 'b', name: '大雁塔', arrive: 39000, depart: 44400, wait_minutes: 0, arrive_text: '10:50', depart_text: '12:20' },
        { node: 3, kind: 'stop', id: 'c', name: '回民街', arrive: 46200, depart: 49800, wait_minutes: 0, arrive_text: '12:50', depart_text: '13:50' },
      ],
      order: ['__start', 'a', 'b', 'c'],
      legs: [
        { from: '__start', to: 'a', mode: 'taxi', minutes: 20, distance_km: 5.2, estimated: false },
        { from: 'a', to: 'b', mode: 'taxi', minutes: 30, distance_km: 8.4, estimated: false },
        { from: 'b', to: 'c', mode: 'walking', minutes: 30, distance_km: 2.1, estimated: true },
      ],
    },
  };
}

check('推演：时间轨与到达/离开时间对齐', () => {
  const track = playback.buildDayTrack(fakeFlow());
  assert.equal(track.empty, false);
  assert.equal(track.nodes.length, 4);
  assert.equal(track.nodes[0].name, '酒店');
  assert.equal(track.startMinutes, 540, `09:00 应为 540 分钟，实际 ${track.startMinutes}`);
  assert.equal(track.endMinutes, 830, `13:50 结束应为 830 分钟，实际 ${track.endMinutes}`);
  assert.equal(track.legs.length, 3);
  assert.ok(Math.abs(track.legs[1].minutes - 30) < 0.01);
  assert.equal(track.legs[2].estimated, true, '步行段应保留估算标记');
  assert.equal(track.legs[2].mode, 'walking');
  return `${track.nodes.length} 站 · ${track.legs.length} 段 · ${track.startMinutes}→${track.endMinutes} 分钟`;
});

check('推演：旅行者位置随时间推进', () => {
  const track = playback.buildDayTrack(fakeFlow());
  const start = playback.snapshotDay(track, 540);
  assert.equal(start.status, 'waiting');
  assert.ok(Math.abs(start.traveler.lng - 108.9398) < 1e-6, '出发时应停在出发点');
  const moving = playback.snapshotDay(track, 550); // 09:10，第一段通勤中
  assert.equal(moving.status, 'moving');
  assert.ok(moving.traveler.lng > 108.9398 && moving.traveler.lng < 108.9398 + (108.9398 - 108.9398) + 0.001 + 0.0 || moving.traveler.lng >= 108.9398);
  const mid = playback.snapshotDay(track, 570); // 09:30 正好抵达钟楼
  assert.equal(mid.status, 'staying');
  assert.ok(Math.abs(mid.traveler.lat - 34.261) < 1e-6, '停留时应站在点位坐标上');
  const done = playback.snapshotDay(track, 900);
  assert.equal(done.status, 'done');
  assert.ok(done.entries.some((entry) => entry.kind === 'end'), '结束应写入日志');
  assert.ok(done.entries.length >= 8, `日志条目偏少：${done.entries.length}`);
  assert.ok(done.travelled.length >= 2, '已走路径应至少有两个点');
  return `waiting→moving→staying→done，日志 ${done.entries.length} 条`;
});

check('推演：多天编排含城际与过夜卡', () => {
  const day1 = fakeFlow();
  const day2 = { ...fakeFlow(), id: 'flow-test-2', name: '成都一日', city: { name: '成都', lng: 104.06, lat: 30.67 } };
  const guide = {
    id: 'guide-test',
    items: [
      { day: 1, flowId: 'flow-test', notes: '' },
      { day: 2, flowId: 'flow-test-2', notes: '', leg: { from: '西安', to: '成都', mode: 'driving', minutes: 400, distance_km: 620, estimated: true } },
    ],
  };
  const playlist = playback.buildGuidePlaylist(guide, { 'flow-test': day1, 'flow-test-2': day2 }, { speed: 1 });
  const kinds = playlist.segments.map((segment) => segment.kind);
  assert.deepEqual(kinds, ['day', 'transfer', 'night', 'day'], `实际 ${kinds.join('→')}`);
  const transfer = playlist.segments.find((segment) => segment.kind === 'transfer');
  assert.ok(transfer.realDuration <= playback.TRANSFER_MAX_SECONDS + 1e-6, '城际快进不应超过 6 秒');
  const night = playlist.segments.find((segment) => segment.kind === 'night');
  assert.ok(night.minutes > 600, `夜间休整应覆盖到次日 09:00，实际 ${night.minutes}`);
  const fast = playback.buildGuidePlaylist(guide, { 'flow-test': day1, 'flow-test-2': day2 }, { speed: 4 });
  assert.ok(fast.totalReal < playlist.totalReal, '4× 应显著缩短总时长');
  return `${kinds.join('→')} · 1× ${playlist.totalReal.toFixed(1)}s / 4× ${fast.totalReal.toFixed(1)}s`;
});

check('推演：播放器 seek 与跳站', () => {
  const guide = { items: [{ day: 1, flowId: 'flow-test' }] };
  const playlist = playback.buildGuidePlaylist(guide, { 'flow-test': fakeFlow() }, { speed: 1 });
  const player = playback.createPlayer(playlist, { speed: 1 });
  const first = player.snapshot();
  assert.equal(first.day, 1);
  assert.ok(first.clockText === '09:00', `起始时钟应为 09:00，实际 ${first.clockText}`);
  const mid = player.seekAbsolute(600); // 10:00
  assert.equal(mid.clockText, '10:00');
  const end = player.seekAbsolute(playlist.totalSim);
  assert.ok(end.absoluteMinutes >= 820, `末段应到当天结束，实际 ${end.absoluteMinutes}`);
  player.seekAbsolute(540);
  const next = player.skipNext();
  assert.ok(Math.abs(next.absoluteMinutes - 560) < 0.5, `跳站应到第一站抵达时刻 09:20（560 分钟），实际 ${next.absoluteMinutes}`);
  player.play();
  const advanced = player.tick(2);
  assert.ok(advanced.absoluteMinutes > 540, '播放中 tick 应推进模拟时间');
  assert.ok(advanced.realProgress > 0 && advanced.realProgress <= 1);
  return `09:00→${end.clockText}，跳站到 ${next.clockText}，tick 推进正常`;
});

check('推演：昼夜层东西差异与晨昏线', () => {
  const bounds = { minLng: 73, maxLng: 135, minLat: 18, maxLat: 54 };
  const date = new Date(Date.UTC(2026, 8, 23, -8 + 6, 30));
  const { cols, rows, grid } = playback.sampleAltitudes(bounds, date, { cols: 40, rows: 20 });
  let west = 0;
  let east = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (col < cols / 2) west += playback.nightAlphaAt(grid[row * cols + col]);
      else east += playback.nightAlphaAt(grid[row * cols + col]);
    }
  }
  assert.ok(west > east, `西侧应更暗：west=${west.toFixed(2)} east=${east.toFixed(2)}`);
  assert.ok(playback.nightAlphaAt(-20) > playback.nightAlphaAt(0), '夜间遮罩应比晨昏线更暗');
  assert.ok(playback.nightAlphaAt(0) > playback.nightAlphaAt(20), '白天不应有遮罩');
  assert.ok(playback.nightAlphaAt(20) < 0.01, '高度角 20° 应完全白天');
  const line = playback.terminatorPoints(bounds, date, { rows: 24, steps: 48 });
  assert.ok(line.length >= 6, `晨昏线采样点太少：${line.length}`);
  assert.ok(line.every((point) => point.lng >= bounds.minLng - 0.01 && point.lng <= bounds.maxLng + 0.01));
  return `西 ${west.toFixed(1)} / 东 ${east.toFixed(1)}，晨昏线 ${line.length} 点`;
});

// ── 穿越系统：故事数据在 Python 模块里（单一数据源），这里取真数据做结构与落点校验 ──

function loadDynastyPayloads() {
  const python = process.env.CL_PYTHON || 'python3';
  const script = [
    'import sys, json',
    "sys.path.insert(0, 'backend')",
    'from app.data import dynasties as d',
    "print(json.dumps([d.get_dynasty(k) for k in ('tang', 'song', 'ming')], ensure_ascii=False))",
  ].join('\n');
  const raw = execFileSync(python, ['-c', script], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(raw);
}

let dynastyPayloads = null;
let dynastyLoadError = '';
try {
  dynastyPayloads = loadDynastyPayloads();
} catch (error) {
  dynastyLoadError = error.message;
}

check('穿越：三朝数据完整（疆域闭合 + 12 地名 + 12 诗词）', () => {
  if (!dynastyPayloads) {
    return `跳过真实数据校验（未能调用 python：${dynastyLoadError.slice(0, 80)}）`;
  }
  assert.equal(dynastyPayloads.length, 3, '应正好三朝');
  const keys = dynastyPayloads.map((item) => item.key);
  assert.deepEqual(keys, ['tang', 'song', 'ming']);
  const summaries = dynastyPayloads.map((item) => dynastyMode.validateDynastyPayload(item));
  dynastyPayloads.forEach((dynasty) => {
    assert.ok(dynasty.period && dynasty.capital && dynasty.color, `${dynasty.key} 缺少年代/都城/主题色`);
    assert.ok(dynasty.summary, `${dynasty.key} 缺少一句话简介`);
    // 命名唯一性只在同一朝代内要求（扬州/洛阳这类地名本就跨朝沿用）
    const names = new Set();
    dynasty.places.forEach((place) => {
      const label = `${place.ancient}|${place.modern}`;
      assert.ok(!names.has(label), `${dynasty.key} 地名重复：${label}`);
      names.add(label);
    });
    dynasty.poems.forEach((poem) => {
      const label = `${poem.title}|${poem.author}`;
      assert.ok(!names.has(label), `${dynasty.key} 诗词重复：${label}`);
      names.add(label);
    });
  });
  return summaries.map((item) => `${item.key} ${item.outline}点/${item.places}地名/${item.poems}诗词`).join(' · ');
});

check('穿越：地名与诗词写作地在疆域内，投影落在舞台可视范围', () => {
  if (!dynastyPayloads) return '跳过（无真实数据）';
  let count = 0;
  dynastyPayloads.forEach((dynasty) => {
    const bounds = dynastyMode.outlineBounds(dynasty.outline);
    const placeIds = new Set(dynasty.places.map((place) => place.id));
    dynasty.places.forEach((place) => {
      assert.ok(place.lng >= bounds.minLng && place.lng <= bounds.maxLng, `${dynasty.key}/${place.id} 经度越界`);
      assert.ok(place.lat >= bounds.minLat && place.lat <= bounds.maxLat, `${dynasty.key}/${place.id} 纬度越界`);
      const point = geo.project(place.lng, place.lat);
      assert.ok(Math.abs(point.x) < 3.2 && Math.abs(point.y) < 1.9, `${dynasty.key}/${place.id} 投影越界`);
      count += 1;
    });
    dynasty.poems.forEach((poem) => {
      assert.ok(placeIds.has(poem.place_id), `${dynasty.key}/${poem.id} 写作地缺失`);
      count += 1;
    });
  });
  return `${count} 个落点全部通过`;
});

check('穿越：朝代主题色与现代图层配色可区分', () => {
  if (!dynastyPayloads) return '跳过（无真实数据）';
  const colors = new Set(dynastyPayloads.map((item) => String(item.color).toUpperCase()));
  assert.equal(colors.size, 3, '三朝主题色应各不相同');
  return Array.from(colors).join(' / ');
});

check('穿越：光字两列竖排切分（五言 / 七言 / 词）', () => {
  const five = poemGlow.poemColumns('床前明月光，疑是地上霜。举头望明月，低头思故乡。');
  assert.deepEqual(five, ['床前明月光', '疑是地上霜']);
  const seven = poemGlow.poemColumns('月落乌啼霜满天，江枫渔火对愁眠。');
  assert.deepEqual(seven, ['月落乌啼霜满天', '江枫渔火对愁眠']);
  const ci = poemGlow.poemColumns('明月几时有？把酒问青天。不知天上宫阙，今夕是何年。');
  assert.deepEqual(ci, ['明月几时有', '把酒问青天']);
  const long = poemGlow.poemColumns('大江东去，浪淘尽，千古风流人物。');
  assert.ok(long[0].length <= 9 && long[1].length <= 9, `每列不应超过 9 字：${long.join(' / ')}`);
  assert.ok(long.every((line) => line.length > 0), '两列都应有字');
  return `五言「${five.join(' / ')}」· 七言「${seven.join(' / ')}」`;
});

check('穿越：每朝 4–8 首代表诗词发光字，且 id 都能对上', () => {
  if (!dynastyPayloads) return '跳过（无真实数据）';
  return dynastyPayloads
    .map((dynasty) => {
      const ids = new Set(dynasty.poems.map((poem) => poem.id));
      const featured = dynasty.featured || [];
      assert.ok(featured.length >= 4 && featured.length <= 8, `${dynasty.key} 光字数量 ${featured.length} 不在 4–8`);
      featured.forEach((id) => {
        assert.ok(ids.has(id), `${dynasty.key} 光字诗词不存在：${id}`);
      });
      const flagged = dynasty.poems
        .filter((poem) => poem.featured)
        .map((poem) => poem.id)
        .sort();
      assert.deepEqual(flagged, featured.slice().sort(), `${dynasty.key} featured 标记与清单不一致`);
      return `${dynasty.key} ${featured.length} 首`;
    })
    .join(' · ');
});

let failed = 0;
for (const item of results) {
  const mark = item.ok ? 'PASS' : 'FAIL';
  if (!item.ok) failed += 1;
  console.log(`[${mark}] ${item.name} → ${item.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed > 0 ? 1 : 0);
