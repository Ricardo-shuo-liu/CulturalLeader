// 程序化环境音：古琴音色的泛音拨弦 + 噪声底。
// 设计取舍：常用的 CC0 素材站（Wikimedia / Pixabay / freesound）在部分网络环境不可达，
// 这里用 Karplus-Strong 拨弦合成一段五声音阶的古琴循环——零素材、零授权负担，
// 音色虽是"合成古琴"，但作为环境床足够安静耐久；把 CC0 文件放进 frontend/assets/audio/ 会自动优先使用。

/** 确定性伪随机（同一台机器每次生成一致的曲子，便于试听对比）。 */
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 风 / 水的底色：一阶低通染色的粉噪声。 */
export function noiseBuffer(ctx, seconds = 4) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[index] = last * 6 + white * 0.16;
    }
  }
  return buffer;
}

const PENTATONIC = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0]; // D 羽五声音阶

/** 编钟的非谐分音比例（近似曾侯乙编钟的听感：一二分音之外带明显的高次非谐分音）。 */
export const BELL_PARTIALS = [1, 2.02, 2.76, 5.4, 8.93];

/** 合成一记「编钟」：非谐分音叠加 + 各自指数衰减 + 起振噪声。 */
export function bellBuffer(ctx, { base = 196, seconds = 5.5 } = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    BELL_PARTIALS.forEach((ratio, index) => {
      const frequency = base * ratio;
      const decay = 1.6 + index * 1.9; // 高次分音衰减更快
      const amplitude = 0.9 / (index + 1.4);
      const phase = channel * 0.35;
      for (let sample = 0; sample < length; sample += 1) {
        const t = sample / sampleRate;
        const envelope = Math.exp(-t * decay) * (1 - Math.exp(-t * 220));
        data[sample] += Math.sin(2 * Math.PI * frequency * t + phase) * amplitude * envelope;
      }
    });
    // 起振的金属敲击声
    for (let sample = 0; sample < Math.min(length, sampleRate * 0.02); sample += 1) {
      const t = sample / sampleRate;
      data[sample] += (Math.random() * 2 - 1) * Math.exp(-t * 240) * 0.35;
    }
  }
  normalize(buffer, 0.72);
  return buffer;
}

/** 合成一记「石磬」：更高、更短、更清脆。 */
export function chimeBuffer(ctx, { base = 523.25, seconds = 3.2 } = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  [1, 2.4, 3.9, 6.1].forEach((ratio, index) => {
    const frequency = base * ratio;
    const amplitude = 0.7 / (index + 1);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      const phase = channel * 0.5;
      for (let sample = 0; sample < length; sample += 1) {
        const t = sample / sampleRate;
        data[sample] +=
          Math.sin(2 * Math.PI * frequency * t + phase) * amplitude * Math.exp(-t * (4 + index * 2.6));
      }
    }
  });
  normalize(buffer, 0.6);
  return buffer;
}

/** 合成一次「时光流速」whoosh：带通中心频率随时间上扫的噪声。 */
export function whooshBuffer(ctx, { seconds = 1.3, from = 260, to = 2600 } = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    let band = 0;
    for (let sample = 0; sample < length; sample += 1) {
      const t = sample / sampleRate;
      const progress = t / seconds;
      const cutoff = from + (to - from) * progress;
      const f = 2 * Math.sin(Math.PI * (cutoff / sampleRate));
      const q = 0.6;
      const noise = Math.random() * 2 - 1;
      low += f * band;
      const high = noise - low - q * band;
      band += f * high;
      const envelope = Math.sin(Math.PI * Math.min(1, progress)) ** 1.6;
      data[sample] = band * envelope * 0.9;
    }
  }
  normalize(buffer, 0.5);
  return buffer;
}

/** 三段环境音 pad（古代 / 帝制 / 近代）：慢速失谐长音，做朝代氛围的底。 */
export function padLoop(ctx, { root = 73.42, seconds = 20, detune = 0.35 } = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const voices = [1, 1.5, 2.01, 3.02];
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    voices.forEach((ratio, index) => {
      const frequency = root * ratio;
      const amplitude = 0.42 / (index + 1.2);
      for (let sample = 0; sample < length; sample += 1) {
        const t = sample / sampleRate;
        const wobble = 1 + Math.sin(2 * Math.PI * 0.05 * t + index) * detune * 0.004;
        data[sample] += Math.sin(2 * Math.PI * frequency * wobble * t + channel * 0.7) * amplitude;
      }
    });
    // 首尾交叉淡化，循环处不炸耳
    const fade = Math.min(Math.floor(sampleRate * 1.5), Math.floor(length / 2));
    for (let sample = 0; sample < fade; sample += 1) {
      const k = sample / fade;
      data[sample] *= k;
      data[length - 1 - sample] *= k;
    }
  }
  normalize(buffer, 0.5);
  return buffer;
}

function normalize(buffer, peak) {
  let max = 1e-6;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) max = Math.max(max, Math.abs(data[index]));
  }
  const scale = peak / max;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] *= scale;
  }
  return buffer;
}

/** 建造音四件套：石凿 / 夯土 / 木构 / 钢构（各点一声，节流播放）。 */
export function buildStrikeBuffer(ctx, kind = 'brick', seconds = 1.1) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const profiles = {
    stone: { partials: [1, 3.1, 6.4], decay: 6.5, noise: 0.55, noiseDecay: 90 },
    carve: { partials: [1, 2.7, 5.2], decay: 7.5, noise: 0.65, noiseDecay: 120 },
    steel: { partials: [1, 2.02, 3.8, 7.1], decay: 3.2, noise: 0.4, noiseDecay: 160 },
    rammed: { partials: [0.5, 1.2], decay: 5.5, noise: 0.5, noiseDecay: 60 },
    wood: { partials: [0.9, 2.3, 4.1], decay: 8.5, noise: 0.35, noiseDecay: 220 },
    brick: { partials: [1, 2.4, 4.4], decay: 5.8, noise: 0.5, noiseDecay: 110 },
  };
  const profile = profiles[kind] || profiles.brick;
  const base = kind === 'steel' ? 392 : kind === 'wood' ? 196 : kind === 'rammed' ? 98 : 262;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    profile.partials.forEach((ratio, index) => {
      const frequency = base * ratio;
      const amplitude = 0.55 / (index + 1.1);
      for (let sample = 0; sample < length; sample += 1) {
        const t = sample / sampleRate;
        const envelope = Math.exp(-t * profile.decay) * (1 - Math.exp(-t * 400));
        data[sample] += Math.sin(2 * Math.PI * frequency * t + channel * 0.4) * amplitude * envelope;
      }
    });
    for (let sample = 0; sample < Math.min(length, sampleRate * 0.09); sample += 1) {
      const t = sample / sampleRate;
      data[sample] += (Math.random() * 2 - 1) * Math.exp(-t * profile.noiseDecay) * profile.noise;
    }
  }
  normalize(buffer, 0.55);
  return buffer;
}

/**
 * Karplus-Strong 拨弦：直接算进 Float32 数组（离线、无第三方依赖）。
 * @returns {Float32Array} 单音波形（含缓慢衰减）
 */
export function pluck(sampleRate, frequency, seconds, decay = 0.996) {
  const length = Math.floor(sampleRate * seconds);
  const delay = Math.max(2, Math.round(sampleRate / frequency));
  const line = new Float32Array(delay);
  for (let index = 0; index < delay; index += 1) {
    // 激励：一段带轻微低通的噪声
    line[index] = (Math.random() * 2 - 1) * (1 - index / delay * 0.7);
  }
  const out = new Float32Array(length);
  let previous = 0;
  for (let index = 0; index < length; index += 1) {
    const current = line[index % delay];
    const next = decay * (current + previous) * 0.5;
    line[index % delay] = next;
    previous = current;
    out[index] = current;
  }
  return out;
}

/**
 * 生成一段可循环的古琴环境音（约 24 秒）：稀疏拨弦 + 长音，适合当背景。
 * @returns {AudioBuffer}
 */
export function guqinLoop(ctx, seconds = 24, { seed = 20261012, gain = 0.5 } = {}) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * seconds);
  const mix = new Float32Array(length);
  const random = mulberry32(seed);
  // 每 2–4 秒一次拨弦，偶尔叠一个高八度的泛音
  let cursor = 1.5;
  while (cursor < seconds - 4) {
    const note = PENTATONIC[Math.floor(random() * PENTATONIC.length)];
    const start = Math.floor(cursor * sampleRate);
    const voice = pluck(sampleRate, note, 4.5, 0.9955);
    const level = gain * (0.55 + random() * 0.45);
    for (let index = 0; index < voice.length && start + index < length; index += 1) {
      mix[start + index] += voice[index] * level;
    }
    if (random() > 0.55) {
      const octave = pluck(sampleRate, note * 2, 3.2, 0.994);
      const octaveStart = start + Math.floor((0.25 + random() * 0.5) * sampleRate);
      for (let index = 0; index < octave.length && octaveStart + index < length; index += 1) {
        mix[octaveStart + index] += octave[index] * level * 0.32;
      }
    }
    cursor += 1.8 + random() * 2.4;
  }
  // 轻微低通（一阶）+ 归一化，避免刺耳
  const smoothed = new Float32Array(length);
  let running = 0;
  for (let index = 0; index < length; index += 1) {
    running = running * 0.72 + mix[index] * 0.28;
    smoothed[index] = running;
  }
  let peak = 1e-6;
  for (let index = 0; index < length; index += 1) peak = Math.max(peak, Math.abs(smoothed[index]));
  const scale = 0.82 / peak;
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let index = 0; index < length; index += 1) {
    const value = smoothed[index] * scale;
    buffer.getChannelData(0)[index] = value;
    buffer.getChannelData(1)[index] = value * 0.94; // 极轻的立体声差，听起来更开阔
  }
  return buffer;
}
