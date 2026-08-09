(function () {
  class SFX {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.sfxGain = null;
      this.musicGain = null;
      this.noiseBuf = null;
      this.volume = 0.8;
      this.ambientNodes = [];
      this.fireZones = new Map();
    }
    ensure() {
      if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 1;
        this.sfxGain.connect(this.master);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.5;
        this.musicGain.connect(this.master);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { console.warn("Audio unavailable", e); }
    }
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
    noise(dur, filterType, freq, gain, opts) {
      if (!this.ctx) return null;
      const o = opts || {};
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = filterType || "bandpass";
      f.frequency.value = freq || 1000;
      f.Q.value = o.q || 1;
      if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.freqEnd), this.ctx.currentTime + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      src.connect(f); f.connect(g); g.connect(o.dest || this.sfxGain);
      src.start();
      src.stop(this.ctx.currentTime + dur + 0.05);
      return src;
    }
    tone(freq, dur, type, gain, opts) {
      if (!this.ctx) return null;
      const o = opts || {};
      const osc = this.ctx.createOscillator();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), this.ctx.currentTime + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.connect(g); g.connect(o.dest || this.sfxGain);
      osc.start(); osc.stop(this.ctx.currentTime + dur + 0.05);
      return osc;
    }
    play(name, opts) {
      if (!this.ctx) return;
      const o = opts || {};
      const t = this.ctx.currentTime;
      switch (name) {
        case "shot_pistol": this.noise(0.10, "highpass", 1200, 0.45, { q: 1.2 }); this.tone(190, 0.09, "square", 0.22, { freqEnd: 80 }); break;
        case "shot_sil": this.noise(0.06, "lowpass", 900, 0.16, { q: 0.6 }); this.tone(140, 0.05, "sine", 0.10, { freqEnd: 70 }); break;
        case "shot_smg": this.noise(0.09, "bandpass", 700, 0.34, { q: 0.8 }); this.tone(150, 0.07, "square", 0.14, { freqEnd: 70 }); break;
        case "shot_rifle": this.noise(0.16, "bandpass", 500, 0.6, { q: 0.7 }); this.tone(120, 0.14, "square", 0.25, { freqEnd: 55 }); break;
        case "shot_awp": this.noise(0.5, "lowpass", 700, 0.85, { q: 0.6, freqEnd: 80 }); this.tone(70, 0.4, "sine", 0.7, { freqEnd: 35 }); break;
        case "shot_shotgun": this.noise(0.28, "lowpass", 900, 0.7, { q: 0.5, freqEnd: 100 }); this.tone(90, 0.2, "square", 0.3, { freqEnd: 45 }); break;
        case "knife_swing": this.noise(0.12, "bandpass", 2400, 0.12, { q: 3, freqEnd: 900 }); break;
        case "knife_hit": this.tone(400, 0.08, "square", 0.15, { freqEnd: 120 }); this.noise(0.06, "highpass", 2000, 0.15); break;
        case "reload_out": this.noise(0.04, "highpass", 2500, 0.2); this.tone(1000, 0.03, "square", 0.08); break;
        case "reload_in": this.noise(0.05, "bandpass", 1800, 0.25); this.tone(700, 0.04, "square", 0.12, { freqEnd: 500 }); break;
        case "reload_slide": this.noise(0.06, "highpass", 1500, 0.2); break;
        case "bolt": this.noise(0.12, "bandpass", 900, 0.3, { freqEnd: 300 }); break;
        case "bounce": this.noise(0.03, "highpass", 2600, 0.12, { q: 2 }); break;
        case "bounce_soft": this.noise(0.05, "lowpass", 700, 0.1); break;
        case "explosion":
          this.noise(1.0, "lowpass", 1200, 0.9, { q: 0.4, freqEnd: 60 });
          this.tone(60, 0.7, "sine", 0.9, { freqEnd: 30 });
          this.noise(0.3, "highpass", 3000, 0.25);
          break;
        case "flash": this.tone(2400, 0.9, "sine", 0.3, { freqEnd: 500 }); this.tone(1200, 0.5, "sine", 0.2, { freqEnd: 800 }); break;
        case "smoke": this.noise(1.4, "bandpass", 800, 0.22, { q: 0.5, freqEnd: 300 }); break;
        case "molotov_break": this.noise(0.25, "highpass", 3000, 0.3); this.tone(1800, 0.2, "square", 0.12, { freqEnd: 400 }); break;
        case "fire_crackle": this.noise(0.35, "bandpass", 900, 0.16, { q: 2 }); break;
        case "plant_beep": this.tone(900, 0.09, "square", 0.2); break;
        case "defuse_beep": this.tone(1250, 0.06, "square", 0.2); break;
        case "bomb_beep": this.tone(1400, 0.08, "square", 0.22); break;
        case "bomb_planted": this.tone(600, 0.25, "square", 0.3, { freqEnd: 900 }); this.tone(900, 0.25, "square", 0.25); break;
        case "hitmarker": this.tone(1600, 0.05, "square", 0.18); break;
        case "hitmarker_head": this.tone(2200, 0.06, "square", 0.2); break;
        case "kill": this.tone(1200, 0.07, "square", 0.2); this.tone(1500, 0.1, "square", 0.15); break;
        case "death": this.noise(0.4, "lowpass", 700, 0.35, { freqEnd: 100 }); break;
        case "footstep_sand": this.noise(0.045, "lowpass", 600, 0.13, { q: 0.8 }); break;
        case "footstep_concrete": this.noise(0.04, "bandpass", 900, 0.12, { q: 1.5 }); this.tone(180, 0.03, "sine", 0.04); break;
        case "footstep_metal": this.noise(0.05, "highpass", 1400, 0.1, { q: 2 }); break;
        case "ui": this.tone(900, 0.04, "square", 0.12); break;
        case "buy": this.tone(700, 0.06, "square", 0.18); this.tone(1100, 0.09, "square", 0.14); break;
        case "deny": this.tone(200, 0.12, "square", 0.2); break;
        case "round_start": this.tone(440, 0.12, "square", 0.15); setTimeout(() => this.tone(660, 0.12, "square", 0.15), 130); setTimeout(() => this.tone(880, 0.2, "square", 0.18), 260); break;
        case "round_t_w": [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "square", 0.2), i * 150)); break;
        case "round_ct_w": [392, 523, 659].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "square", 0.2), i * 150)); break;
        case "round_lose": this.tone(330, 0.3, "square", 0.2); setTimeout(() => this.tone(247, 0.4, "square", 0.2), 260); break;
        case "plant_success": [523, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.15, "square", 0.2), i * 120)); break;
        case "defuse_success": [784, 523, 392].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, "square", 0.22), i * 130)); break;
        case "pickup": this.tone(500, 0.05, "square", 0.12); this.tone(750, 0.06, "square", 0.1); break;
      }
    }
    // Positional 3D sound; auto releases after duration
    pos(name, pos, opts) {
      if (!this.ctx) return;
      const o = opts || {};
      const panner = this.ctx.createPanner();
      panner.panningModel = "equalpower";
      panner.distanceModel = "inverse";
      panner.refDistance = 3;
      panner.maxDistance = 90;
      panner.rolloffFactor = 1.4;
      panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
      panner.connect(this.sfxGain);
      const dest = panner;
      const opts2 = Object.assign({}, o, { dest });
      // Reuse same synth but route into panner
      const oldNoise = this.noise.bind(this);
      const oldTone = this.tone.bind(this);
      const g = this.ctx.createGain();
      g.gain.value = o.vol || 1;
      g.connect(panner);
      const route = { dest: g };
      switch (name) {
        case "shot_pistol": oldNoise(0.10, "highpass", 1200, 0.45, route); oldTone(190, 0.09, "square", 0.22, { dest: g, freqEnd: 80 }); break;
        case "shot_sil": oldNoise(0.06, "lowpass", 900, 0.16, route); break;
        case "shot_smg": oldNoise(0.09, "bandpass", 700, 0.34, route); oldTone(150, 0.07, "square", 0.14, { dest: g, freqEnd: 70 }); break;
        case "shot_rifle": oldNoise(0.16, "bandpass", 500, 0.6, route); oldTone(120, 0.14, "square", 0.25, { dest: g, freqEnd: 55 }); break;
        case "shot_awp": oldNoise(0.5, "lowpass", 700, 0.85, route); oldTone(70, 0.4, "sine", 0.7, { dest: g, freqEnd: 35 }); break;
        case "shot_shotgun": oldNoise(0.28, "lowpass", 900, 0.7, route); break;
        case "explosion": oldNoise(1.0, "lowpass", 1200, 0.9, route); oldTone(60, 0.7, "sine", 0.9, { dest: g, freqEnd: 30 }); break;
        case "bounce": oldNoise(0.03, "highpass", 2600, 0.12, route); break;
        case "smoke": oldNoise(1.4, "bandpass", 800, 0.22, route); break;
        case "molotov_break": oldNoise(0.25, "highpass", 3000, 0.3, route); break;
        case "fire_crackle": oldNoise(0.35, "bandpass", 900, 0.16, route); break;
        case "footstep_sand": oldNoise(0.045, "lowpass", 600, 0.13, route); break;
        case "footstep_concrete": oldNoise(0.04, "bandpass", 900, 0.12, route); break;
        case "footstep_metal": oldNoise(0.05, "highpass", 1400, 0.1, route); break;
        case "bomb_beep": oldTone(1400, 0.08, "square", 0.22, { dest: g }); break;
        case "plant_beep": oldTone(900, 0.09, "square", 0.2, { dest: g }); break;
        case "defuse_beep": oldTone(1250, 0.06, "square", 0.2, { dest: g }); break;
        case "death": oldNoise(0.4, "lowpass", 700, 0.35, route); break;
      }
      setTimeout(() => { try { g.disconnect(); panner.disconnect(); } catch (e) {} }, (o.dur || 1.5) * 1000);
    }
    startAmbience(kind) {
      if (!this.ctx || this.ambientNodes.length) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = kind === "snow" ? 420 : kind === "night" ? 520 : 700;
      const g = this.ctx.createGain();
      g.gain.value = kind === "snow" ? 0.06 : 0.075;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      this.ambientNodes = [src, g, f];
      // slow wind LFO
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.03;
      lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
      this.ambientNodes.push(lfo);
    }
    stopAmbience() {
      this.ambientNodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (e) {} });
      this.ambientNodes = [];
    }
  }
  window.TFPS.SFX = new SFX();
})();
