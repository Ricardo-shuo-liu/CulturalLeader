// 像素造境画室：一句话 → SSE 进度 → 预览 → 下载。
// 造型与文案沿用 theme.css 的纸/墨/赭金/朱砂 tokens。

const EXAMPLES = [
  '洛阳龙门石窟，黄昏，伊水与崖壁大佛',
  '苏州水乡，春雨，白墙黛瓦与拱桥',
  '西安城墙，夜色，灯火与飞檐',
  '上海外滩，清晨，江面与天际线',
];

const LANDMARK_LABELS = {
  cliff_buddha: '崖壁大佛',
  pagoda: '古塔',
  palace_gate: '城门宫阙',
  water_town: '水乡',
  mountain_temple: '山寺',
  skyline: '天际线',
};

const $ = (id) => document.getElementById(id);

function newSeed() {
  return Math.floor(Math.random() * 2147483646) + 1;
}

function safeName(value, ext) {
  const base = String(value || '像素造境').replace(/[\\/:*?"<>|]/g, '_').trim() || '像素造境';
  return `${base}.${ext}`;
}

function parseSseBlock(raw) {
  let event = 'message';
  const dataLines = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch (error) {
    return null;
  }
}

export function createAtelier({ onOpen, onClose } = {}) {
  const root = $('atelier');
  const promptInput = $('atelier-prompt');
  const examples = $('atelier-examples');
  const generateButton = $('atelier-generate');
  const closeButton = $('atelier-close');
  const chat = $('atelier-chat');
  const steps = $('atelier-steps');
  const sources = $('atelier-sources');
  const errorBox = $('atelier-error');
  const empty = $('atelier-empty');
  const image = $('atelier-image');
  const loading = $('atelier-loading');
  const meta = $('atelier-meta');
  const actions = $('atelier-actions');
  const refineRow = $('atelier-refine-row');
  const refineInput = $('atelier-refine');
  const refineGo = $('atelier-refine-go');
  const again = $('atelier-again');
  const downloadScene = $('atelier-download-scene');
  const downloadPostcard = $('atelier-download-postcard');
  const downloadZip = $('atelier-download-zip');

  const stepEls = new Map();
  steps?.querySelectorAll('li[data-step]').forEach((element) => {
    stepEls.set(element.dataset.step, element);
  });

  const state = {
    open: false,
    busy: false,
    lastPrompt: '',
    lastResult: null,
    lastSeed: 0,
    maxProgress: 0,
  };

  function addChat(role, text) {
    if (!chat || !text) return;
    const row = document.createElement('div');
    row.className = `atelier-msg ${role}`;
    row.textContent = text;
    chat.appendChild(row);
    while (chat.children.length > 8) chat.removeChild(chat.firstElementChild);
    chat.scrollTop = chat.scrollHeight;
  }

  function setStep(key, status, label, detail) {
    const element = stepEls.get(key);
    if (!element) return;
    element.dataset.state = status;
    const note = element.querySelector('em');
    if (!note) return;
    if (status === 'active') note.textContent = label || detail || '';
    else note.textContent = [label, detail].filter(Boolean).join(' · ');
  }

  function resetSteps() {
    stepEls.forEach((element) => {
      element.dataset.state = 'pending';
      const note = element.querySelector('em');
      if (note) note.textContent = '';
    });
  }

  function clearSources() {
    sources?.replaceChildren();
  }

  function addSource(item) {
    if (!sources || !item?.url) return;
    if (sources.children.length >= 3) return;
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${item.publisher || '来源'} · ${item.title || item.url}`;
    if (item.license) link.title = `许可：${item.license}`;
    sources.appendChild(link);
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || '造境失败，请稍后再试';
    errorBox.classList.remove('hidden');
    const active = steps?.querySelector('li[data-state="active"]');
    if (active) active.dataset.state = 'error';
  }

  function hideError() {
    errorBox?.classList.add('hidden');
    if (errorBox) errorBox.textContent = '';
  }

  function setLoading(on) {
    loading?.classList.toggle('hidden', !on);
  }

  function resetResult() {
    image?.classList.add('hidden');
    image?.removeAttribute('src');
    empty?.classList.remove('hidden');
    meta?.classList.add('hidden');
    actions?.classList.add('hidden');
    refineRow?.classList.add('hidden');
    [downloadScene, downloadPostcard, downloadZip].forEach((link) => link?.removeAttribute('href'));
    state.lastResult = null;
  }

  function setMeta(data) {
    if (!meta) return;
    const spec = data.spec || {};
    const rows = [
      ['地点', spec.place || '—'],
      ['场景', LANDMARK_LABELS[spec.landmark_type] || spec.landmark_type || '—'],
      ['色板', spec.palette || 'InkGongbi48'],
      ['校验', data.validation?.message || '通过'],
    ];
    meta.replaceChildren();
    rows.forEach(([label, value]) => {
      const item = document.createElement('span');
      const strong = document.createElement('b');
      strong.textContent = `${label} `;
      item.appendChild(strong);
      item.appendChild(document.createTextNode(String(value)));
      meta.appendChild(item);
    });
    meta.classList.remove('hidden');
  }

  function setDownloads(data) {
    const title = data.title || '像素造境';
    if (downloadScene && data.scene) {
      downloadScene.href = data.scene;
      downloadScene.download = safeName(title, 'png');
    }
    if (downloadPostcard && data.postcard) {
      downloadPostcard.href = data.postcard;
      downloadPostcard.download = safeName(`${title}-明信片`, 'png');
    }
    if (downloadZip && data.zip) {
      downloadZip.href = data.zip;
      downloadZip.download = safeName(title, 'zip');
    }
    actions?.classList.remove('hidden');
    refineRow?.classList.remove('hidden');
  }

  function finish(data) {
    if (!data) return;
    state.lastResult = data;
    setLoading(false);
    setMeta(data);
    setDownloads(data);
    addChat('assistant', `画好了：${data.title || '你的场景'}。可以下载场景图、明信片或 zip。`);
    if (image && data.scene) {
      image.alt = data.title || '生成的像素场景';
      image.onload = () => {
        image.classList.remove('hidden');
        empty?.classList.add('hidden');
        loading?.classList.add('hidden');
      };
      image.onerror = () => showError('场景图加载失败，请再试一次。');
      image.src = data.scene;
    }
  }

  function handleEvent(event, data) {
    if (!data) return;
    if (event === 'stage') {
      setStep(data.key, data.status, data.label, data.detail);
      if (data.status === 'error') showError(data.detail || data.label || '造境中断');
      return;
    }
    if (event === 'progress') {
      const percent = Number(data.percent) || 0;
      if (percent >= state.maxProgress) {
        state.maxProgress = percent;
        const element = stepEls.get('render');
        if (element) {
          element.dataset.state = 'active';
          const note = element.querySelector('em');
          if (note) note.textContent = `${percent}% · ${data.detail || ''}`;
        }
      }
      return;
    }
    if (event === 'source') {
      addSource(data);
      return;
    }
    if (event === 'done') {
      finish(data);
      return;
    }
    if (event === 'error') showError(data.message || '造境失败，请稍后再试');
  }

  async function generate(text, options = {}) {
    if (state.busy) return;
    const value = String(text ?? promptInput?.value ?? '').trim();
    if (!value) {
      promptInput?.focus();
      return;
    }
    if (value.length > 200) {
      showError('描述最多 200 字，请精简一下。');
      return;
    }
    state.busy = true;
    state.lastPrompt = value;
    state.lastSeed = Number.isInteger(options.seed) ? options.seed : newSeed();
    state.maxProgress = 0;
    resetResult();
    resetSteps();
    hideError();
    clearSources();
    setLoading(true);
    if (generateButton) generateButton.disabled = true;
    addChat('assistant', '收到，我先查资料、加载像素 Skill，然后落笔。');

    try {
      const response = await fetch('/api/atelier/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: value, seed: state.lastSeed }),
      });
      if (!response.ok) {
        let detail = '';
        try {
          const payload = await response.json();
          detail = typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail || payload);
        } catch (error) {
          /* 非 JSON 错误 */
        }
        throw new Error(detail || `造境服务返回 ${response.status}`);
      }
      if (!response.body) throw new Error('浏览器不支持流式响应，请换用新版浏览器。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const parsed = parseSseBlock(raw);
          if (parsed) handleEvent(parsed.event, parsed.data);
          index = buffer.indexOf('\n\n');
        }
      }
      if (buffer.trim()) {
        const parsed = parseSseBlock(buffer);
        if (parsed) handleEvent(parsed.event, parsed.data);
      }
      if (!state.lastResult) throw new Error('生成意外中断，请再试一次。');
    } catch (error) {
      showError(error?.message || '造境失败，请稍后再试');
    } finally {
      state.busy = false;
      if (generateButton) generateButton.disabled = false;
      setLoading(false);
    }
  }

  function open() {
    if (!root) return;
    root.classList.remove('hidden');
    state.open = true;
    onOpen?.();
    window.setTimeout(() => promptInput?.focus(), 60);
  }

  function close() {
    if (!root) return;
    root.classList.add('hidden');
    state.open = false;
    onClose?.();
  }

  EXAMPLES.forEach((text) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'atelier-example';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      if (promptInput) {
        promptInput.value = text;
        promptInput.focus();
      }
    });
    examples?.appendChild(chip);
  });

  closeButton?.addEventListener('click', close);
  root?.addEventListener('pointerdown', (event) => {
    if (event.target === root) close();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      event.preventDefault();
      close();
    }
  });
  generateButton?.addEventListener('click', () => generate());
  promptInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      generate();
    }
  });
  again?.addEventListener('click', () => {
    if (state.lastPrompt) generate(state.lastPrompt, { seed: newSeed() });
  });
  refineGo?.addEventListener('click', () => {
    const text = refineInput?.value.trim();
    if (!text || !state.lastPrompt) return;
    const next = `${state.lastPrompt}，${text}`.slice(0, 200);
    if (refineInput) refineInput.value = '';
    generate(next, { seed: newSeed() });
  });
  refineInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      refineGo?.click();
    }
  });

  return {
    open,
    close,
    isOpen: () => state.open,
    generate,
    debug: () => ({
      open: state.open,
      busy: state.busy,
      lastPrompt: state.lastPrompt,
      lastResult: state.lastResult,
      lastSeed: state.lastSeed,
    }),
  };
}
