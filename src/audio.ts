/** Tiny procedural SFX via WebAudio — no audio files to ship or license. */
let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}
export function resumeAudio() {
  ac().resume();
}
export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

function blip(freq: number, dur: number, type: OscillatorType, vol = 0.18) {
  if (muted) return;
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

export const sfx = {
  pickup: () => blip(520 + Math.random() * 80, 0.08, "triangle", 0.08),
  eat: () => { blip(180, 0.18, "sawtooth", 0.16); blip(90, 0.22, "sine", 0.12); },
  death: () => { blip(120, 0.4, "sawtooth", 0.2); blip(60, 0.5, "square", 0.12); },
  power: () => { blip(660, 0.1, "square", 0.14); blip(880, 0.12, "square", 0.12); },
  level: () => { blip(523, 0.1, "triangle", 0.16); blip(784, 0.14, "triangle", 0.16); },
  click: () => blip(440, 0.05, "square", 0.1),
};
