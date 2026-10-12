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
