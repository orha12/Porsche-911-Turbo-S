// Procedural 911 Turbo S (992) model. Origin: on the ground under the centre of gravity.
// +Z is forward, +X is the driver's left, +Y is up. All sizes in metres.
const CarModel = (() => {
  const SPEC = {
    length: 4.535, width: 1.9, height: 1.303, wheelbase: 2.45,
    frontZ: 1.52, rearZ: -0.93,           // axle positions (62% of the weight sits on the rear)
    frontTrack: 1.58, rearTrack: 1.6,
    frontR: 0.343, rearR: 0.361,           // 255/35 ZR20 and 315/30 ZR21
    frontW: 0.255, rearW: 0.315,
  };
  const TAIL = -2.005, NOSE = 2.53;

  const PAINTS = [
    { name: 'Shark Blue', color: 0x0456cf, metal: 0.3, rough: 0.3 },
    { name: 'GT Silver Metallic', color: 0x8a8e94, metal: 0.9, rough: 0.3 },
    { name: 'Guards Red', color: 0xc20d1c, metal: 0.25, rough: 0.35 },
    { name: 'Racing Yellow', color: 0xf2c700, metal: 0.25, rough: 0.35 },
    { name: 'Python Green', color: 0x1f9a4a, metal: 0.35, rough: 0.33 },
    { name: 'Lava Orange', color: 0xee4b0c, metal: 0.3, rough: 0.35 },
    { name: 'Carrara White Metallic', color: 0xe9e9e4, metal: 0.45, rough: 0.3 },
    { name: 'Jet Black Metallic', color: 0x0b0b0d, metal: 0.7, rough: 0.28 },
  ];

  // ---- body section curves (z from tail to nose) ----
  const hwF = U.curve([[-2.005, 0.80], [-1.97, 0.885], [-1.85, 0.93], [-1.5, 0.95], [-0.93, 0.955], [-0.2, 0.905], [0.5, 0.89], [1.1, 0.905], [1.52, 0.925], [2.0, 0.89], [2.25, 0.83], [2.42, 0.72], [2.5, 0.56], [2.53, 0.38]]);
  const ybF = U.curve([[-2.005, 0.34], [-1.8, 0.24], [-1.4, 0.13], [0, 0.11], [2.0, 0.12], [2.45, 0.15], [2.53, 0.21]]);
  const ysF = U.curve([[-2.005, 0.80], [-1.97, 0.83], [-1.85, 0.87], [-1.5, 0.90], [-0.93, 0.915], [-0.5, 0.91], [0.3, 0.89], [0.95, 0.86], [1.52, 0.80], [2.0, 0.76], [2.25, 0.70], [2.42, 0.61], [2.5, 0.52], [2.53, 0.45]]);
  const ydF = U.curve([[-2.005, 0.80], [-1.97, 0.83], [-1.85, 0.86], [-1.6, 0.885], [-1.2, 0.90], [-0.5, 0.90], [0.3, 0.88], [0.95, 0.875], [1.52, 0.755], [2.0, 0.70], [2.25, 0.655], [2.42, 0.60], [2.5, 0.53], [2.53, 0.46]]);
  // greenhouse (cabin, roof and the fastback "flyline")
  const wtF = U.curve([[-1.92, 0.36], [-1.3, 0.44], [-0.8, 0.50], [-0.1, 0.56], [0.25, 0.56], [0.98, 0.62]]);
  const wbF = U.curve([[-1.92, 0.48], [-1.2, 0.66], [-0.5, 0.77], [0.3, 0.79], [0.98, 0.78]]);
  const yrF = U.curve([[-1.92, 0.83], [-1.75, 0.885], [-1.4, 0.99], [-1.0, 1.13], [-0.6, 1.25], [-0.2, 1.30], [0.05, 1.295], [0.3, 1.245], [0.6, 1.10], [0.9, 0.905], [0.98, 0.86]]);

  const ARCHES = [
    { z: SPEC.frontZ, cy: SPEC.frontR, R: SPEC.frontR + 0.047 },
    { z: SPEC.rearZ, cy: SPEC.rearR, R: SPEC.rearR + 0.045 },
  ];

  function archY(z, yb) {
    for (const a of ARCHES) {
      const dz = Math.abs(z - a.z);
      if (dz <= a.R) return Math.max(yb, a.cy + Math.sqrt(a.R * a.R - dz * dz));
    }
    return yb;
  }

  function sideProf(u) {
    if (u < 0.45) { const k = (0.45 - u) / 0.45; return 1 - 0.045 * k * k; }
    const k = (u - 0.45) / 0.55;
    return 1 - 0.07 * Math.pow(k, 2.5);
  }

  const SIDE_S = [0.15, 0.3, 0.45, 0.6, 0.75, 0.88, 1.0];
  const TOP_Q = [0.86, 0.74, 0.6, 0.42, 0.22, 0];

  // half cross-section of the body shell at z: 18 points from bottom centre to top centre
  function bodyRing(z) {
    const hw = hwF(z), yb = ybF(z), ys = ysF(z), yd = ydF(z);
    const ya = archY(z, yb);
    const inArch = ya > yb + 1e-6;
    const wi = hw - 0.36;
    const uA = (ya - yb) / (ys - yb);
    const wo = hw * sideProf(uA) + (inArch ? 0.012 : 0);
    const pts = [[0, yb], [wi, yb], [wi, ya], [wo, ya], [wo, ya]];
    for (const s of SIDE_S) {
      const y = U.lerp(ya, ys, s);
      pts.push([hw * sideProf((y - yb) / (ys - yb)), y]);
    }
    for (const q of TOP_Q) {
      const bump = U.smoothstep(0.35, 0.9, q);
      pts.push([q * hw, yd + (ys - yd) * bump + 0.015 * (1 - q * q)]);
    }
    return pts;
  }

  function greenRing(z) {
    const wt = wtF(z), wb = wbF(z), yr = yrF(z);
    const ybase = Math.min(ysF(z), ydF(z)) - 0.05;
    const k = U.clamp((yr - ybase) / 0.2, 0, 1);
    const yc = yr - 0.05 * k;
    return [
      [0, yr], [0.45 * wt, yr - 0.004 * k], [0.82 * wt, yr - 0.018 * k], [wt, yc],
      [U.lerp(wt, wb, 0.3), U.lerp(yc, ybase, 0.3)],
      [U.lerp(wt, wb, 0.68), U.lerp(yc, ybase, 0.68)],
      [wb, ybase],
    ];
  }

  function stations(z0, z1, step, extra) {
    const zs = [];
    for (let z = z0; z < z1 - 1e-6; z += step) zs.push(z);
    zs.push(z1);
    for (const e of extra) if (e > z0 && e < z1) zs.push(e);
    zs.sort((a, b) => a - b);
    const out = [zs[0]];
    for (let i = 1; i < zs.length; i++) if (zs[i] - out[out.length - 1] > 4e-4) out.push(zs[i]);
    return out;
  }

  const PAINT = 0, GLASS = 1, TRIM = 2;

  function finishLoft(pos, tris, probeIndex) {
    // tris: [[a,b,c,mat], ...]; makes sure the surface faces outward, then groups by material
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const build = flip => {
      const idx = [];
      geo.clearGroups();
      for (let m = 0; m < 3; m++) {
        const start = idx.length;
        for (const t of tris) if (t[3] === m) flip ? idx.push(t[0], t[2], t[1]) : idx.push(t[0], t[1], t[2]);
        if (idx.length > start) geo.addGroup(start, idx.length - start, m);
      }
      geo.setIndex(idx);
      geo.computeVertexNormals();
    };
    build(false);
    if (geo.attributes.normal.getY(probeIndex) < 0) build(true);
    return geo;
  }

  function buildBodyGeometry() {
    const extra = [];
    for (const a of ARCHES) {
      for (let d = 0; d <= 180; d += 10) extra.push(a.z + a.R * Math.cos(d * Math.PI / 180));
      extra.push(a.z + a.R + 0.0012, a.z - a.R - 0.0012);
    }
    extra.push(2.30, -1.84, -0.5, 1.1);
    const zs = stations(TAIL, NOSE, 0.06, extra);
    const H = 18, RN = 2 * H - 2; // 34 points per closed ring
    const pos = [], tris = [];
    for (const z of zs) {
      const h = bodyRing(z);
      for (let k = 0; k < RN; k++) {
        const hk = k < H ? k : RN - k;
        pos.push(k < H ? h[hk][0] : -h[hk][0], h[hk][1], z);
      }
    }
    const segMat = (zm, seg) => {
      if (seg <= 3) return TRIM;
      if (zm > 2.30 && seg <= 6) return TRIM;                      // front air intakes
      if (zm < -1.84 && seg <= 5) return TRIM;                     // rear diffuser
      if (seg === 4 && zm > -0.5 && zm < 1.1) return TRIM;         // side skirts
      return PAINT;
    };
    for (let i = 0; i < zs.length - 1; i++) {
      const zm = (zs[i] + zs[i + 1]) / 2;
      for (let k = 0; k < RN; k++) {
        const k2 = (k + 1) % RN;
        const hk = k < H ? k : RN - k, hk2 = k2 < H ? k2 : RN - k2;
        const m = segMat(zm, Math.min(hk, hk2));
        const a = i * RN + k, b = i * RN + k2, c = (i + 1) * RN + k, d = (i + 1) * RN + k2;
        tris.push([a, b, c, m], [b, d, c, m]);
      }
    }
    // end caps
    const n = zs.length - 1;
    const tailC = pos.length / 3; pos.push(0, 0.57, TAIL - 0.015);
    const noseC = pos.length / 3; pos.push(0, 0.33, NOSE + 0.03);
    for (let k = 0; k < RN; k++) {
      const k2 = (k + 1) % RN;
      const hk = Math.min(k < H ? k : RN - k, k2 < H ? k2 : RN - k2);
      tris.push([k2, k, tailC, PAINT]);
      tris.push([n * RN + k, n * RN + k2, noseC, hk <= 6 ? TRIM : PAINT]);
    }
    const mid = Math.floor(zs.length / 2);
    return finishLoft(pos, tris, mid * RN + (H - 1));
  }

  function buildGreenhouseGeometry() {
    const zs = stations(-1.92, 0.98, 0.05, [0.30, 0.66, -0.62, -0.95, -1.30, -1.40, -1.62]);
    const H = 7, RN = 2 * H - 1; // 13 points, open at the bottom
    const pos = [], tris = [];
    for (const z of zs) {
      const h = greenRing(z);
      for (let k = 0; k < RN; k++) {
        const hk = Math.abs(k - (H - 1));
        pos.push(k < H - 1 ? h[hk][0] : -h[hk][0], h[hk][1], z);
      }
    }
    const segMat = (zm, s) => {
      if (zm > 0.30) return s <= 1 ? GLASS : s === 2 ? PAINT : zm < 0.66 ? GLASS : PAINT;
      if (zm > -0.62) return s === 2 ? PAINT : GLASS;            // gloss black roof, body colour rails
      if (zm > -0.95) return s <= 1 ? GLASS : (s === 3 || s === 4) ? GLASS : PAINT;
      if (zm > -1.30) return s <= 1 ? GLASS : PAINT;
      if (zm < -1.40 && zm > -1.62) return s <= 1 ? TRIM : PAINT; // engine cover grille
      return PAINT;
    };
    for (let i = 0; i < zs.length - 1; i++) {
      const zm = (zs[i] + zs[i + 1]) / 2;
      for (let k = 0; k < RN - 1; k++) {
        const s = Math.min(Math.abs(k - (H - 1)), Math.abs(k + 1 - (H - 1)));
        const m = segMat(zm, s);
        const a = i * RN + k, b = i * RN + k + 1, c = (i + 1) * RN + k, d = (i + 1) * RN + k + 1;
        tris.push([a, b, c, m], [b, d, c, m]);
      }
    }
    const mid = Math.floor(zs.length / 2);
    return finishLoft(pos, tris, mid * RN + (H - 1));
  }

  function buildWheel(R, W, mats) {
    const g = new THREE.Group();
    const spin = new THREE.Group();
    g.add(spin);
    const rimR = R - (R > 0.35 ? 0.094 : 0.089);
    // tyre (lathe around Y, then laid on its side so the axle runs along X)
    const hw = W / 2;
    const prof = [
      [rimR, -hw], [R - 0.035, -hw], [R - 0.008, -hw + 0.018], [R, -hw + 0.045],
      [R, hw - 0.045], [R - 0.008, hw - 0.018], [R - 0.035, hw], [rimR, hw],
    ].map(p => new THREE.Vector2(p[0], p[1]));
    const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), mats.tyre);
    tyre.geometry.rotateZ(-Math.PI / 2);
    spin.add(tyre);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, W * 0.92, 36, 1, true), mats.rimDark);
    barrel.geometry.rotateZ(Math.PI / 2);
    spin.add(barrel);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.004, 0.011, 8, 40), mats.rim);
    lip.geometry.rotateY(Math.PI / 2);
    lip.position.x = hw - 0.004;
    spin.add(lip);
    // ten slim spokes in five pairs, centre-lock hub
    const faceX = hw - 0.035;
    for (let i = 0; i < 20; i++) {
      const ang = i * (Math.PI * 2 / 20) + (i % 2 ? 0.035 : -0.035);
      const len = rimR - 0.05;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.022, len, 0.015), mats.rim);
      sp.position.set(faceX - 0.012, Math.cos(ang) * (0.05 + len / 2), Math.sin(ang) * (0.05 + len / 2));
      sp.rotation.x = ang;
      spin.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 20), mats.rim);
    hub.geometry.rotateZ(-Math.PI / 2);
    hub.position.x = faceX - 0.005;
    spin.add(hub);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.03, 12), mats.rimDark);
    nut.geometry.rotateZ(-Math.PI / 2);
    nut.position.x = faceX + 0.03;
    spin.add(nut);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.84, rimR * 0.84, 0.034, 32), mats.disc);
    disc.geometry.rotateZ(Math.PI / 2);
    disc.position.x = hw - 0.11;
    spin.add(disc);
    // ceramic-brake yellow caliper, fixed to the upright
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.075, rimR * 0.36, rimR * 0.95), mats.caliper);
    cal.position.set(hw - 0.105, 0, -rimR * 0.63);
    g.add(cal);
    g.userData.spin = spin;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return g;
  }

  function plateTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 56;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f4f0'; x.fillRect(0, 0, 256, 56);
    x.fillStyle = '#1c3f94'; x.fillRect(0, 0, 22, 56);
    x.strokeStyle = '#111'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, 253, 53);
    x.fillStyle = '#111'; x.font = 'bold 40px Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('S TS 911', 138, 30);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function build() {
    const root = new THREE.Group();      // follows the road surface
    const body = new THREE.Group();      // adds suspension pitch and roll
    root.add(body);

    const mats = {
      paint: new THREE.MeshPhysicalMaterial({ color: PAINTS[0].color, metalness: PAINTS[0].metal, roughness: PAINTS[0].rough, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.7 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.9, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.2, roughness: 0.6 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9, metalness: 0 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.9, roughness: 0.3 }),
      rimDark: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }),
      disc: new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.8, roughness: 0.5 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xf2c200, metalness: 0.3, roughness: 0.4 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 1, roughness: 0.15, side: THREE.DoubleSide }),
      lens: new THREE.MeshPhysicalMaterial({ color: 0x14171b, metalness: 0.9, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.8 }),
      slat: new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.6, roughness: 0.35 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x08090a, metalness: 0.5, roughness: 0.2, clearcoat: 1 }),
      drl: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfeaff, emissiveIntensity: 1.6 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1010, emissiveIntensity: 0.9, roughness: 0.3 }),
      reverse: new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 }),
    };

    const shell = new THREE.Mesh(buildBodyGeometry(), [mats.paint, mats.glass, mats.trim]);
    const cabin = new THREE.Mesh(buildGreenhouseGeometry(), [mats.paint, mats.glass, mats.trim]);
    shell.castShadow = cabin.castShadow = true;
    shell.receiveShadow = cabin.receiveShadow = true;
    body.add(shell, cabin);

    const add = (geo, mat, x, y, z, rx, ry, rz) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
      m.castShadow = true;
      body.add(m);
      return m;
    };

    for (const sx of [1, -1]) {
      // oval headlights with the four-point daytime signature
      const hl = add(new THREE.SphereGeometry(1, 24, 16), mats.lens, sx * 0.635, 0.672, 2.19, 0.33, 0, sx * -0.12);
      hl.scale.set(0.15, 0.07, 0.2);
      for (const [dx, dz] of [[-0.05, -0.06], [0.05, -0.06], [-0.05, 0.06], [0.05, 0.06]]) {
        add(new THREE.BoxGeometry(0.035, 0.012, 0.045), mats.drl, sx * 0.635 + dx, 0.738 - dz * 0.33 + sx * dx * 0.12, 2.19 + dz, 0.33, 0, sx * -0.12);
      }
      // mirrors
      const mir = add(new THREE.SphereGeometry(1, 16, 12), mats.paint, sx * 1.0, 0.975, 0.66);
      mir.scale.set(0.095, 0.058, 0.07);
      add(new THREE.BoxGeometry(0.16, 0.022, 0.05), mats.trim, sx * 0.9, 0.93, 0.66, 0, 0, sx * 0.25);
      // turbo side intakes ahead of the rear wheels
      add(new THREE.BoxGeometry(0.03, 0.2, 0.26), mats.trim, sx * (hwF(-0.33) - 0.006), 0.6, -0.33, 0.18, sx * 0.12, 0);
      // wing uprights
      add(new THREE.BoxGeometry(0.035, 0.13, 0.2), mats.trim, sx * 0.42, 0.935, -1.74, -0.3, 0, 0);
      // quad exhaust tips
      for (const ex of [0.36, 0.5]) {
        const tip = add(new THREE.CylinderGeometry(0.047, 0.047, 0.14, 16, 1, true), mats.chrome, sx * ex, 0.385, -1.985);
        tip.material = mats.chrome;
        tip.rotation.x = Math.PI / 2;
        const inner = add(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), mats.trim, sx * ex, 0.385, -1.975);
        inner.rotation.x = Math.PI / 2;
      }
      // rear bumper vents
      add(new THREE.BoxGeometry(0.2, 0.09, 0.03), mats.trim, sx * 0.62, 0.6, -2.0);
      // reverse lights
      add(new THREE.BoxGeometry(0.1, 0.03, 0.03), mats.reverse, sx * 0.3, 0.47, -2.012);
    }
    // rear wing blade and ducktail
    add(new THREE.BoxGeometry(1.5, 0.03, 0.3), mats.gloss, 0, 1.0, -1.79, -0.1, 0, 0);
    add(new THREE.BoxGeometry(1.34, 0.035, 0.22), mats.paint, 0, 0.9, -1.8, -0.22, 0, 0);
    // full-width light bar
    add(new THREE.BoxGeometry(1.52, 0.035, 0.035), mats.tail, 0, 0.765, -2.008);
    add(new THREE.BoxGeometry(1.5, 0.19, 0.03), mats.trim, 0, 0.39, -2.006);
    const plate = add(new THREE.BoxGeometry(0.52, 0.112, 0.012), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6 }), 0, 0.6, -2.024);
    plate.rotation.y = Math.PI;
    // front splitter and intake dividers
    add(new THREE.BoxGeometry(1.56, 0.022, 0.24), mats.gloss, 0, 0.15, 2.4);
    // nose surface lookup so intake details follow the curved bumper
    const noseW = (z, y) => { const yb = ybF(z), ys = ysF(z); return hwF(z) * sideProf(U.clamp((y - yb) / (ys - yb), 0, 1)); };
    const noseZ = (x, y) => { let a = 1.9, b = NOSE; for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (noseW(m, y) > x) a = m; else b = m; } return a; };
    const onNose = (geo, mat, x, y, out) => {
      const z = noseZ(Math.abs(x), y), dz = noseZ(Math.abs(x) + 0.02, y) - noseZ(Math.max(0, Math.abs(x) - 0.02), y);
      const yaw = Math.atan2(-dz, 0.04) * Math.sign(x || 1);
      return add(geo, mat, x, y, Math.min(z, NOSE + 0.01) + out, 0, -yaw, 0);
    };
    for (const sx of [1, -1]) {
      // body colour frame around each outer intake, with vertical vanes inside
      onNose(new THREE.BoxGeometry(0.05, 0.19, 0.06), mats.paint, sx * 0.27, 0.285, 0.0);
      for (let i = 0; i < 7; i++) onNose(new THREE.BoxGeometry(0.012, 0.15, 0.03), mats.slat, sx * (0.335 + i * 0.047), 0.285, 0.004);
    }
    onNose(new THREE.BoxGeometry(0.5, 0.05, 0.05), mats.paint, 0, 0.36, 0.0);
    for (let i = 0; i < 3; i++) onNose(new THREE.BoxGeometry(0.46, 0.01, 0.03), mats.slat, 0, 0.225 + i * 0.04, 0.012);

    // wheels
    const wheels = [];
    const defs = [
      { x: SPEC.frontTrack / 2, z: SPEC.frontZ, R: SPEC.frontR, W: SPEC.frontW, front: true },
      { x: -SPEC.frontTrack / 2, z: SPEC.frontZ, R: SPEC.frontR, W: SPEC.frontW, front: true },
      { x: SPEC.rearTrack / 2, z: SPEC.rearZ, R: SPEC.rearR, W: SPEC.rearW, front: false },
      { x: -SPEC.rearTrack / 2, z: SPEC.rearZ, R: SPEC.rearR, W: SPEC.rearW, front: false },
    ];
    for (const d of defs) {
      const w = buildWheel(d.R, d.W, mats);
      const pivot = new THREE.Group();
      pivot.position.set(d.x, d.R, d.z);
      if (d.x < 0) w.rotation.y = Math.PI;
      pivot.add(w);
      root.add(pivot);
      wheels.push({ pivot, spin: w.userData.spin, dir: d.x < 0 ? -1 : 1, front: d.front, R: d.R });
    }

    // headlights
    const lamps = [];
    for (const sx of [1, -1]) {
      const s = new THREE.SpotLight(0xfff1dc, 0, 140, 0.5, 0.6, 1.2);
      s.position.set(sx * 0.63, 0.7, 2.3);
      s.target.position.set(sx * 0.63, 0.1, 30);
      body.add(s, s.target);
      lamps.push(s);
    }

    let paintIndex = 0;
    return {
      root, body, wheels, mats, lamps, SPEC, PAINTS,
      setPaint(i) {
        paintIndex = ((i % PAINTS.length) + PAINTS.length) % PAINTS.length;
        const p = PAINTS[paintIndex];
        mats.paint.color.setHex(p.color);
        mats.paint.metalness = p.metal;
        mats.paint.roughness = p.rough;
        return p.name;
      },
      nextPaint() { return this.setPaint(paintIndex + 1); },
      setLights(on) {
        for (const l of lamps) l.intensity = on ? 2.2 : 0;
        mats.drl.emissiveIntensity = on ? 4 : 1.6;
        mats.tail.userData.base = on ? 1.6 : 0.9;
      },
      setBrake(on, reversing) {
        const base = mats.tail.userData.base || 0.9;
        mats.tail.emissiveIntensity = on ? 5 : base;
        mats.reverse.emissiveIntensity = reversing ? 2.5 : 0;
      },
    };
  }

  return { build, SPEC, PAINTS };
})();
