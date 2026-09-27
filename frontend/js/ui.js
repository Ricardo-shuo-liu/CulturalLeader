// 界面层：城市标签、时刻牌与时间滑块、讲解面板、对话记录、提示条。

const $ = (id) => document.getElementById(id);

// 时间格式化器只建一次：Intl.DateTimeFormat 构造很贵，不能每帧新建
const BEIJING_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function createUI({ cities, handlers = {} }) {
  const labelLayer = $('labels');
  const labels = new Map();
  let labelScale = null;

  cities.forEach((city) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'city-label';
    element.dataset.slug = city.slug;
    element.innerHTML = `<span class="dot"></span><span class="name">${city.name}</span>`;
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      // 统一走「单击看地标 / 双击进流程编辑」的判定（沙盘光点与这里共用一套逻辑）
      if (handlers.onCityActivate) handlers.onCityActivate(city.slug, event);
      else handlers.onCitySelect?.(city.slug);
    });
    element.addEventListener('pointerenter', () => handlers.onCityHover?.(city.slug));
    element.addEventListener('pointerleave', () => handlers.onCityHover?.(null));
    labelLayer.appendChild(element);
    labels.set(city.slug, element);
  });

  const timeboard = $('timeboard');
  const slider = $('tb-slider');
  const liveButton = $('tb-live');
  const panel = $('panel');
  const chatLog = $('chat-log');
  const chatInput = $('chat-input');
  const micButton = $('mic-btn');
  const toastElement = $('toast');
  const bubble = $('speech-bubble');
  const loading = $('loading');

  let toastTimer = null;
  let bubbleTimer = null;
  let currentAssistant = null;
  let dragging = false;

  function openTimeboard(force) {
    const next = force ?? !timeboard.classList.contains('open');
    timeboard.classList.toggle('open', next);
  }

  timeboard.addEventListener('click', (event) => {
    if (event.target.closest('.tb-panel')) return;
    if (timeboard.closest('#drawer')) return; // 在导航抽屉里始终展开
    openTimeboard();
  });

  slider.addEventListener('input', () => {
    dragging = true;
    const minutes = Number(slider.value);
    handlers.onTimeChange?.(minutes);
  });
  slider.addEventListener('change', () => {
    dragging = false;
  });
  liveButton.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onLive?.();
  });

  $('panel-close').addEventListener('click', () => handlers.onCloseCity?.());
  $('replay-btn').addEventListener('click', () => handlers.onReplay?.());

  function send() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    handlers.onAsk?.(text);
  }

  $('chat-send').addEventListener('click', send);
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  let recording = false;
  const startRecording = async () => {
    if (recording) return;
    try {
      await handlers.onMicStart?.();
      recording = true;
      micButton.classList.add('recording');
      micButton.textContent = '松开结束';
    } catch (error) {
      recording = false;
      micButton.classList.remove('recording');
      micButton.textContent = '按住说话';
      toast(error.message || '无法开始录音');
    }
  };
  const stopRecording = async () => {
    if (!recording) return;
    recording = false;
    micButton.classList.remove('recording');
    micButton.textContent = '按住说话';
    try {
      const text = await handlers.onMicEnd?.();
      if (text) {
        addChat('user', text);
        handlers.onAsk?.(text);
      }
    } catch (error) {
      toast(error.message || '语音识别失败');
    }
  };

  micButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startRecording();
  });
  micButton.addEventListener('pointerup', (event) => {
    event.preventDefault();
    stopRecording();
  });
  micButton.addEventListener('pointerleave', () => stopRecording());
  micButton.addEventListener('pointercancel', () => stopRecording());

  function toast(message) {
    toastElement.textContent = message;
    toastElement.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove('show'), 3200);
  }

  function addChat(role, text) {
    const item = document.createElement('div');
    item.className = `chat-item ${role}`;
    item.textContent = text;
    chatLog.appendChild(item);
    chatLog.scrollTop = chatLog.scrollHeight;
    return item;
  }

  return {
    labels,
    toast,
    setLoading(value) {
      loading.classList.toggle('hidden', !value);
    },
    setActive(slug) {
      labels.forEach((element, key) => element.classList.toggle('active', key === slug));
    },
    hover(slug) {
      labels.forEach((element, key) => element.classList.toggle('hover', key === slug));
    },
    setBadges(map) {
      labels.forEach((element, slug) => {
        const value = map[slug];
        let badge = element.querySelector('.badge');
        if (!value) {
          badge?.remove();
          return;
        }
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'badge';
          element.appendChild(badge);
        }
        badge.textContent = String(value);
      });
    },
    /**
     * 更新重点城市标签（只在锚点正上方放一个名牌，不做多方位挪动）。
     *  - 位置整数对齐，落位唯一：不存在「跳槽 → 看起来在飘」的问题
     *  - 按外部给的优先级顺序占位，放不下就隐藏低优先级的那个（圆点仍在）
     *  - 鼠标悬停到的城市即使被隐藏也会临时显示（用于找到拉萨、乌鲁木齐这类边远省会）
     *  - 返回已占用的格子，交给城市图层复用（两层标签不再叠在一起）
     */
    updateLabels(positions, { order = null, hoverIndex = -1, scale = 'far' } = {}) {
      const taken = new Set();
      if (labelScale !== scale) {
        labelScale = scale;
        labelLayer.dataset.scale = scale;
        // 字号变了，缓存宽度必须重算
        labels.forEach((element) => {
          element.__width = 0;
          element.__height = 0;
        });
      }
      // 占位网格放细一点（34×20）：全国视野下能塞下更多省会的名字
      const cellW = 34;
      const cellH = 20;
      const cellsFor = (cx, cy, width, height) => {
        const keys = [];
        for (let col = Math.floor((cx - width / 2) / cellW); col <= Math.floor((cx + width / 2) / cellW); col += 1) {
          for (let row = Math.floor((cy - height + 4) / cellH); row <= Math.floor((cy + 6) / cellH); row += 1) {
            keys.push(`${col}:${row}`);
          }
        }
        return keys;
      };
      const visible = [];
      positions.forEach((position) => {
        if (position.visible) visible.push(position);
      });
      if (order) {
        visible.sort((a, b) => order.indexOf(a.index) - order.indexOf(b.index));
      }
      const shown = new Set();
      visible.forEach((position) => {
        const city = cities[position.index];
        const element = labels.get(city.slug);
        if (!element) return;
        const x = Math.round(position.x);
        const y = Math.round(position.y);
        element.__x = x;
        element.__y = y;
        const width = element.__width || (element.__width = Math.max(48, element.offsetWidth || 64));
        const height = element.__height || (element.__height = Math.max(30, element.offsetHeight || 46));
        const keys = cellsFor(x, y, width, height);
        const forced = position.index === hoverIndex;
        const free = keys.every((key) => !taken.has(key));
        if (!free && !forced) return;
        keys.forEach((key) => taken.add(key));
        shown.add(city.slug);
        const transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) translateY(4px)`;
        if (element.__transform !== transform) {
          element.style.transform = transform;
          element.__transform = transform;
        }
      });
      labels.forEach((element, slug) => {
        const isShown = shown.has(slug);
        const opacity = isShown ? '1' : '0';
        if (element.__opacity !== opacity) {
          element.style.opacity = opacity;
          element.style.pointerEvents = isShown ? 'auto' : 'none';
          element.__opacity = opacity;
        }
      });
      return taken;
    },
    updateTimeboard({ date, phaseLabel, altitude, azimuth, live, minutes }) {
      $('tb-time').textContent = BEIJING_FORMATTER.format(date);
      $('tb-phase').textContent = phaseLabel;
      $('tb-alt').textContent = `高度角 ${altitude >= 0 ? '+' : ''}${altitude.toFixed(1)}°　方位 ${azimuth.toFixed(0)}°`;
      $('tb-icon').style.transform = `rotate(${180 - azimuth}deg) translateY(${Math.max(-6, Math.min(6, -altitude / 12))}px)`;
      $('tb-mode').textContent = live ? '实时跟随' : '演示模式';
      timeboard.classList.toggle('demo', !live);
      if (!dragging && typeof minutes === 'number') slider.value = String(Math.round(minutes));
    },
    setNarration(text) {
      $('panel-narration').textContent = text || '（这座城市还没有讲解词，可以直接问数字人。）';
    },
    showPanel(city) {
      panel.classList.add('show');
      $('panel-name').textContent = city.name;
      $('panel-province').textContent = city.province || '';
      $('panel-tags').textContent = (city.tags || []).join(' · ');
      $('panel-summary').textContent = city.summary || '';
      $('panel-narration').textContent = city.narration || '';
      chatLog.innerHTML = '';
      currentAssistant = null;
      setTimeout(() => chatInput.focus(), 260);
    },
    hidePanel() {
      panel.classList.remove('show');
    },
    isPanelOpen() {
      return panel.classList.contains('show');
    },
    addChat,
    beginAssistant() {
      currentAssistant = addChat('assistant', '');
      return currentAssistant;
    },
    appendToken(text) {
      if (!currentAssistant) currentAssistant = addChat('assistant', '');
      currentAssistant.textContent += text;
      chatLog.scrollTop = chatLog.scrollHeight;
    },
    endAssistant() {
      currentAssistant = null;
    },
    setSpeech(text, muted) {
      clearTimeout(bubbleTimer);
      if (!text) {
        bubble.classList.remove('show');
        return;
      }
      bubble.textContent = muted ? `${text}（静音播放）` : text;
      bubble.classList.add('show');
      bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 6400);
    },
    setMuted(value) {
      $('mute-btn').textContent = value ? '开启声音' : '静音';
    },
  };
}
