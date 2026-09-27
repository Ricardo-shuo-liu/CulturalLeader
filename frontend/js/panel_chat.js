// 流程编辑 / 我的攻略面板里的「问数字人」小面板。
// 复用主舞台那一个 Live2D 数字人与同一套语音链路，边规划边问，不用先退回沙盘。

const $ = (id) => document.getElementById(id);

export function createPanelChat({ onAsk, onMicStart, onMicEnd } = {}) {
  const root = $('planner-chat');
  const log = $('planner-chat-log');
  const input = $('planner-chat-input');
  const cityLabel = $('planner-chat-city');
  const mic = $('planner-chat-mic');
  const sendButton = $('planner-chat-send');
  const foldButton = $('planner-chat-fold');
  const state = { city: null, sessionId: null, assistant: null, folded: false };

  function scroll() {
    if (log) log.scrollTop = log.scrollHeight;
  }

  function add(role, text) {
    if (!log) return null;
    const row = document.createElement('div');
    row.className = `pc-msg ${role}`;
    row.textContent = text;
    log.appendChild(row);
    scroll();
    return row;
  }

  function setCity(city) {
    const name = city?.name || '';
    const sameCity = state.city?.name === name && Boolean(name);
    state.city = name ? { name, slug: city.slug || '' } : null;
    if (!sameCity) state.sessionId = null;
    if (cityLabel) cityLabel.textContent = name ? `正在讲解：${name}` : '还没选城市';
    if (log && !sameCity) {
      log.innerHTML = '';
      if (name) {
        add('system', `可以问我关于「${name}」的问题，比如“这里最值得看什么”“怎么安排一天”。`);
      }
    }
  }

  function begin() {
    state.assistant = add('assistant', '');
  }

  function appendToken(text) {
    if (!text) return;
    if (!state.assistant) state.assistant = add('assistant', '');
    state.assistant.textContent += text;
    scroll();
  }

  function setSpeech(text) {
    if (!text) return;
    if (!state.assistant) {
      state.assistant = add('assistant', text);
      return;
    }
    if (!state.assistant.textContent.trim()) state.assistant.textContent = text;
  }

  function end() {
    state.assistant = null;
  }

  function addUser(text) {
    add('user', text);
  }

  function addSystem(text) {
    if (text) add('system', text);
  }

  async function send() {
    const text = input?.value.trim();
    if (!text || !onAsk) return;
    input.value = '';
    addUser(text);
    await onAsk(text);
  }

  sendButton?.addEventListener('click', () => send());
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  let recording = false;
  const startRecording = async () => {
    if (recording || !onMicStart) return;
    try {
      await onMicStart();
      recording = true;
      mic?.classList.add('recording');
      if (mic) mic.textContent = '松开结束';
    } catch (error) {
      recording = false;
      mic?.classList.remove('recording');
      if (mic) mic.textContent = '按住说话';
      addSystem(error.message || '无法开始录音');
    }
  };
  const stopRecording = async () => {
    if (!recording || !onMicEnd) return;
    recording = false;
    mic?.classList.remove('recording');
    if (mic) mic.textContent = '按住说话';
    try {
      const text = await onMicEnd();
      if (text) {
        addUser(text);
        await onAsk?.(text);
      }
    } catch (error) {
      addSystem(error.message || '语音识别失败');
    }
  };
  mic?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startRecording();
  });
  mic?.addEventListener('pointerup', (event) => {
    event.preventDefault();
    stopRecording();
  });
  mic?.addEventListener('pointerleave', () => stopRecording());
  mic?.addEventListener('pointercancel', () => stopRecording());

  foldButton?.addEventListener('click', () => {
    state.folded = !state.folded;
    root?.classList.toggle('folded', state.folded);
    if (foldButton) foldButton.textContent = state.folded ? '展开' : '收起';
  });

  return {
    setCity,
    addUser,
    addSystem,
    begin,
    appendToken,
    setSpeech,
    end,
    focus: () => input?.focus(),
    get sessionId() {
      return state.sessionId;
    },
    set sessionId(value) {
      state.sessionId = value;
    },
    get city() {
      return state.city;
    },
  };
}
