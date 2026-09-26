// 统一城市索引：把「有讲解与 3D 地标的重点城市」与「全国 300+ 地级市」合并成一张表。
// 字段：slug / name / shortName / province / adcode / lng / lat / tier / landmark_key / key

import { CITIES_CN } from '../data/cities-cn.js';

export function normalizeCityName(name) {
  return String(name || '')
    .replace(/市$/, '')
    .trim();
}

export function mergeCityIndex(keyCities = [], prefectures = CITIES_CN) {
  const merged = new Map();
  (prefectures || []).forEach((city) => {
    const shortName = normalizeCityName(city.name);
    if (!shortName) return;
    merged.set(shortName, {
      slug: '',
      name: city.name,
      shortName,
      province: city.province || '',
      adcode: String(city.adcode || ''),
      lng: city.lng,
      lat: city.lat,
      tier: city.tier || 'prefecture',
      landmark_key: '',
      key: false,
      summary: '',
      tags: [],
    });
  });
  (keyCities || []).forEach((city) => {
    const shortName = normalizeCityName(city.name);
    if (!shortName) return;
    const base = merged.get(shortName) || {};
    merged.set(shortName, {
      ...base,
      slug: city.slug || base.slug || '',
      name: city.name || base.name || shortName,
      shortName,
      province: city.province || base.province || '',
      adcode: String(city.adcode || base.adcode || ''),
      lng: Number.isFinite(city.lng) ? city.lng : base.lng,
      lat: Number.isFinite(city.lat) ? city.lat : base.lat,
      tier: base.tier || 'capital',
      landmark_key: city.landmark_key || '',
      key: true,
      summary: city.summary || '',
      tags: city.tags || [],
    });
  });
  return Array.from(merged.values());
}

export function findCity(index, name) {
  const wanted = normalizeCityName(name);
  if (!wanted) return null;
  return (
    (index || []).find((city) => city.shortName === wanted) ||
    (index || []).find((city) => city.slug && city.slug === String(name)) ||
    null
  );
}

export function cityCardMeta(city) {
  if (!city) return '';
  const tierText = city.tier === 'prefecture' ? '地级市' : city.key ? '重点城市' : '城市';
  const landmark = city.landmark_key ? ' · 单击看 3D 地标' : '';
  return `${city.province || ''} · ${tierText}${landmark} · 双击进入流程编辑`;
}

export async function loadCityIndex({ fetchImpl = fetch } = {}) {
  let keyCities = [];
  try {
    const response = await fetchImpl('/api/cities');
    if (response.ok) {
      const payload = await response.json();
      keyCities = Array.isArray(payload) ? payload : payload.cities || [];
    }
  } catch (error) {
    keyCities = [];
  }
  return mergeCityIndex(keyCities);
}
