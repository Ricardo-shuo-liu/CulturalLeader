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

  cities.forEach((city) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'city-label';
    element.dataset.slug = city.slug;
    element.innerHTML = `<span class="dot"></span><span class="name">${city.name}</span>`;
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onCitySelect?.(city.slug);
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
    updateLabels(positions) {
      positions.forEach((position) => {
        const city = cities[position.index];
        const element = labels.get(city.slug);
        if (!element) return;
        element.style.transform = `translate(${position.x}px, ${position.y}px)`;
        element.style.opacity = position.visible ? '1' : '0';
      });
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
