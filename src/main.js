// Game loop, vehicle dynamics, cameras and HUD.
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('gl');
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.15, 14000);
  const { sky, sun } = World.build(scene, renderer);
  const car = CarModel.build();
  car.root.rotation.order = 'YXZ';
  scene.add(car.root);

  // ---------- vehicle ----------
  // 3.7 l twin-turbo flat-six, 478 kW (650 PS), 800 Nm, 8-speed PDK, all-wheel drive, 1640 kg
  const P = {
    m: 1640, g: 9.81, L: 2.45, a: 1.52, b: 0.93, h: 0.45, Iz: 2000, rw: 0.361, final: 3.02,
    gears: [3.42, 4.89, 3.17, 2.15, 1.56, 1.18, 0.94, 0.76, 0.61],  // index 0 is reverse
    idle: 850, redline: 7200, drag: 0.59, roll: 230,
  };
  const torqueCurve = U.curve([[800, 420], [1500, 560], [2300, 800], [4500, 800], [6750, 676], [7200, 610], [7600, 380]]);
  const S = {
    x: -1240, z: -1150, psi: Math.PI / 2, vx: 0, vy: 0, r: 0, steer: 0,
    gear: 1, rpm: 850, boost: 0, thr: 0, brk: 0, shiftT: 0, cool: 0, ax: 0, ay: 0,
    slip: 0, offroad: false, shifted: 0, hbTime: 0, y: 0, pitch: 0, rollA: 0, manual: false, odo: 0, top: 0,
  };
  const keys = {};
  const g4 = [{}, {}, {}, {}];

  const wheelRpm = (gear, v) => Math.abs(v) / P.rw * P.gears[gear] * P.final * 60 / (2 * Math.PI);
  const pacejka = a => Math.sin(1.5 * Math.atan(15 * a));

  function shift(to) {
    if (to === S.gear || to < 1 || to > 8) return;
    S.shifted = to > S.gear ? 1 : -1;
    S.gear = to; S.shiftT = 0.09; S.cool = 0.32;
  }

  function physics(dt, input) {
    const { up, down, left, right, hb } = input;
    // pedals
    let thrT = 0, brkT = 0;
    if (S.gear === 0) {
      if (down) thrT = 1;
      if (up) { if (S.vx < -0.6) brkT = 1; else { S.gear = 1; S.cool = 0.2; } }
    } else {
      if (up) thrT = 1;
      if (down) { if (S.vx > 0.8 || up) brkT = 1; else { S.gear = 0; thrT = 1; } }
    }
    S.thr += U.clamp(thrT - S.thr, -dt * 9, dt * 5.5);
    S.brk += U.clamp(brkT - S.brk, -dt * 10, dt * 7);
    const dir = S.gear === 0 ? -1 : 1;
    const speed = Math.hypot(S.vx, S.vy);

    // steering, with less lock as speed rises
    const maxSteer = Math.min(0.62, 0.03 + P.L * 24 / Math.max(S.vx * S.vx, 1));
    const st = ((left ? 1 : 0) - (right ? 1 : 0)) * (input.steerAnalog !== undefined ? 0 : 1) + (input.steerAnalog || 0);
    const rate = Math.max(0.5, maxSteer * (st === 0 ? 9 : 7.5));
    S.steer += U.clamp(st * maxSteer - S.steer, -rate * dt, rate * dt);
    S.steer = U.clamp(S.steer, -maxSteer, maxSteer);

    // surface
    const mu = S.offroad ? 0.62 : 1;
    const beta = Math.abs(Math.atan2(S.vy, Math.max(Math.abs(S.vx), 3)));
    if (hb) S.hbTime = 1.2; else S.hbTime = Math.max(0, S.hbTime - dt);
    const psm = S.hbTime > 0 ? 1 : 1 - U.clamp((beta - 0.07) / 0.22, 0, 0.75);

    // powertrain
    const ratio = P.gears[S.gear];
    const wr = wheelRpm(S.gear, S.vx);
    const launching = (S.gear <= 1) && wr < 2600;
    const held = S.brk > 0.5 && speed < 1;
    let target = Math.max(wr, P.idle);
    if (launching) target = Math.max(wr, P.idle + S.thr * (held ? 4200 : 2300));
    S.rpm += (target - S.rpm) * Math.min(1, dt * (target > S.rpm ? 16 : 11));
    const boostT = S.thr * U.clamp((S.rpm - 1700) / 1700, 0, 1);
    S.boost += (boostT - S.boost) * Math.min(1, dt * (boostT > S.boost ? 3.4 : 7));
    S.shiftT = Math.max(0, S.shiftT - dt); S.cool = Math.max(0, S.cool - dt);
    let Fd = 0;
    if (S.shiftT <= 0 && S.rpm < P.redline + 150) {
      Fd = torqueCurve(S.rpm) * S.thr * psm * (0.6 + 0.4 * S.boost) * ratio * P.final * 0.9 / P.rw;
    }
    if (S.gear === 0 && S.vx < -15) Fd = 0;
    const down4 = 0.16 * S.vx * S.vx;
    const grip = mu * 1.22 * (P.m * P.g + down4);
    let spin = 0;
    if (Fd > grip) { spin = U.clamp((Fd / grip - 1) * 1.2, 0, 1) * (speed < 22 ? 1 : 0.3); Fd = grip; }
    if (held) Fd = 0;
    let Fx = Fd * dir;
    if (S.thr < 0.05 && !launching) Fx -= Math.sign(S.vx) * (20 + 0.012 * S.rpm) * ratio * P.final / P.rw;
    const Fb = S.brk * P.m * 12.2 * Math.min(1, mu + 0.15) + (hb ? P.m * 4.5 : 0);
    Fx -= Math.sign(S.vx) * Math.min(Fb, Math.abs(S.vx) < 0.4 ? Fb * 0.2 : Fb);
    Fx -= P.drag * S.vx * Math.abs(S.vx) + Math.sign(S.vx) * (S.offroad ? 1500 : P.roll) * Math.min(1, Math.abs(S.vx));
    // slope
    const grad = ((g4[0].h + g4[1].h) - (g4[2].h + g4[3].h)) / 2 / P.L;
    Fx -= P.m * P.g * U.clamp(grad || 0, -0.5, 0.5);

    // automatic gearbox
    if (!S.manual && S.gear >= 1 && S.cool <= 0 && !held) {
      const upAt = U.lerp(2500, 7000, Math.pow(S.thr, 0.8));
      const downAt = S.brk > 0.3 ? 3000 : U.lerp(1350, 3600, S.thr);
      if (wr > upAt && S.gear < 8) shift(S.gear + 1);
      else if (S.gear > 1 && wr < downAt && wheelRpm(S.gear - 1, S.vx) < 6700) { shift(S.gear - 1); if (S.thr > 0.8) S.cool = 0.12; }
    }

    // lateral dynamics (bicycle model with load transfer and a friction circle)
    const ax = Fx / P.m;
    const Nf = Math.max(500, P.m * P.g * P.b / P.L - P.m * S.ax * P.h / P.L + down4 * 0.4);
    const Nr = Math.max(500, P.m * P.g * P.a / P.L + P.m * S.ax * P.h / P.L + down4 * 0.6);
    let slip = spin;
    if (S.vx > 3) {
      const af = S.steer - Math.atan2(S.vy + P.a * S.r, S.vx);
      const ar = -Math.atan2(S.vy - P.b * S.r, S.vx);
      const useF = U.clamp((0.4 * Fd + 0.62 * Fb) / (1.34 * mu * Nf), 0, 1);
      const useR = U.clamp((0.6 * Fd * 0.7 + 0.38 * Fb) / (1.46 * mu * Nr), 0, 1);
      const Fyf = pacejka(af) * 1.34 * mu * Nf * Math.sqrt(Math.max(0.4, 1 - useF * useF));
      let Fyr = pacejka(ar) * 1.46 * mu * Nr * Math.sqrt(Math.max(0.45, 1 - useR * useR));
      if (hb) Fyr *= 0.38;
      const cs = Math.cos(S.steer);
      const vyDot = (Fyf * cs + Fyr) / P.m - S.vx * S.r;
      const rDot = (P.a * Fyf * cs - P.b * Fyr) / P.Iz;
      const vxDot = ax + S.vy * S.r - Fyf * Math.sin(S.steer) / P.m;
      S.vy += vyDot * dt; S.r += rDot * dt; S.vx += vxDot * dt;
      S.ay = (Fyf * cs + Fyr) / P.m;
      slip = Math.max(slip, U.clamp((Math.max(Math.abs(af), Math.abs(ar)) - 0.075) / 0.12, 0, 1), hb ? U.clamp(speed / 20, 0, 1) : 0);
    } else {
      const rk = S.vx * Math.tan(S.steer) / P.L;
      S.r += (rk - S.r) * Math.min(1, dt * 12);
      S.vy += (0 - S.vy) * Math.min(1, dt * 10);
      const before = S.vx;
      S.vx += ax * dt;
      if (before !== 0 && Math.sign(S.vx) !== Math.sign(before) && Fd === 0) S.vx = 0;
      if (Math.abs(S.vx) < 0.05 && Fd === 0) S.vx = 0;
      S.ay = S.vx * S.r;
    }
    S.ax += (ax - S.ax) * Math.min(1, dt * 12);
    S.slip += (slip - S.slip) * Math.min(1, dt * 14);

    // integrate position
    const sn = Math.sin(S.psi), cs2 = Math.cos(S.psi);
    S.x += (sn * S.vx + cs2 * S.vy) * dt;
    S.z += (cs2 * S.vx - sn * S.vy) * dt;
    S.psi += S.r * dt;
    S.odo += speed * dt;
    if (speed > S.top) S.top = speed;
  }

  function collide() {
    const R = 0.95;
    for (const off of [1.4, -1.0]) {
      const sn = Math.sin(S.psi), cs = Math.cos(S.psi);
      const cx = S.x + sn * off, cz = S.z + cs * off;
      const list = World.collidersNear(cx, cz);
      if (!list) continue;
      for (const c of list) {
        let nx, nz, pen;
        if (c.box) {
          const px = U.clamp(cx, c.minx, c.maxx), pz = U.clamp(cz, c.minz, c.maxz);
          let dx = cx - px, dz = cz - pz;
          const d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d < 1e-5) {
            const ex = Math.min(cx - c.minx, c.maxx - cx), ez = Math.min(cz - c.minz, c.maxz - cz);
            if (ex < ez) { nx = cx - c.minx < c.maxx - cx ? -1 : 1; nz = 0; pen = ex + R; }
            else { nz = cz - c.minz < c.maxz - cz ? -1 : 1; nx = 0; pen = ez + R; }
          } else { nx = dx / d; nz = dz / d; pen = R - d; }
        } else {
          const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz), rr = R * 0.8 + c.r;
          if (d >= rr || d < 1e-5) continue;
          nx = dx / d; nz = dz / d; pen = rr - d;
        }
        S.x += nx * pen; S.z += nz * pen;
        let wx = sn * S.vx + cs * S.vy, wz = cs * S.vx - sn * S.vy;
        const vn = wx * nx + wz * nz;
        if (vn < 0) {
          wx -= 1.2 * vn * nx; wz -= 1.2 * vn * nz;
          wx *= 0.985; wz *= 0.985;
          S.vx = sn * wx + cs * wz; S.vy = cs * wx - sn * wz;
          S.r = S.r * 0.6 + (nx * cs - nz * sn) * off * vn * 0.02;
          if (vn < -3 && EngineAudio.context) hitSound(-vn);
        }
      }
    }
    const rad = Math.hypot(S.x, S.z);
    if (rad > World.LIMIT) {
      const nx = -S.x / rad, nz = -S.z / rad;
      S.x = -nx * World.LIMIT; S.z = -nz * World.LIMIT;
      const sn = Math.sin(S.psi), cs = Math.cos(S.psi);
      let wx = sn * S.vx + cs * S.vy, wz = cs * S.vx - sn * S.vy;
      const vn = wx * nx + wz * nz;
      if (vn < 0) { wx -= vn * nx; wz -= vn * nz; S.vx = sn * wx + cs * wz; S.vy = cs * wx - sn * wz; }
    }
  }

  let lastHit = 0;
  function hitSound(v) {
    const now = performance.now();
    if (now - lastHit < 250) return;
    lastHit = now;
    const ctx = EngineAudio.context, n = EngineAudio.nodes;
    const s = ctx.createBufferSource(); s.buffer = n.buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, v / 15), ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    s.connect(f); f.connect(g); g.connect(n.master); s.start(0, Math.random(), 0.35);
  }

  function reset() {
    Object.assign(S, { x: -1240, z: -1150, psi: Math.PI / 2, vx: 0, vy: 0, r: 0, steer: 0, gear: 1, rpm: 850, boost: 0, ax: 0, ay: 0 });
    camYaw = S.psi;
    toast('Back on the runway');
  }

  // ---------- pose ----------
  const SP = car.SPEC;
  const corners = [[SP.frontTrack / 2, SP.frontZ], [-SP.frontTrack / 2, SP.frontZ], [SP.rearTrack / 2, SP.rearZ], [-SP.rearTrack / 2, SP.rearZ]];
  function sampleGround() {
    const sn = Math.sin(S.psi), cs = Math.cos(S.psi);
    let dmin = 999;
    for (let i = 0; i < 4; i++) {
      const lx = corners[i][0], lz = corners[i][1];
      World.groundAt(S.x + cs * lx + sn * lz, S.z - sn * lx + cs * lz, g4[i]);
      if (g4[i].d < dmin) dmin = g4[i].d;
    }
    S.offroad = dmin > 0.4;
  }

  let rough = 0;
  function poseCar(dt) {
    const hF = (g4[0].h + g4[1].h) / 2, hR = (g4[2].h + g4[3].h) / 2;
    const hL = (g4[0].h + g4[2].h) / 2, hRt = (g4[1].h + g4[3].h) / 2;
    const yT = hR + (hF - hR) * (P.b / P.L);
    const k = Math.min(1, dt * 18);
    S.y += (yT - S.y) * k;
    S.pitch += (-Math.atan2(hF - hR, P.L) - S.pitch) * k;
    S.rollA += (Math.atan2(hL - hRt, 1.59) - S.rollA) * k;
    car.root.position.set(S.x, S.y, S.z);
    car.root.rotation.set(S.pitch, S.psi, S.rollA);
    const speed = Math.hypot(S.vx, S.vy);
    rough = S.offroad ? Math.min(1, speed / 20) : 0;
    const b = car.body;
    b.rotation.x += (U.clamp(-S.ax * 0.0032, -0.04, 0.045) - b.rotation.x) * Math.min(1, dt * 7);
    b.rotation.z += (U.clamp(S.ay * 0.0034, -0.05, 0.05) - b.rotation.z) * Math.min(1, dt * 7);
    b.position.y = rough * (Math.random() - 0.5) * 0.02;
    for (const w of car.wheels) {
      w.spin.rotation.x += w.dir * (S.vx / w.R) * dt;
      if (w.front) w.pivot.rotation.y = S.steer;
    }
    const braking = S.brk > 0.1 || keys.Space;
    car.setBrake(braking, S.gear === 0);
  }

  // ---------- tyre smoke ----------
  const smoke = [];
  (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 48; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false; scene.add(sp);
      smoke.push({ sp, life: 0, vx: 0, vz: 0 });
    }
  })();
  let smokeI = 0, smokeAcc = 0;
  function updateSmoke(dt) {
    const speed = Math.hypot(S.vx, S.vy);
    const amount = (S.offroad ? rough * 0.7 : S.slip > 0.35 ? S.slip : 0) * (speed > 2 || S.slip > 0.5 ? 1 : 0);
    smokeAcc += amount * dt * 40;
    while (smokeAcc > 1) {
      smokeAcc -= 1;
      const p = smoke[smokeI++ % smoke.length];
      const side = Math.random() < 0.5 ? 1 : -1;
      const sn = Math.sin(S.psi), cs = Math.cos(S.psi);
      const lx = side * 0.8, lz = SP.rearZ - 0.2;
      p.sp.position.set(S.x + cs * lx + sn * lz, S.y + 0.25, S.z - sn * lx + cs * lz);
      p.life = 1; p.sp.visible = true;
      p.sp.material.color.setHex(S.offroad ? 0x9b8463 : 0xdddddd);
      p.vx = (Math.random() - 0.5) * 2; p.vz = (Math.random() - 0.5) * 2;
      p.sp.scale.setScalar(0.8);
    }
    for (const p of smoke) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.9;
      p.sp.position.x += p.vx * dt; p.sp.position.z += p.vz * dt; p.sp.position.y += dt * 0.9;
      p.sp.scale.setScalar(0.8 + (1 - p.life) * 4.5);
      p.sp.material.opacity = Math.max(0, p.life) * 0.4;
      if (p.life <= 0) p.sp.visible = false;
    }
  }

  // ---------- camera ----------
  const CAMS = ['Chase', 'Far chase', 'Driver', 'Showroom'];
  let dbgDist = 0, camMode = 0, camYaw = S.psi, orbitYaw = 0, orbitPitch = 0, orbitIdle = 9, drag = null;
  const tmp = new THREE.Vector3(), look = new THREE.Vector3();
  function updateCamera(dt, snap) {
    const speed = Math.hypot(S.vx, S.vy);
    const fovT = 56 + U.clamp(speed / 90, 0, 1) * 22;
    camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    if (camMode === 2) {
      tmp.set(0.34, 1.13, 0.1);
      car.body.localToWorld(tmp);
      camera.position.copy(tmp);
      look.set(0.34 + Math.sin(orbitYaw) * 10, 1.05 + orbitPitch * 6, 0.1 + Math.cos(orbitYaw) * 10);
      car.body.localToWorld(look);
      camera.up.set(0, 1, 0);
      camera.lookAt(look);
    } else {
      orbitIdle += dt;
      if (camMode === 3) orbitYaw += dt * 0.35;
      else if (!drag && orbitIdle > 2.5 && speed > 3) { orbitYaw *= Math.exp(-dt * 3); orbitPitch *= Math.exp(-dt * 3); }
      const rev = S.vx < -2 && camMode !== 3 ? Math.PI : 0;
      const drift = speed > 8 ? U.clamp(Math.atan2(S.vy, Math.abs(S.vx)), -0.5, 0.5) * 0.5 : 0;
      const targetYaw = S.psi + rev + drift;
      camYaw += U.angDiff(targetYaw, camYaw) * (snap ? 1 : Math.min(1, dt * 5.5));
      const yaw = camYaw + orbitYaw;
      const dist = dbgDist ? dbgDist : camMode === 1 ? 10.5 : camMode === 3 ? 6.2 : 6.4 + U.clamp(speed / 90, 0, 1) * 0.8;
      const pitch = U.clamp((camMode === 1 ? 0.3 : camMode === 3 ? 0.14 : 0.2) + orbitPitch, 0.03, 1.2);
      const cx = S.x - Math.sin(yaw) * Math.cos(pitch) * dist;
      const cz = S.z - Math.cos(yaw) * Math.cos(pitch) * dist;
      let cy = S.y + 0.75 + Math.sin(pitch) * dist;
      cy = Math.max(cy, World.groundAt(cx, cz) + 0.35);
      camera.position.set(cx, cy, cz);
      camera.lookAt(S.x, S.y + 0.85, S.z);
    }
    sky.position.copy(camera.position);
    sun.position.set(S.x + World.SUN.x * 160, S.y + World.SUN.y * 160, S.z + World.SUN.z * 160);
    sun.target.position.set(S.x, S.y, S.z);
  }

  // ---------- HUD ----------
  const dial = $('dial'), dctx = dial.getContext('2d');
  const map = $('map'), mctx = map.getContext('2d');
  const MAPPX = 168, mapImg = World.drawMap(MAPPX * 2);
  map.width = map.height = MAPPX * 2;
  dial.width = 520; dial.height = 400;
  let toastT = 0;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); toastT = 2.2; }

  function drawHud() {
    const c = dctx, W = 520, H = 400, cx = 300, cy = 215, R = 170;
    c.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    const ang = v => a0 + sweep * (v / 8000);
    c.beginPath(); c.arc(cx, cy, R + 12, 0, Math.PI * 2); c.fillStyle = 'rgba(8,9,11,0.72)'; c.fill();
    c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.stroke();
    c.lineWidth = 7; c.strokeStyle = '#c8102e'; c.beginPath(); c.arc(cx, cy, R - 6, ang(7200), ang(8000)); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i <= 16; i++) {
      const a = ang(i * 500), major = i % 2 === 0;
      const r1 = R - 2, r2 = R - (major ? 22 : 12);
      c.strokeStyle = i * 500 >= 7200 ? '#ff5b6e' : '#f1f1ec'; c.lineWidth = major ? 3.5 : 1.5;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); c.stroke();
      if (major) { c.fillStyle = '#f1f1ec'; c.font = '600 22px "Barlow Condensed", "Arial Narrow", sans-serif'; c.fillText(String(i / 2), cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40)); }
    }
    // needle
    const na = ang(U.clamp(S.rpm, 0, 8000));
    c.strokeStyle = '#ff2a2a'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(cx + Math.cos(na) * 62, cy + Math.sin(na) * 62); c.lineTo(cx + Math.cos(na) * (R - 16), cy + Math.sin(na) * (R - 16)); c.stroke();
    c.lineCap = 'butt';
    // digital speed
    const kmh = Math.hypot(S.vx, S.vy) * 3.6;
    c.fillStyle = '#fff'; c.font = '600 76px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.fillText(String(Math.round(kmh)), cx, cy - 6);
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = '500 18px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.fillText('km/h', cx, cy + 38);
    c.fillText('x1000 rpm', cx, cy - 62);
    // gear
    const gname = S.gear === 0 ? 'R' : (Math.hypot(S.vx, S.vy) < 0.3 && S.thr < 0.05 && S.gear === 1 ? 'D' : String(S.gear));
    c.fillStyle = '#f2c200'; c.font = '600 52px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.fillText(gname, cx, cy + 96);
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.font = '500 15px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.fillText(S.manual ? 'MANUAL' : 'PDK AUTO', cx, cy + 132);
    // boost bar
    const bx = 34, by = 60, bh = 280;
    c.fillStyle = 'rgba(8,9,11,0.72)'; c.fillRect(bx - 12, by - 34, 62, bh + 66);
    c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(bx + 10, by, 18, bh);
    c.fillStyle = S.boost > 0.85 ? '#f2c200' : '#e9e9e4'; c.fillRect(bx + 10, by + bh * (1 - S.boost), 18, bh * S.boost);
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = '500 15px "Barlow Condensed", "Arial Narrow", sans-serif';
    c.fillText('BOOST', bx + 19, by - 16);
    c.fillText((S.boost * 1.2).toFixed(1) + ' bar', bx + 19, by + bh + 16);

    // minimap
    const m = mctx, MS = MAPPX * 2;
    m.clearRect(0, 0, MS, MS);
    m.save();
    m.beginPath(); m.arc(MS / 2, MS / 2, MS / 2 - 2, 0, Math.PI * 2); m.fillStyle = 'rgba(8,9,11,0.72)'; m.fill(); m.clip();
    m.drawImage(mapImg, 0, 0);
    const px = (World.SIZE / 2 - S.x) / World.SIZE * MS, py = (World.SIZE / 2 - S.z) / World.SIZE * MS;
    m.translate(px, py); m.rotate(S.psi);
    m.fillStyle = '#f2c200'; m.beginPath(); m.moveTo(0, -13); m.lineTo(8, 9); m.lineTo(0, 4); m.lineTo(-8, 9); m.closePath(); m.fill();
    m.restore();
    m.beginPath(); m.arc(MS / 2, MS / 2, MS / 2 - 2, 0, Math.PI * 2); m.lineWidth = 2; m.strokeStyle = 'rgba(255,255,255,0.18)'; m.stroke();
  }

  // ---------- input ----------
  let started = false, lights = false;
  const touch = { steer: 0 };
  function action(code) {
    if (code === 'KeyC') { camMode = (camMode + 1) % CAMS.length; orbitYaw = 0; orbitPitch = 0; toast('Camera: ' + CAMS[camMode]); }
    else if (code === 'KeyP') toast('Paint: ' + car.nextPaint());
    else if (code === 'KeyL') { lights = !lights; car.setLights(lights); toast(lights ? 'Headlights on' : 'Headlights off'); }
    else if (code === 'KeyR') reset();
    else if (code === 'KeyM') toast(EngineAudio.toggleMute() ? 'Sound off' : 'Sound on');
    else if (code === 'KeyH') $('help').hidden = !$('help').hidden;
    else if (code === 'KeyG') { S.manual = !S.manual; toast(S.manual ? 'Manual: Q shifts down, E shifts up' : 'PDK automatic'); }
    else if (code === 'KeyE' && S.manual && S.gear >= 1) shift(S.gear + 1);
    else if (code === 'KeyQ' && S.manual && S.gear > 1 && wheelRpm(S.gear - 1, S.vx) < 7300) shift(S.gear - 1);
  }
  addEventListener('keydown', e => {
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (!started) { if (e.code === 'Enter' || e.code === 'Space') begin(); return; }
    if (!e.repeat) action(e.code);
    keys[e.code] = true;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  canvas.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch' || camMode !== 2) { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; } });
  addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    orbitYaw -= (e.clientX - drag.x) * 0.006; orbitPitch = U.clamp(orbitPitch + (e.clientY - drag.y) * 0.004, -0.15, 1.0);
    drag.x = e.clientX; drag.y = e.clientY; orbitIdle = 0;
  });
  addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) drag = null; });
  addEventListener('pointercancel', () => { drag = null; });

  for (const el of document.querySelectorAll('[data-key]')) {
    const code = el.dataset.key;
    const on = e => { e.preventDefault(); keys[code] = true; el.classList.add('on'); };
    const off = e => { e.preventDefault(); keys[code] = false; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  for (const el of document.querySelectorAll('[data-act]')) {
    el.addEventListener('click', e => { e.preventDefault(); action(el.dataset.act); el.blur(); });
  }

  function begin() {
    if (started) return;
    started = true;
    $('start').hidden = true;
    document.body.classList.add('playing');
    EngineAudio.start();
    camMode = 0; orbitYaw = 0; orbitPitch = 0;
    if (!isTouch) setTimeout(() => { if (!$('help').hidden) $('help').classList.add('dim'); }, 9000);
  }
  $('go').addEventListener('click', begin);
  if (isTouch) { document.body.classList.add('touch'); $('help').hidden = true; }

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // ---------- loop ----------
  const STEP = 1 / 240;
  let acc = 0, last = performance.now();
  sampleGround();
  S.y = (g4[0].h + g4[2].h) / 2;
  camMode = 3; orbitYaw = 2.5;          // showroom view behind the start screen

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const input = started ? {
      up: keys.ArrowUp || keys.KeyW, down: keys.ArrowDown || keys.KeyS,
      left: keys.ArrowLeft || keys.KeyA, right: keys.ArrowRight || keys.KeyD, hb: keys.Space,
    } : {};
    acc += dt;
    let shifted = 0;
    while (acc >= STEP) {
      S.shifted = 0;
      physics(STEP, input);
      if (S.shifted) shifted = S.shifted;
      acc -= STEP;
    }
    collide();
    sampleGround();
    poseCar(dt);
    updateSmoke(dt);
    updateCamera(dt);
    EngineAudio.update({ rpm: S.rpm, throttle: S.shiftT > 0 ? 0.15 : S.thr, boost: S.boost, speed: Math.hypot(S.vx, S.vy), slip: S.slip, offroad: S.offroad, shifted, dt });
    drawHud();
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const sim = (sec, input) => {
    for (let i = 0, n = Math.round(sec / STEP); i < n; i++) {
      physics(STEP, input);
      if (i % 4 === 0) { collide(); sampleGround(); }
    }
  };
  window.__game = { S, keys, car, begin, sim, reset, camera, renderer, scene, setCam: m => { camMode = m; }, orbit: (y, p, d) => { orbitYaw = y; orbitPitch = p; orbitIdle = -1e9; dbgDist = d || 0; } };
})();
