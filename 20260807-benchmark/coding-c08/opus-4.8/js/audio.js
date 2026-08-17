// audio.js — WebAudio synthesized sound engine (no external files)
let ctx = null, master = null;
let listener = { x: 0, z: 0, ang: 0 };
let enabled = true;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
}
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function setListener(x, z, ang) { listener.x = x; listener.z = z; listener.ang = ang; }
export function setMasterVolume(v) { if (master) master.gain.value = v; }

function panGainFor(x, z) {
  // distance attenuation + stereo pan based on listener orientation
  const dx = x - listener.x, dz = z - listener.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const vol = Math.max(0, 1 - d / 55);
  // relative angle
  const rel = Math.atan2(dx, dz) - listener.ang;
  const pan = Math.max(-1, Math.min(1, Math.sin(rel)));
  return { vol: vol * vol, pan, d };
}
function node(x, z) {
  const g = ctx.createGain();
  const pn = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  let vol = 1;
  if (x !== undefined) {
    const p = panGainFor(x, z);
    vol = p.vol;
    if (pn) pn.pan.value = p.pan;
    if (vol <= 0.001) return null;
  }
  g.gain.value = vol;
  if (pn) { g.connect(pn); pn.connect(master); } else g.connect(master);
  return g;
}
function tone(freq, t, dur, type, gain, out) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  return o;
}
function noiseBuf(dur) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function noiseBurst(t, dur, gain, out, filterFreq, type = 'lowpass') {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + dur + 0.02);
}

export function sfxShot(kind, x, z) {
  if (!ctx || !enabled) return; const out = node(x, z); if (!out) return;
  const t = ctx.currentTime;
  const spec = {
    pistol: { f: 240, d: 0.12, nf: 2600, g: 0.9 },
    smg: { f: 200, d: 0.09, nf: 3000, g: 0.75 },
    rifle: { f: 150, d: 0.16, nf: 2200, g: 1.0 },
    sniper: { f: 90, d: 0.34, nf: 1500, g: 1.2 },
    shotgun: { f: 80, d: 0.28, nf: 1800, g: 1.15 },
  }[kind] || { f: 180, d: 0.13, nf: 2400, g: 0.9 };
  noiseBurst(t, spec.d, spec.g, out, spec.nf, 'lowpass');
  tone(spec.f, t, spec.d * 0.7, 'square', spec.g * 0.5, out);
  tone(spec.f * 0.5, t, spec.d, 'sawtooth', spec.g * 0.3, out);
}
export function sfxReload(x, z) {
  if (!ctx || !enabled) return; const out = node(x, z); if (!out) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.05, 0.4, out, 3000, 'bandpass');
  noiseBurst(t + 0.25, 0.05, 0.4, out, 2000, 'bandpass');
  tone(320, t + 0.5, 0.05, 'square', 0.3, out);
}
export function sfxFootstep(x, z) {
  if (!ctx || !enabled) return; const out = node(x, z); if (!out) return;
  noiseBurst(ctx.currentTime, 0.08, 0.25, out, 700, 'lowpass');
}
export function sfxHit(headshot) {
  if (!ctx || !enabled) return; const out = node(); if (!out) return;
  const t = ctx.currentTime;
  tone(headshot ? 1400 : 900, t, 0.06, 'square', 0.25, out);
}
export function sfxExplosion(x, z) {
  if (!ctx || !enabled) return; const out = node(x, z); if (!out) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.7, 1.2, out, 400, 'lowpass');
  tone(60, t, 0.6, 'sine', 0.9, out);
  tone(40, t, 0.8, 'sine', 0.7, out);
}
export function sfxFlash(x, z) {
  if (!ctx || !enabled) return; const out = node(x, z); if (!out) return;
  const t = ctx.currentTime;
  noiseBurst(t, 0.4, 0.9, out, 6000, 'highpass');
  tone(2000, t, 0.3, 'sine', 0.4, out);
}
export function sfxBeep(high) {
  if (!ctx || !enabled) return; const out = node(); if (!out) return;
  tone(high ? 1600 : 880, ctx.currentTime, 0.08, 'square', 0.3, out);
}
export function sfxTone(freq, dur, g = 0.3, type = 'sine') {
  if (!ctx || !enabled) return; const out = node(); if (!out) return;
  tone(freq, ctx.currentTime, dur, type, g, out);
}
export function sfxPlant(x, z) { sfxBeep(false); }
export function sfxDefuse(x, z) {
  if (!ctx || !enabled) return; const out = node(x, z); if (!out) return;
  noiseBurst(ctx.currentTime, 0.15, 0.3, out, 1500, 'bandpass');
}
export function sfxRoundWin(win) {
  if (!ctx || !enabled) return; const out = node(); if (!out) return;
  const t = ctx.currentTime;
  const notes = win ? [523, 659, 784, 1046] : [392, 330, 262];
  notes.forEach((f, i) => tone(f, t + i * 0.14, 0.3, 'triangle', 0.3, out));
}
