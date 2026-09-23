// 轻量内容后台：维护城市资料、讲解词与知识条目。

const $ = (id) => document.getElementById(id);
let cities = [];
let currentSlug = null;

const token = () => $('token').value.trim();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': token(),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch (error) {
      /* 忽略解析失败 */
    }
    throw new Error(detail);
  }
  return response.json();
}

function status(message, isError) {
  const element = $('status');
  element.textContent = message;
  element.style.color = isError ? '#ff9b8a' : 'rgba(232, 220, 195, 0.6)';
}

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  cities.forEach((city) => {
    const item = document.createElement('div');
    item.className = `city-item${city.slug === currentSlug ? ' active' : ''}`;
    item.textContent = `${city.name} · ${city.slug}`;
    item.addEventListener('click', () => select(city.slug));
    list.appendChild(item);
  });
}

function select(slug) {
  const city = cities.find((item) => item.slug === slug);
  if (!city) return;
  currentSlug = slug;
  $('f-name').value = city.name || '';
  $('f-province').value = city.province || '';
  $('f-lng').value = city.lng ?? '';
  $('f-lat').value = city.lat ?? '';
  $('f-accent').value = city.accent_color || '#F2C879';
  $('f-landmark').value = city.landmark_key || 'generic';
  $('f-tags').value = (city.tags || []).join(',');
  $('f-summary').value = city.summary || '';
  $('f-narration').value = city.narration || '';
  $('f-knowledge').value = (city.knowledge || [])
    .map((item) => `${item.question} | ${item.answer}`)
    .join('\n');
  renderList();
}

function parseKnowledge() {
  return $('f-knowledge')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [question, ...rest] = line.split('|');
      return { question: question.trim(), answer: rest.join('|').trim() };
    })
    .filter((item) => item.question && item.answer);
}

async function load() {
  try {
    cities = await api('/api/admin/cities');
    if (!currentSlug && cities.length) currentSlug = cities[0].slug;
    renderList();
    if (currentSlug) select(currentSlug);
    status(`已加载 ${cities.length} 座城市`);
  } catch (error) {
    status(error.message, true);
  }
}

async function save() {
  if (!currentSlug) {
    status('请先选择城市', true);
    return;
  }
  const payload = {
    name: $('f-name').value.trim(),
    province: $('f-province').value.trim(),
    lng: Number($('f-lng').value),
    lat: Number($('f-lat').value),
    accent_color: $('f-accent').value.trim() || '#F2C879',
    landmark_key: $('f-landmark').value.trim() || 'generic',
    tags: $('f-tags').value.split(',').map((item) => item.trim()).filter(Boolean),
    summary: $('f-summary').value.trim(),
    narration: $('f-narration').value.trim(),
  };
  try {
    await api(`/api/admin/cities/${currentSlug}`, { method: 'PUT', body: JSON.stringify(payload) });
    await api(`/api/admin/cities/${currentSlug}/knowledge`, {
      method: 'PUT',
      body: JSON.stringify(parseKnowledge()),
    });
    status('已保存');
    await load();
  } catch (error) {
    status(error.message, true);
  }
}

async function create() {
  const slug = window.prompt('新城市的 slug（英文小写，如 hangzhou）');
  if (!slug) return;
  const name = window.prompt('城市名称');
  if (!name) return;
  const lng = Number(window.prompt('经度 lng', '120.1551'));
  const lat = Number(window.prompt('纬度 lat', '30.2741'));
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    status('经纬度格式不正确', true);
    return;
  }
  try {
    await api('/api/admin/cities', {
      method: 'POST',
      body: JSON.stringify({ slug, name, lng, lat, province: '', summary: '', narration: '', tags: [] }),
    });
    currentSlug = slug;
    await load();
    status('已新增，请补充资料');
  } catch (error) {
    status(error.message, true);
  }
}

async function remove() {
  if (!currentSlug) return;
  if (!window.confirm(`确认删除 ${currentSlug}？`)) return;
  try {
    await api(`/api/admin/cities/${currentSlug}`, { method: 'DELETE' });
    currentSlug = null;
    await load();
    status('已删除');
  } catch (error) {
    status(error.message, true);
  }
}

$('load').addEventListener('click', load);
$('save').addEventListener('click', save);
$('create').addEventListener('click', create);
$('remove').addEventListener('click', remove);
load();
