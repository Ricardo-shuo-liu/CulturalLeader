// 语音链路：SSE 对话 + TTS 队列 + 录音识别，全部支持浏览器端降级。

export class VoiceIO {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audioContext = null;
    this.analyser = null;
    this.analyserData = null;
    this.sourceNode = null;
    this.queue = [];
    this.speaking = false;
    this.ttsUnavailable = false;
    this.ttsHint = '';
    this.voiceWarned = false;
    this.asrUnavailable = false;
    this.recorder = null;
    this.chunks = [];
    this.recognition = null;
    this.syntheticPhase = 0;
    this.lastLevel = 0;
    this.abortController = null;
  }

  /** 用户手势后才能创建 AudioContext。 */
  ensureAudio() {
    if (this.audioContext) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.audioContext = new Ctor();
    try {
      this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyserData = new Uint8Array(this.analyser.fftSize);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    } catch (error) {
      console.warn('[voice] 音频分析不可用', error);
    }
  }

  /** 当前张口幅度 0..1。 */
  level() {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.analyserData);
      let sum = 0;
      for (let i = 0; i < this.analyserData.length; i += 1) {
        const value = (this.analyserData[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / this.analyserData.length);
      const enriched = Math.min(1, rms * 3.4);
      this.lastLevel += (enriched - this.lastLevel) * 0.45;
      return this.lastLevel;
    }
    if (this.speaking) {
      this.syntheticPhase += 0.22;
      const value = 0.28 + 0.34 * Math.abs(Math.sin(this.syntheticPhase)) + 0.12 * Math.sin(this.syntheticPhase * 2.3);
      return Math.min(1, Math.max(0, value));
    }
    this.lastLevel *= 0.85;
    return this.lastLevel;
  }

  /** 提问：读取 SSE 流，回调 token / sentence / done。 */
  async ask(citySlug, message, sessionId, cityName = '') {
    this.abortController?.abort();
    this.abortController = new AbortController();
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city_slug: citySlug, city_name: cityName || '', message, session_id: sessionId || null }),
      signal: this.abortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`对话请求失败：${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let session = sessionId || null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\n\n');
        const event = this.parseEvent(block);
        if (!event) continue;
        if (event.event === 'meta') {
          session = event.data.session_id || session;
        } else if (event.event === 'token') {
          this.handlers.onToken?.(event.data.text);
        } else if (event.event === 'sentence') {
          this.handlers.onSentence?.(event.data.text);
        } else if (event.event === 'human') {
          // Fay 风格数字人指令：Topic=human，Data.Key=audio，含 Action/Sentiment
          this.handlers.onHuman?.(event.data);
        } else if (event.event === 'error') {
          this.handlers.onError?.(event.data.message);
        }
      }
    }
    this.handlers.onDone?.(session);
    return session;
  }

  parseEvent(block) {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return null;
    try {
      return { event, data: JSON.parse(data) };
    } catch (error) {
      return null;
    }
  }

  /** 逐句送入朗读队列。 */
  enqueue(text) {
    if (!text || !text.trim()) return;
    this.queue.push(text.trim());
    if (!this.speaking) this.drain();
  }

  async drain() {
    if (this.speaking) return;
    const next = this.queue.shift();
    if (!next) {
      this.handlers.onIdle?.();
      return;
    }
    this.speaking = true;
    this.handlers.onSpeakStart?.(next);
    try {
      await this.speak(next);
    } catch (error) {
      console.warn('[voice] 朗读失败', error);
    }
    this.speaking = false;
    this.handlers.onSpeakEnd?.(next);
    if (this.queue.length) this.drain();
    else this.handlers.onIdle?.();
  }

  async speak(text) {
    if (!this.ttsUnavailable) {
      try {
        const response = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          // 501 = 没配云端语音；402 = 余额不足；502 = 服务不支持 TTS。
          // 统一标记为不可用（不再每句话重试），并把原因告诉用户一次。
          this.ttsUnavailable = true;
          try {
            const detail = await response.json();
            this.ttsHint =
              typeof detail?.detail === 'string' ? detail.detail : detail?.detail?.message || detail?.detail?.code || '';
          } catch (error) {
            this.ttsHint = '';
          }
          this.notifyVoiceUnavailable(this.ttsHint || '云端语音不可用，已切换浏览器语音');
        } else if (response.ok) {
          const blob = await response.blob();
          this.ensureAudio();
          const url = URL.createObjectURL(blob);
          this.audio.src = url;
          await this.audio.play();
          await new Promise((resolve) => {
            const done = () => {
              this.audio.removeEventListener('ended', done);
              this.audio.removeEventListener('error', done);
              URL.revokeObjectURL(url);
              resolve();
            };
            this.audio.addEventListener('ended', done);
            this.audio.addEventListener('error', done);
          });
          return;
        }
      } catch (error) {
        console.warn('[voice] 云端 TTS 不可用，改用浏览器语音', error);
        this.ttsUnavailable = true;
      }
    }
    await this.browserSpeak(text);
  }

  /** 浏览器语音：等语音列表加载、优先挑中文音色；没有音色就明确告知「出不了声」。 */
  async browserSpeak(text) {
    const estimate = () => new Promise((resolve) => setTimeout(resolve, Math.max(700, text.length * 130)));
    if (!('speechSynthesis' in window)) {
      this.notifyVoiceUnavailable('这个浏览器不支持语音合成，请配置 TTS_API_KEY / TTS_BASE_URL 后使用云端语音');
      return estimate();
    }
    const synth = window.speechSynthesis;
    let voices = synth.getVoices() || [];
    if (!voices.length) {
      voices = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(synth.getVoices() || []), 1200);
        synth.addEventListener?.('voiceschanged', () => {
          clearTimeout(timer);
          resolve(synth.getVoices() || []);
        }, { once: true });
      });
    }
    if (!voices.length) {
      this.notifyVoiceUnavailable(
        '系统里没有可用的语音包（Linux 常见）：安装 speech-dispatcher 或 espeak-ng 后重启浏览器即可出声；也可以配置 TTS_API_KEY / TTS_BASE_URL 用云端语音',
      );
      return estimate();
    }
    const chinese = voices.filter(
      (voice) => /^zh/i.test(voice.lang || '') || /(Chinese|Mandarin|中文|普通话|Kangkang|Huihui|Yaoyao)/i.test(voice.name || ''),
    );
    if (!chinese.length) {
      // 没有中文音色时不要用英文音色硬读中文（听起来就是“奇怪的语音”）
      this.notifyVoiceUnavailable(
        `系统里没有中文语音包，已停止朗读以免听不清（可用音色：${voices.length} 个）。` +
          '安装 speech-dispatcher / espeak-ng 或配置云端 TTS 后即可正常出声',
      );
      return estimate();
    }
    const preferred =
      chinese.find((voice) => /zh[-_]CN/i.test(voice.lang) && /(Xiaoxiao|Yunxi|Ting|Mei|Huihui|Yaoyao)/i.test(voice.name)) ||
      chinese.find((voice) => /zh[-_]CN/i.test(voice.lang)) ||
      chinese[0];
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = preferred?.lang || 'zh-CN';
      if (preferred) utterance.voice = preferred;
      utterance.rate = 1.02;
      utterance.pitch = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      try {
        synth.speak(utterance);
      } catch (error) {
        this.notifyVoiceUnavailable('浏览器语音播放失败，可配置 TTS_API_KEY / TTS_BASE_URL 使用云端语音');
        resolve();
      }
    });
  }

  notifyVoiceUnavailable(message) {
    if (this.voiceWarned) return;
    this.voiceWarned = true;
    this.handlers.onVoiceUnavailable?.(message);
  }

  stopSpeaking() {
    this.queue = [];
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try {
      this.audio.pause();
    } catch (error) {
      /* 忽略 */
    }
    this.speaking = false;
    this.syntheticPhase = 0;
    this.handlers.onIdle?.();
  }

  /** 开始录音。 */
  async startRecording() {
    this.ensureAudio();
    this.stopPlayingOnly();
    if (!navigator.mediaDevices?.getUserMedia) {
      return this.startBrowserRecognition();
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const recorder = new MediaRecorder(stream);
    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.start();
    return true;
  }

  stopPlayingOnly() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    try {
      this.audio.pause();
    } catch (error) {
      /* 忽略 */
    }
    this.queue = [];
    this.speaking = false;
  }

  /** 结束录音并识别，返回文本。 */
  async stopRecording() {
    if (this.recognition) {
      return null; // 浏览器识别通过回调返回
    }
    if (!this.recorder) return null;
    const recorder = this.recorder;
    const stream = recorder.stream;
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.stop();
    });
    stream.getTracks().forEach((track) => track.stop());
    this.recorder = null;
    if (!blob.size) return null;

    const form = new FormData();
    form.append('file', blob, 'speech.webm');
    const response = await fetch('/api/asr', { method: 'POST', body: form });
    if (response.status === 501) {
      this.asrUnavailable = true;
      throw new Error('未配置云端语音识别，请使用文字输入');
    }
    if (!response.ok) {
      throw new Error(`识别失败：${response.status}`);
    }
    const data = await response.json();
    return data.text || null;
  }

  /** 浏览器内置识别的兜底方案。 */
  startBrowserRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      throw new Error('当前浏览器不支持录音识别，请使用文字输入');
    }
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    this.recognition = recognition;
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || '';
      this.handlers.onRecognized?.(text);
    };
    recognition.onerror = () => {
      this.recognition = null;
      this.handlers.onRecognizeError?.('识别失败，请重试或使用文字输入');
    };
    recognition.onend = () => {
      this.recognition = null;
    };
    recognition.start();
    return true;
  }

  stopBrowserRecognition() {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        /* 忽略 */
      }
    }
  }
}
