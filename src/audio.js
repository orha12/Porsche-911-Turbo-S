// Synthesised twin-turbo flat-six. Everything is generated live with the Web Audio API, no samples.
const EngineAudio = (() => {
  let ctx = null, n = null, muted = false;
  let lastThrottle = 0, popTimer = 0, popBudget = 0;

  // One period of this wave is a full four-stroke cycle (two crank turns), so harmonic 6 is
  // the firing frequency of a six cylinder and harmonic 3 gives the boxer its off-beat growl.
  function engineWave(tilt, rough, seed) {
    const N = 192, real = new Float32Array(N), imag = new Float32Array(N);
    const r = U.rng(seed);
    for (let h = 1; h < N; h++) {
      let w = h % 6 === 0 ? 1 : h % 3 === 0 ? 0.42 : rough;
      let a = w / Math.pow(1 + h / 6, tilt);
      if (h === 6) a *= 1.5;
      if (h === 12) a *= 1.3;
      if (h === 3) a *= 1.25;
      const ph = r() * Math.PI * 2;
      real[h] = a * Math.cos(ph); imag[h] = a * Math.sin(ph);
    }
    return ctx.createPeriodicWave(real, imag);
  }

  function noiseBuffer() {
    const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function noiseSource(buf) {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.5);
    return s;
  }

  function biquad(type, f, q, gain) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    if (gain !== undefined) b.gain.value = gain;
    return b;
  }

  const gainNode = v => { const g = ctx.createGain(); g.gain.value = v; return g; };

  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const master = gainNode(0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.4);
    const buf = noiseBuffer();

    // engine voices: loaded (bright, hard) and coasting (dark, hollow), two slightly detuned banks
    const mkOsc = (wave, detune) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave); o.detune.value = detune; o.frequency.value = 7; o.start();
      return o;
    };
    const loadWave = engineWave(0.85, 0.16, 11), coastWave = engineWave(1.35, 0.1, 23);
    const oscs = [mkOsc(loadWave, 0), mkOsc(loadWave, 9), mkOsc(coastWave, -6)];
    const gLoad = gainNode(0), gCoast = gainNode(0.3);
    oscs[0].connect(gLoad); oscs[1].connect(gLoad); oscs[2].connect(gCoast);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.6 * x); }
    shaper.curve = curve; shaper.oversample = '2x';
    const pre = gainNode(0.5);
    gLoad.connect(pre); gCoast.connect(pre); pre.connect(shaper);

    // exhaust and body resonances, then a low-pass that opens with revs and throttle
    const f1 = biquad('peaking', 170, 1.2, 5), f2 = biquad('peaking', 520, 1.4, 4), f3 = biquad('peaking', 1500, 1.1, 3);
    const lp = biquad('lowpass', 600, 0.8);
    const hp = biquad('highpass', 28, 0.7);
    const engGain = gainNode(0.5);
    shaper.connect(f1); f1.connect(f2); f2.connect(f3); f3.connect(lp); lp.connect(hp); hp.connect(engGain); engGain.connect(master);

    // intake and exhaust rasp: noise chopped at the firing frequency
    const raspSrc = noiseSource(buf);
    const raspBp = biquad('bandpass', 900, 0.9);
    const raspChop = gainNode(0.5), raspGain = gainNode(0);
    const chopOsc = ctx.createOscillator(); chopOsc.type = 'sawtooth'; chopOsc.frequency.value = 42; chopOsc.start();
    const chopDepth = gainNode(0.5);
    chopOsc.connect(chopDepth); chopDepth.connect(raspChop.gain);
    raspSrc.connect(raspBp); raspBp.connect(raspChop); raspChop.connect(raspGain); raspGain.connect(master);

    // turbos: whistle plus airy hiss
    const whistle = ctx.createOscillator(); whistle.type = 'sine'; whistle.frequency.value = 2000; whistle.start();
    const whistle2 = ctx.createOscillator(); whistle2.type = 'sine'; whistle2.frequency.value = 2100; whistle2.start();
    const whistleGain = gainNode(0);
    whistle.connect(whistleGain); whistle2.connect(whistleGain); whistleGain.connect(master);
    const hissSrc = noiseSource(buf), hissBp = biquad('bandpass', 5200, 1.6), hissGain = gainNode(0);
    hissSrc.connect(hissBp); hissBp.connect(hissGain); hissGain.connect(master);

    // wind, road roar, tyre squeal, gravel
    const windSrc = noiseSource(buf), windLp = biquad('lowpass', 500, 0.5), windGain = gainNode(0);
    windSrc.connect(windLp); windLp.connect(windGain); windGain.connect(master);
    const roadSrc = noiseSource(buf), roadBp = biquad('bandpass', 140, 0.7), roadGain = gainNode(0);
    roadSrc.connect(roadBp); roadBp.connect(roadGain); roadGain.connect(master);
    const sqSrc = noiseSource(buf), sq1 = biquad('bandpass', 1050, 14), sq2 = biquad('bandpass', 1420, 18), sqGain = gainNode(0);
    sqSrc.connect(sq1); sqSrc.connect(sq2); sq1.connect(sqGain); sq2.connect(sqGain); sqGain.connect(master);
    const grSrc = noiseSource(buf), grLp = biquad('lowpass', 420, 0.6), grGain = gainNode(0);
    grSrc.connect(grLp); grLp.connect(grGain); grGain.connect(master);

    n = { master, buf, oscs, gLoad, gCoast, pre, lp, engGain, raspBp, raspGain, chopOsc, whistle, whistle2, whistleGain, hissGain, hissBp, windLp, windGain, roadGain, roadBp, sq1, sq2, sqGain, grGain };
  }

  function burst(dur, freq, q, vol, type) {
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = n.buf;
    const f = biquad(type || 'lowpass', freq, q), g = gainNode(0);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    if (type === 'bandpass') f.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    s.connect(f); f.connect(g); g.connect(n.master);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  // s: { rpm, throttle, boost, speed, slip, offroad, shifted, dt }
  function update(s) {
    if (!ctx || !n) return;
    const t = ctx.currentTime, k = 0.03;
    const rpm = Math.max(600, s.rpm + (s.rpm < 1200 ? (Math.random() - 0.5) * 50 : 0));
    const rn = U.clamp(rpm / 7200, 0, 1), th = s.throttle;
    const cycle = rpm / 120;
    for (const o of n.oscs) o.frequency.setTargetAtTime(cycle, t, 0.015);
    n.chopOsc.frequency.setTargetAtTime(rpm / 20, t, 0.015);
    n.gLoad.gain.setTargetAtTime(Math.pow(th, 0.7) * (0.45 + 0.55 * rn), t, k);
    n.gCoast.gain.setTargetAtTime((1 - th * 0.85) * (0.34 + 0.4 * rn), t, k);
    n.pre.gain.setTargetAtTime(0.4 + 0.9 * th + 0.4 * rn, t, k);
    n.lp.frequency.setTargetAtTime(260 + rpm * (0.3 + 1.0 * th) + 500 * rn, t, k);
    n.engGain.gain.setTargetAtTime(0.3 + 0.2 * rn + 0.22 * th, t, k);
    n.raspBp.frequency.setTargetAtTime(500 + rpm * 0.32, t, k);
    n.raspGain.gain.setTargetAtTime(th * (0.05 + 0.2 * rn) + 0.012, t, k);
    // turbos
    const b = s.boost;
    n.whistle.frequency.setTargetAtTime(2200 + b * 6200 + rn * 900, t, 0.05);
    n.whistle2.frequency.setTargetAtTime((2200 + b * 6200 + rn * 900) * 1.043, t, 0.05);
    n.whistleGain.gain.setTargetAtTime(b * b * 0.012, t, 0.05);
    n.hissBp.frequency.setTargetAtTime(3500 + b * 3500, t, 0.05);
    n.hissGain.gain.setTargetAtTime(b * 0.05 * (0.4 + 0.6 * th), t, 0.05);
    // blow-off when lifting under boost
    if (lastThrottle > 0.6 && th < 0.2 && b > 0.45) {
      burst(0.4, 3200, 1.4, 0.2 * b, 'bandpass');
      popBudget = rn > 0.45 ? 1.4 : 0;
    }
    if (s.shifted) {
      if (s.shifted > 0 && th > 0.7) burst(0.09, 700, 1, 0.5);
      else if (s.shifted < 0) popBudget = Math.max(popBudget, 0.5);
    }
    // overrun crackle
    if (popBudget > 0) {
      popBudget -= s.dt; popTimer -= s.dt;
      if (th > 0.3) popBudget = 0;
      if (popTimer <= 0 && rpm > 2600) {
        burst(0.03 + Math.random() * 0.05, 500 + Math.random() * 900, 1.2, 0.25 + Math.random() * 0.4);
        popTimer = 0.05 + Math.random() * 0.22;
      }
    }
    lastThrottle = th;
    // wind and tyres
    const v = Math.abs(s.speed), vn = U.clamp(v / 92, 0, 1);
    n.windLp.frequency.setTargetAtTime(300 + vn * 2200, t, 0.1);
    n.windGain.gain.setTargetAtTime(vn * vn * 0.34, t, 0.1);
    n.roadBp.frequency.setTargetAtTime(90 + vn * 240, t, 0.1);
    n.roadGain.gain.setTargetAtTime(Math.min(1, v / 40) * 0.2 * (s.offroad ? 0.3 : 1), t, 0.1);
    const slip = s.offroad ? 0 : U.clamp(s.slip, 0, 1);
    n.sq1.frequency.setTargetAtTime(950 + slip * 250, t, 0.08);
    n.sq2.frequency.setTargetAtTime(1300 + slip * 320, t, 0.08);
    n.sqGain.gain.setTargetAtTime(slip * 0.5, t, 0.05);
    n.grGain.gain.setTargetAtTime(s.offroad ? Math.min(1, v / 25) * 0.5 : 0, t, 0.08);
  }

  function toggleMute() {
    muted = !muted;
    if (ctx) n.master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
    return muted;
  }

  return { start, update, toggleMute, get context() { return ctx; }, get nodes() { return n; } };
})();
