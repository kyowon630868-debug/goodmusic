// 오디오 엔진
// 배경음은 레포에 있는 캐롤을 느린 속도 + 로우패스로 재생해 오르골처럼 뭉갠다.
// 긴장도(tension)가 오르면 필터가 열리고 재생 속도가 붙으면서 곡이 "깨어난다".

const CREEPY_TRACK = 'Christmas Time Again.mp3';
const ESCAPE_TRACK = 'A Magical Evening Begins.mp3';

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.buffers = {};
    this.music = null;
    this.tension = 0;
    this.lastFootstep = 0;
    this.lastHeartbeat = 0;
    this.lastJingle = 0;
  }

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicFilter = this.ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 420;
    this.musicFilter.Q.value = 1.6;
    this.musicGain.connect(this.musicFilter);
    this.musicFilter.connect(this.master);

    this.noiseBuffer = this._makeNoise(2);
    this.ready = true;
  }

  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  async loadTracks(onProgress) {
    const files = [
      ['creepy', CREEPY_TRACK],
      ['escape', ESCAPE_TRACK],
    ];
    let done = 0;
    for (const [name, file] of files) {
      try {
        const res = await fetch(encodeURIComponent(file));
        const arr = await res.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(arr);
      } catch (err) {
        // 음악이 없어도 게임은 돌아가야 한다
        console.warn('오디오 로드 실패:', file, err);
      }
      done++;
      if (onProgress) onProgress(done / files.length);
    }
  }

  startCreepyMusic() {
    this.stopMusic();
    if (!this.buffers.creepy) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.creepy;
    src.loop = true;
    src.playbackRate.value = 0.72;
    src.connect(this.musicGain);
    src.start(0);
    this.music = src;
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + 3);
  }

  playEscapeMusic() {
    this.stopMusic();
    if (!this.buffers.escape) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.escape;
    src.loop = true;
    src.connect(this.musicGain);
    src.start(0);
    this.music = src;
    this.musicFilter.frequency.cancelScheduledValues(this.ctx.currentTime);
    this.musicFilter.frequency.setTargetAtTime(14000, this.ctx.currentTime, 0.6);
    this.musicGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.5);
  }

  stopMusic() {
    if (this.music) {
      try {
        this.music.stop();
      } catch (e) {
        /* 이미 멈춘 소스 */
      }
      this.music = null;
    }
  }

  // 0(안전) ~ 1(추격당하는 중)
  setTension(t) {
    if (!this.ready || !this.music) return;
    this.tension = t;
    const now = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(400 + t * t * 3600, now, 0.25);
    this.musicGain.gain.setTargetAtTime(0.2 + t * 0.35, now, 0.3);
    this.music.playbackRate.setTargetAtTime(0.72 + t * 0.34, now, 0.5);
  }

  _env(node, peak, attack, decay, when) {
    const t = when ?? this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  footstep(sprinting) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.6 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 260 + Math.random() * 160;
    filter.Q.value = 1.1;
    const gain = this.ctx.createGain();
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, sprinting ? 0.3 : 0.16, 0.005, 0.1, now);
    src.start(now);
    src.stop(now + 0.2);
  }

  pickup() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    [880, 1320, 1760].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.sfxBus);
      this._env(gain, 0.2, 0.01, 0.5, now + i * 0.08);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.6);
    });
  }

  battery() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.12);
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, 0.12, 0.01, 0.14, now);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  lightSwitch(on) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = on ? 2600 : 1600;
    const gain = this.ctx.createGain();
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, 0.18, 0.002, 0.05, now);
    src.start(now);
    src.stop(now + 0.1);
  }

  // 가장 가까운 선물이 내는 방울 소리. 거리로 볼륨을 판단해 방향을 잡는다.
  jingle(closeness) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const carrier = this.ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = 1600 + closeness * 600;
    const mod = this.ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = 2400;
    const modGain = this.ctx.createGain();
    modGain.gain.value = 900;
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const gain = this.ctx.createGain();
    carrier.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, 0.02 + closeness * 0.14, 0.005, 0.35, now);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + 0.5);
    mod.stop(now + 0.5);
  }

  heartbeat(intensity) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    for (const [offset, amp] of [[0, 1], [0.18, 0.65]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(78, now + offset);
      osc.frequency.exponentialRampToValueAtTime(38, now + offset + 0.14);
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.sfxBus);
      this._env(gain, 0.25 * intensity * amp, 0.01, 0.16, now + offset);
      osc.start(now + offset);
      osc.stop(now + offset + 0.35);
    }
  }

  // 가까이 있을 때 들리는 숨소리 — 어둠 속에서 유일한 경고다
  breath(closeness) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.35;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.linearRampToValueAtTime(520, now + 0.6);
    filter.Q.value = 2.4;
    const gain = this.ctx.createGain();
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, 0.05 + closeness * 0.3, 0.25, 0.55, now);
    src.start(now);
    src.stop(now + 1.1);
  }

  // 그것이 당신을 발견했을 때
  spotted() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 3;
    const gain = this.ctx.createGain();
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, 0.3, 0.02, 0.5, now);
    osc.start(now);
    osc.stop(now + 0.9);
  }

  jumpscare() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const nFilter = this.ctx.createBiquadFilter();
    nFilter.type = 'highpass';
    nFilter.frequency.value = 800;
    const nGain = this.ctx.createGain();
    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(this.master);
    this._env(nGain, 0.55, 0.005, 1.1, now);
    noise.start(now);
    noise.stop(now + 1.4);

    [55, 82, 110, 233].forEach((freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq * 3, now);
      osc.frequency.exponentialRampToValueAtTime(freq, now + 0.7);
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.master);
      this._env(gain, 0.22, 0.005, 1.2, now);
      osc.start(now);
      osc.stop(now + 1.5);
    });

    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(0, now, 0.2);
  }

  door() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.25;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    filter.frequency.linearRampToValueAtTime(900, now + 0.8);
    const gain = this.ctx.createGain();
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    this._env(gain, 0.3, 0.05, 0.9, now);
    src.start(now);
    src.stop(now + 1.2);
  }
}
