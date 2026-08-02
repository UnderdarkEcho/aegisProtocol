/** Lightweight WebAudio SFX — no asset files required. */

let ctx: AudioContext | null = null;

/** Shared AudioContext for SFX + ambient music (must unlock on a user gesture). */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function ac(): AudioContext | null {
  return getAudioContext();
}

function beep(
  freq: number,
  duration: number,
  type: OscillatorType = 'square',
  gain = 0.04,
  freqEnd?: number,
) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + duration);
  }
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noiseBurst(duration: number, gain = 0.05) {
  const c = ac();
  if (!c) return;
  const n = Math.floor(c.sampleRate * duration);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1200;
  g.gain.value = gain;
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start();
}

export const sfx = {
  unlock() {
    ac();
  },
  select() {
    beep(520, 0.05, 'triangle', 0.03);
  },
  move() {
    beep(180, 0.08, 'sine', 0.035, 90);
  },
  shoot() {
    // Digital zap
    noiseBurst(0.05, 0.05);
    beep(880, 0.04, 'square', 0.035, 180);
    beep(440, 0.05, 'sawtooth', 0.025, 90);
  },
  hit() {
    beep(220, 0.07, 'square', 0.04, 80);
    noiseBurst(0.04, 0.03);
  },
  miss() {
    beep(900, 0.05, 'triangle', 0.02, 1400);
  },
  crit() {
    beep(660, 0.04, 'square', 0.045);
    beep(990, 0.06, 'square', 0.04);
    beep(1320, 0.05, 'triangle', 0.03);
  },
  kill() {
    beep(180, 0.08, 'sawtooth', 0.045, 50);
    beep(90, 0.14, 'square', 0.04, 40);
  },
  overwatch() {
    beep(1200, 0.04, 'triangle', 0.03);
    beep(1600, 0.06, 'triangle', 0.025);
  },
  grenade() {
    noiseBurst(0.18, 0.09);
    beep(120, 0.12, 'sawtooth', 0.05, 40);
    beep(60, 0.15, 'square', 0.04, 30);
  },
  pod() {
    beep(280, 0.08, 'square', 0.04);
    beep(200, 0.1, 'square', 0.04);
    beep(140, 0.14, 'sawtooth', 0.035);
  },
  turn() {
    beep(440, 0.06, 'triangle', 0.03);
  },
  victory() {
    beep(523, 0.1, 'triangle', 0.04);
    setTimeout(() => beep(659, 0.1, 'triangle', 0.04), 100);
    setTimeout(() => beep(784, 0.18, 'triangle', 0.045), 200);
  },
  /** Longer fanfare for campaign stack clear */
  campaignVictory() {
    beep(392, 0.08, 'triangle', 0.035);
    setTimeout(() => beep(523, 0.1, 'triangle', 0.04), 90);
    setTimeout(() => beep(659, 0.1, 'triangle', 0.04), 180);
    setTimeout(() => beep(784, 0.12, 'triangle', 0.045), 280);
    setTimeout(() => beep(1046, 0.22, 'sine', 0.04), 400);
  },
  defeat() {
    beep(300, 0.2, 'sawtooth', 0.05, 80);
  },
  ui() {
    beep(700, 0.04, 'sine', 0.02);
  },
  /** Soft confirm for shop / menus */
  shop() {
    beep(640, 0.04, 'sine', 0.025);
    beep(880, 0.06, 'triangle', 0.03);
  },
  levelUp() {
    beep(440, 0.05, 'triangle', 0.03);
    setTimeout(() => beep(660, 0.06, 'triangle', 0.035), 60);
    setTimeout(() => beep(880, 0.1, 'sine', 0.03), 130);
  },
  /** Soft XP tick */
  xp() {
    beep(980, 0.035, 'sine', 0.018);
  },
  /** Deadline pressure */
  deadline() {
    beep(200, 0.08, 'square', 0.035, 90);
    beep(140, 0.1, 'sawtooth', 0.03, 60);
  },
  jackIn() {
    beep(180, 0.06, 'sine', 0.03, 360);
    setTimeout(() => beep(420, 0.05, 'triangle', 0.03), 80);
    setTimeout(() => beep(720, 0.08, 'sine', 0.028), 150);
  },
  heal() {
    beep(520, 0.05, 'sine', 0.03);
    beep(780, 0.08, 'triangle', 0.025);
  },
};
