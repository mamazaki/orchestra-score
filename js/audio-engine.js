/**
 * MaestroAudioEngine — Polyphonic WebAudio Synth, Precision Metronome,
 * Reference Tone Generator & Autocorrelation Chromatic Tuner
 */
class MaestroAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;

    // Score playback state
    this.isPlaying = false;
    this.isPaused = false;
    this.playbackTimer = null;
    this.sequence = null;
    this.partMixer = {}; // { partId: { muted, solo, volume, timbre } }
    this.tempoBpm = 110;
    this.tempoMultiplier = 1.0;
    this.currentBeat = 0;
    this.nextEventIdx = 0;
    this.lastScheduleTime = 0;
    this.activeOscs = new Set();
    this.callbacks = {};

    // Metronome state
    this.metroRunning = false;
    this.metroBpm = 120;
    this.metroBeatsPerBar = 4;
    this.metroCurrentBeat = 0;
    this.metroNextTime = 0;
    this.metroTimer = null;
    this.onMetroBeat = null;

    // Reference tone state
    this.refOsc = null;
    this.refGain = null;

    // Mic tuner state
    this.tunerStream = null;
    this.tunerAnalyser = null;
    this.tunerRaf = null;
    this.tunerSource = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.7;

      // Mild compressor to prevent clipping in multi-part orchestra chords
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.masterGain.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  static midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  static guessTimbre(partName = '') {
    const n = partName.toLowerCase();
    if (/sax|tenor\s*sax|alto\s*sax|bari\s*sax|soprano\s*sax/.test(n)) return 'saxophone';
    if (/flute|piccolo|oboe|clarinet|bassoon|recorder/.test(n)) return 'woodwind';
    if (/trumpet|cornet|horn|trombone|tuba|euphonium|brass|sousaphone/.test(n)) return 'brass';
    if (/violin|viola|cello|contrabass|string/.test(n)) return 'strings';
    if (/drum|snare|perc|timpani|cymbal/.test(n)) return 'percussion';
    return 'brass';
  }

  scheduleNote(midi, startTime, durationSec, timbre = 'brass', volume = 0.5) {
    const ctx = this.ensureContext();
    const dur = Math.max(0.06, durationSec);
    const vol = Math.max(0, Math.min(1, volume)) * 0.28;
    if (vol <= 0.001) return;

    if (timbre === 'percussion') {
      this.schedulePercussion(startTime, vol, midi);
      return;
    }

    const freq = MaestroAudioEngine.midiToFreq(midi);
    const gainNode = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    if (timbre === 'saxophone') {
      // Warm expressive reed timbre (sawtooth + sub triangle + gentle vibrato)
      const oscMain = ctx.createOscillator();
      const oscBody = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const bodyGain = ctx.createGain();

      oscMain.type = 'sawtooth';
      oscBody.type = 'triangle';
      oscMain.frequency.setValueAtTime(freq, startTime);
      oscBody.frequency.setValueAtTime(freq, startTime);

      // Vibrato engages gently after initial attack
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(5.2, startTime);
      lfoGain.gain.setValueAtTime(0, startTime);
      lfoGain.gain.linearRampToValueAtTime(freq * 0.006, startTime + Math.min(0.25, dur * 0.4));
      lfo.connect(lfoGain);
      lfoGain.connect(oscMain.frequency);
      lfoGain.connect(oscBody.frequency);

      filter.type = 'lowpass';
      filter.Q.setValueAtTime(2.6, startTime);
      filter.frequency.setValueAtTime(Math.max(500, freq * 1.8), startTime);
      filter.frequency.linearRampToValueAtTime(Math.min(3600, freq * 4.2), startTime + 0.055);
      filter.frequency.exponentialRampToValueAtTime(Math.max(650, freq * 2.5), startTime + dur);

      bodyGain.gain.setValueAtTime(0.45, startTime);
      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(vol * 1.15, startTime + 0.045);
      gainNode.gain.setValueAtTime(vol * 0.95, startTime + Math.max(0.05, dur - 0.05));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

      oscMain.connect(filter);
      oscBody.connect(bodyGain);
      bodyGain.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);

      oscMain.start(startTime);
      oscBody.start(startTime);
      lfo.start(startTime);
      oscMain.stop(startTime + dur + 0.04);
      oscBody.stop(startTime + dur + 0.04);
      lfo.stop(startTime + dur + 0.04);
      this.trackOsc(oscMain);
      this.trackOsc(oscBody);
      this.trackOsc(lfo);
    } else if (timbre === 'woodwind') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(4000, freq * 4), startTime);

      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(vol * 0.9, startTime + 0.035);
      gainNode.gain.exponentialRampToValueAtTime(vol * 0.65, startTime + Math.min(dur * 0.7, 0.25));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + dur + 0.03);
      this.trackOsc(osc);
    } else if (timbre === 'strings') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 1.003, startTime); // subtle ensemble chorus

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(3500, freq * 3.5), startTime);

      const attack = Math.min(0.09, dur * 0.25);
      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(vol * 0.7, startTime + attack);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(startTime + dur + 0.04);
      osc2.stop(startTime + dur + 0.04);
      this.trackOsc(osc1);
      this.trackOsc(osc2);
    } else {
      // Brass (bright attack filter envelope)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, startTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.max(400, freq * 1.5), startTime);
      filter.frequency.linearRampToValueAtTime(Math.min(4800, freq * 5.2), startTime + 0.04);
      filter.frequency.exponentialRampToValueAtTime(Math.max(500, freq * 2.4), startTime + dur);

      gainNode.gain.setValueAtTime(0.0001, startTime);
      gainNode.gain.linearRampToValueAtTime(vol, startTime + 0.025);
      gainNode.gain.setValueAtTime(vol * 0.85, startTime + Math.max(0.03, dur - 0.04));
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + dur + 0.03);
      this.trackOsc(osc);
    }
  }

  schedulePercussion(startTime, vol, midi) {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const baseFreq = midi < 50 ? 110 : 220;
    osc.frequency.setValueAtTime(baseFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(42, startTime + 0.12);
    gain.gain.setValueAtTime(vol * 1.3, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + 0.16);
    this.trackOsc(osc);
  }

  trackOsc(osc) {
    this.activeOscs.add(osc);
    osc.onended = () => this.activeOscs.delete(osc);
  }

  stopAllNotes() {
    this.activeOscs.forEach((osc) => {
      try { osc.stop(); } catch (_) {}
    });
    this.activeOscs.clear();
  }

  // =========================================================================
  // Score Sequence Playback
  // =========================================================================
  loadSequence(sequence, mixerConfig = {}) {
    this.stopPlayback();
    this.sequence = sequence;
    this.partMixer = mixerConfig;
    if (sequence && sequence.tempoBpm) {
      this.tempoBpm = sequence.tempoBpm;
    }
  }

  setTempo(bpm, mult = 1.0) {
    this.tempoBpm = Math.max(30, Math.min(240, Number(bpm) || 110));
    this.tempoMultiplier = Number(mult) || 1.0;
  }

  updatePartMixer(mixerConfig) {
    this.partMixer = mixerConfig;
  }

  startPlayback(callbacks = {}) {
    if (!this.sequence || !this.sequence.events.length) return;
    this.ensureContext();
    this.callbacks = callbacks;

    if (!this.isPaused) {
      this.currentBeat = 0;
      this.nextEventIdx = 0;
    }

    this.isPlaying = true;
    this.isPaused = false;
    this.lastScheduleTime = this.ctx.currentTime;

    if (this.playbackTimer) clearInterval(this.playbackTimer);
    this.playbackTimer = setInterval(() => this.tickPlayback(), 35);
    this.tickPlayback();
  }

  pausePlayback() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.isPaused = true;
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.stopAllNotes();
  }

  stopPlayback() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentBeat = 0;
    this.nextEventIdx = 0;
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
    this.stopAllNotes();
  }

  tickPlayback() {
    if (!this.isPlaying || !this.sequence) return;
    const now = this.ctx.currentTime;
    const dt = now - this.lastScheduleTime;
    this.lastScheduleTime = now;

    const effectiveBpm = this.tempoBpm * this.tempoMultiplier;
    const beatsPerSec = effectiveBpm / 60;
    this.currentBeat += dt * beatsPerSec;

    const lookaheadBeats = 0.25 * beatsPerSec;
    const horizonBeat = this.currentBeat + lookaheadBeats;

    const anySolo = Object.values(this.partMixer).some((m) => m.solo);
    const events = this.sequence.events;

    let latestMeasure = null;

    while (this.nextEventIdx < events.length && events[this.nextEventIdx].startBeat <= horizonBeat) {
      const ev = events[this.nextEventIdx];
      this.nextEventIdx++;

      const mix = this.partMixer[ev.partId] || { muted: false, solo: false, volume: 0.85, timbre: 'brass' };
      const audible = anySolo ? mix.solo : !mix.muted;

      const beatDelta = Math.max(0, ev.startBeat - this.currentBeat);
      const startTime = now + beatDelta / beatsPerSec;
      const durSec = (ev.durationBeats * 0.92) / beatsPerSec;

      if (audible && ev.midiPitch !== null) {
        this.scheduleNote(ev.midiPitch, startTime, durSec, mix.timbre, mix.volume);
      }

      latestMeasure = ev.measureNumber;
    }

    if (this.callbacks.onProgress) {
      this.callbacks.onProgress({
        currentBeat: this.currentBeat,
        totalBeats: this.sequence.totalBeats,
        measureNumber: latestMeasure
      });
    }

    if (this.currentBeat >= this.sequence.totalBeats + 0.5) {
      this.stopPlayback();
      if (this.callbacks.onEnded) this.callbacks.onEnded();
    }
  }

  // =========================================================================
  // Precision Metronome
  // =========================================================================
  startMetronome(bpm, beatsPerBar, onBeat) {
    this.ensureContext();
    this.metroBpm = bpm;
    this.metroBeatsPerBar = beatsPerBar;
    this.onMetroBeat = onBeat;
    this.metroCurrentBeat = 0;
    this.metroNextTime = this.ctx.currentTime + 0.05;
    this.metroRunning = true;

    if (this.metroTimer) clearInterval(this.metroTimer);
    this.metroTimer = setInterval(() => this.scheduleMetronome(), 25);
  }

  stopMetronome() {
    this.metroRunning = false;
    if (this.metroTimer) {
      clearInterval(this.metroTimer);
      this.metroTimer = null;
    }
  }

  setMetronomeBpm(bpm) {
    this.metroBpm = Math.max(30, Math.min(240, Number(bpm) || 120));
  }

  setMetronomeBeats(beats) {
    this.metroBeatsPerBar = Math.max(1, Math.min(12, Number(beats) || 4));
  }

  scheduleMetronome() {
    if (!this.metroRunning) return;
    const lookahead = 0.1;
    while (this.metroNextTime < this.ctx.currentTime + lookahead) {
      const beatIdx = this.metroCurrentBeat;
      const isAccent = beatIdx === 0;
      this.playClick(this.metroNextTime, isAccent);

      if (this.onMetroBeat) {
        const delayMs = Math.max(0, (this.metroNextTime - this.ctx.currentTime) * 1000);
        setTimeout(() => {
          if (this.metroRunning && this.onMetroBeat) {
            this.onMetroBeat(beatIdx, this.metroBeatsPerBar);
          }
        }, delayMs);
      }

      const secPerBeat = 60.0 / this.metroBpm;
      this.metroNextTime += secPerBeat;
      this.metroCurrentBeat = (this.metroCurrentBeat + 1) % this.metroBeatsPerBar;
    }
  }

  playClick(time, isAccent) {
    const ctx = this.ensureContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 1100 : 780, time);
    gain.gain.setValueAtTime(isAccent ? 0.45 : 0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // =========================================================================
  // Reference Pitch Generator
  // =========================================================================
  startReferenceTone(freq) {
    this.stopReferenceTone();
    const ctx = this.ensureContext();
    const now = ctx.currentTime;

    // Use dual-oscillator rich tone for low bass/guitar notes (< 160 Hz)
    // so the pitch is clearly audible even on small mobile phone speakers.
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    if (freq < 160) {
      osc1.type = 'triangle';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq * 2, now); // 1st harmonic
    } else {
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq, now);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.08);

    osc1.connect(gain);
    if (freq < 160) {
      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0.18, now);
      osc2.connect(harmGain);
      harmGain.connect(gain);
      osc2.start(now);
      this.refOsc2 = osc2;
    } else {
      this.refOsc2 = null;
    }

    gain.connect(this.masterGain);
    osc1.start(now);
    this.refOsc = osc1;
    this.refGain = gain;
  }

  stopReferenceTone() {
    if (this.refOsc) {
      try {
        const now = this.ctx.currentTime;
        this.refGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
        this.refOsc.stop(now + 0.07);
        if (this.refOsc2) {
          this.refOsc2.stop(now + 0.07);
        }
      } catch (_) {}
      this.refOsc = null;
      this.refOsc2 = null;
      this.refGain = null;
    }
  }

  // =========================================================================
  // Chromatic Microphone Tuner (Autocorrelation)
  // =========================================================================
  async startTuner(onReading, onError) {
    try {
      const ctx = this.ensureContext();
      this.tunerStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.tunerSource = ctx.createMediaStreamSource(this.tunerStream);
      this.tunerAnalyser = ctx.createAnalyser();
      this.tunerAnalyser.fftSize = 4096; // 4096 buffer for accurate low-frequency Bass & Guitar detection
      this.tunerSource.connect(this.tunerAnalyser);

      const buf = new Float32Array(this.tunerAnalyser.fftSize);
      const noteNames = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

      const loop = () => {
        if (!this.tunerAnalyser) return;
        this.tunerAnalyser.getFloatTimeDomainData(buf);
        const freq = this.autoCorrelate(buf, ctx.sampleRate);
        // Supports Low B (B0: 30.87 Hz) and Low E (E1: 41.20 Hz) for Bass, through high notes
        if (freq > 28 && freq < 2400) {
          const noteNum = 12 * (Math.log(freq / 440) / Math.log(2)) + 69;
          const nearest = Math.round(noteNum);
          const cents = Math.round((noteNum - nearest) * 100);
          const name = noteNames[((nearest % 12) + 12) % 12] + (Math.floor(nearest / 12) - 1);
          onReading({ freq, note: name, cents });
        }
        this.tunerRaf = requestAnimationFrame(loop);
      };
      loop();
    } catch (err) {
      if (onError) onError(err);
    }
  }

  stopTuner() {
    if (this.tunerRaf) {
      cancelAnimationFrame(this.tunerRaf);
      this.tunerRaf = null;
    }
    if (this.tunerSource) {
      try { this.tunerSource.disconnect(); } catch (_) {}
      this.tunerSource = null;
    }
    if (this.tunerStream) {
      this.tunerStream.getTracks().forEach((t) => t.stop());
      this.tunerStream = null;
    }
    this.tunerAnalyser = null;
  }

  autoCorrelate(buf, sampleRate) {
    const size = buf.length;
    let rms = 0;
    for (let i = 0; i < size; i++) {
      rms += buf[i] * buf[i];
    }
    rms = Math.sqrt(rms / size);
    if (rms < 0.007) return -1; // Sensitive for acoustic guitar and bass strings

    let r1 = 0;
    let r2 = size - 1;
    const thres = 0.2;
    for (let i = 0; i < size / 2; i++) {
      if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < size / 2; i++) {
      if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }
    }

    const slice = buf.slice(r1, r2);
    const len = slice.length;
    if (len < 16) return -1;

    const c = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      for (let j = 0; j < len - i; j++) {
        c[i] += slice[j] * slice[j + i];
      }
    }

    let d = 0;
    while (d < len - 1 && c[d] > c[d + 1]) d++;
    let maxVal = -1;
    let maxPos = -1;
    for (let i = d; i < len; i++) {
      if (c[i] > maxVal) {
        maxVal = c[i];
        maxPos = i;
      }
    }
    if (maxPos <= 0) return -1;

    const T0 = maxPos;
    return sampleRate / T0;
  }
}

window.MaestroAudioEngine = MaestroAudioEngine;
