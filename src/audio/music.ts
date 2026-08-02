/**
 * Ambient cyber-lofi background — procedural WebAudio presets + optional local file.
 * No bundled asset files required for built-in tracks.
 */
import { getAudioContext } from './sfx';

export type BuiltinTrackId = 'neon-rain' | 'ice-hum' | 'copper-dusk';
export type MusicTrackId = BuiltinTrackId | 'custom';

export interface MusicPrefs {
  enabled: boolean;
  track: MusicTrackId;
  volume: number;
  /** Display name of last custom file (not rehydrated across reloads) */
  customName: string | null;
}

export interface TrackInfo {
  id: MusicTrackId;
  name: string;
  blurb: string;
}

const STORAGE_KEY = 'aegis_music_v1';
const DEFAULT_VOLUME = 0.32;

interface ChordProg {
  /** Root frequencies (Hz) per bar */
  roots: number[];
  /** Chord intervals as multipliers from root */
  intervals: number[];
  bpm: number;
  padGain: number;
  bassGain: number;
  rainGain: number;
  sparkle: boolean;
}

const BUILTINS: Record<BuiltinTrackId, ChordProg & { name: string; blurb: string }> = {
  'neon-rain': {
    name: 'NEON RAIN',
    blurb: 'Soft pad · vinyl hiss · midnight breach',
    // Am – F – C – G (lofi classic, slightly detuned feel)
    roots: [220.0, 174.61, 130.81, 196.0],
    intervals: [1, 1.2, 1.5],
    bpm: 70,
    padGain: 0.028,
    bassGain: 0.04,
    rainGain: 0.012,
    sparkle: true,
  },
  'ice-hum': {
    name: 'ICE HUM',
    blurb: 'Cold drones · sparse pulse · corporate freeze',
    // Dm – Bb – F – C
    roots: [146.83, 116.54, 174.61, 130.81],
    intervals: [1, 1.25, 1.5],
    bpm: 64,
    padGain: 0.034,
    bassGain: 0.035,
    rainGain: 0.006,
    sparkle: false,
  },
  'copper-dusk': {
    name: 'COPPER DUSK',
    blurb: 'Warmer keys · gentle sway · exfil mood',
    // Em – C – G – D
    roots: [164.81, 130.81, 196.0, 146.83],
    intervals: [1, 1.189, 1.498],
    bpm: 76,
    padGain: 0.026,
    bassGain: 0.038,
    rainGain: 0.01,
    sparkle: true,
  },
};

export const MUSIC_TRACKS: TrackInfo[] = [
  { id: 'neon-rain', name: BUILTINS['neon-rain'].name, blurb: BUILTINS['neon-rain'].blurb },
  { id: 'ice-hum', name: BUILTINS['ice-hum'].name, blurb: BUILTINS['ice-hum'].blurb },
  { id: 'copper-dusk', name: BUILTINS['copper-dusk'].name, blurb: BUILTINS['copper-dusk'].blurb },
  { id: 'custom', name: 'LOCAL FILE', blurb: 'Play a .mp3 / .wav / .ogg from your system' },
];

function loadPrefs(): MusicPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { enabled: true, track: 'neon-rain', volume: DEFAULT_VOLUME, customName: null };
    }
    const p = JSON.parse(raw) as Partial<MusicPrefs>;
    const track = (['neon-rain', 'ice-hum', 'copper-dusk', 'custom'] as MusicTrackId[]).includes(
      p.track as MusicTrackId,
    )
      ? (p.track as MusicTrackId)
      : 'neon-rain';
    return {
      enabled: p.enabled !== false,
      track: track === 'custom' && !p.customName ? 'neon-rain' : track,
      volume: clamp01(typeof p.volume === 'number' ? p.volume : DEFAULT_VOLUME),
      customName: typeof p.customName === 'string' ? p.customName : null,
    };
  } catch {
    return { enabled: true, track: 'neon-rain', volume: DEFAULT_VOLUME, customName: null };
  }
}

function savePrefs(p: MusicPrefs) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabled: p.enabled,
        track: p.track,
        volume: p.volume,
        customName: p.customName,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

type Listener = (prefs: MusicPrefs) => void;

class AmbientMusic {
  private prefs = loadPrefs();
  private listeners: Listener[] = [];
  private unlocked = false;
  private running = false;

  // Procedural graph
  private master: GainNode | null = null;
  private timer: number | null = null;
  private step = 0;
  private noiseBuf: AudioBuffer | null = null;

  // Custom file playback
  private fileAudio: HTMLAudioElement | null = null;
  private customUrl: string | null = null;

  getPrefs(): MusicPrefs {
    return { ...this.prefs };
  }

  onChange(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit() {
    const snap = this.getPrefs();
    for (const l of this.listeners) l(snap);
  }

  private persist() {
    savePrefs(this.prefs);
    this.emit();
  }

  /** Call from a user gesture so browsers allow audio. */
  unlock() {
    const c = getAudioContext();
    if (!c) return;
    this.unlocked = true;
    if (this.prefs.enabled) this.start();
  }

  setEnabled(on: boolean) {
    this.prefs.enabled = on;
    this.persist();
    if (on) this.start();
    else this.stop();
  }

  toggle(): boolean {
    this.setEnabled(!this.prefs.enabled);
    return this.prefs.enabled;
  }

  setVolume(v: number) {
    this.prefs.volume = clamp01(v);
    this.persist();
    if (this.master) this.master.gain.value = this.prefs.volume;
    if (this.fileAudio) this.fileAudio.volume = this.prefs.volume;
  }

  setTrack(id: MusicTrackId) {
    if (id === 'custom' && !this.customUrl) {
      // No file loaded yet — keep id for UI; playback waits for loadCustomFile
      this.prefs.track = 'custom';
      this.persist();
      this.stopProcedural();
      return;
    }
    this.prefs.track = id;
    this.persist();
    if (this.prefs.enabled && this.unlocked) this.restart();
  }

  async loadCustomFile(file: File): Promise<boolean> {
    if (!file || !file.type.startsWith('audio/')) {
      // Some systems omit type — still try common extensions
      const okExt = /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name);
      if (!okExt) return false;
    }
    if (this.customUrl) {
      URL.revokeObjectURL(this.customUrl);
      this.customUrl = null;
    }
    if (this.fileAudio) {
      this.fileAudio.pause();
      this.fileAudio.src = '';
      this.fileAudio = null;
    }

    this.customUrl = URL.createObjectURL(file);
    const audio = new Audio();
    audio.src = this.customUrl;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = this.prefs.volume;

    try {
      await audio.play().catch(() => undefined);
      audio.pause();
      audio.currentTime = 0;
    } catch {
      /* decode probe optional */
    }

    this.fileAudio = audio;
    this.prefs.track = 'custom';
    this.prefs.customName = file.name;
    this.persist();
    if (this.prefs.enabled) this.start();
    return true;
  }

  clearCustomFile() {
    if (this.customUrl) URL.revokeObjectURL(this.customUrl);
    this.customUrl = null;
    if (this.fileAudio) {
      this.fileAudio.pause();
      this.fileAudio.src = '';
      this.fileAudio = null;
    }
    this.prefs.customName = null;
    if (this.prefs.track === 'custom') this.prefs.track = 'neon-rain';
    this.persist();
    if (this.prefs.enabled && this.unlocked) this.restart();
  }

  start() {
    if (!this.prefs.enabled) return;
    const c = getAudioContext();
    if (!c) return;
    this.unlocked = true;
    this.running = true;

    if (this.prefs.track === 'custom') {
      this.stopProcedural();
      if (this.fileAudio) {
        this.fileAudio.volume = this.prefs.volume;
        void this.fileAudio.play().catch(() => undefined);
      }
      return;
    }

    this.stopFile();
    this.ensureMaster(c);
    this.startProcedural(c);
  }

  stop() {
    this.running = false;
    this.stopProcedural();
    this.stopFile();
  }

  private restart() {
    this.stop();
    this.start();
  }

  private ensureMaster(c: AudioContext) {
    if (this.master) {
      this.master.gain.value = this.prefs.volume;
      return;
    }
    this.master = c.createGain();
    this.master.gain.value = this.prefs.volume;
    this.master.connect(c.destination);
  }

  private getNoise(c: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Soft brownish noise for rain/vinyl
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    this.noiseBuf = buf;
    return buf;
  }

  private stopFile() {
    if (this.fileAudio) {
      this.fileAudio.pause();
      try {
        this.fileAudio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
  }

  private stopProcedural() {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.step = 0;
  }

  private startProcedural(c: AudioContext) {
    this.stopProcedural();
    if (!this.master) return;
    const id = this.prefs.track as BuiltinTrackId;
    const track = BUILTINS[id] ?? BUILTINS['neon-rain'];
    const barMs = (60_000 / track.bpm) * 4;
    const beatMs = 60_000 / track.bpm;

    // Schedule immediately then on interval
    const tick = () => {
      if (!this.running || !this.master || this.prefs.track === 'custom') return;
      const t0 = c.currentTime + 0.04;
      const bar = this.step % track.roots.length;
      const root = track.roots[bar]!;

      // Pad chord
      for (const mult of track.intervals) {
        this.playPad(c, root * mult, t0, barMs / 1000, track.padGain);
      }
      // Sub bass
      this.playBass(c, root * 0.5, t0, barMs / 1000, track.bassGain);
      // Soft rain bed once per bar
      this.playRain(c, t0, barMs / 1000, track.rainGain);
      // Sparse sparkle on bars 0 and 2
      if (track.sparkle && bar % 2 === 0) {
        this.playSparkle(c, root * 2, t0 + (beatMs / 1000) * 1.5, 0.35);
      }

      this.step += 1;
    };

    tick();
    this.timer = window.setInterval(tick, barMs);
  }

  private playPad(c: AudioContext, freq: number, t0: number, dur: number, gain: number) {
    if (!this.master) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.value = freq * (1 + (Math.random() * 0.004 - 0.002));
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.95);
    osc.connect(f);
    f.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);

    // Detuned twin for width
    const osc2 = c.createOscillator();
    const g2 = c.createGain();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 1.003;
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(gain * 0.45, t0 + dur * 0.4);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.95);
    osc2.connect(g2);
    g2.connect(this.master);
    osc2.start(t0);
    osc2.stop(t0 + dur + 0.05);
  }

  private playBass(c: AudioContext, freq: number, t0: number, dur: number, gain: number) {
    if (!this.master) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Two soft pulses in the bar
    const pulse = dur / 2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + pulse * 0.7);
    g.gain.setValueAtTime(0.0001, t0 + pulse);
    g.gain.exponentialRampToValueAtTime(gain * 0.75, t0 + pulse + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.95);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private playRain(c: AudioContext, t0: number, dur: number, gain: number) {
    if (!this.master || gain <= 0) return;
    const src = c.createBufferSource();
    src.buffer = this.getNoise(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.95);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private playSparkle(c: AudioContext, freq: number, t0: number, dur: number) {
    if (!this.master) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.012, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

export const music = new AmbientMusic();
