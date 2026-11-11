// Open world: rolling terrain, mountains at the rim, a city, a ring highway, country roads and a runway.
const World = (() => {
  const SIZE = 6000, N = 400, CELL = SIZE / N, HALF = SIZE / 2;
  const LIMIT = 2880;                 // drivable radius
  const ROAD_LIFT = 0.1;
  const CITY = 330, CITY_STEP = 110;

  const low = (x, z) =>
    12 * Math.sin(x / 430 + 1.3) * Math.cos(z / 390 - 0.4) +
    7 * Math.sin((x + z) / 620 + 2.0) + 4 * Math.cos((x - 1.7 * z) / 510);

  // ---------- roads ----------
  const roads = [];
  function addRoad(ctrl, width, type, closed, straight) {
    let pts;
    if (straight) {
      pts = [];
      const [a, b] = ctrl;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.ceil(len / 6);
      for (let i = 0; i <= n; i++) pts.push({ x: U.lerp(a[0], b[0], i / n), z: U.lerp(a[1], b[1], i / n) });
    } else {
      const c = new THREE.CatmullRomCurve3(ctrl.map(p => new THREE.Vector3(p[0], 0, p[1])), !!closed, 'centripetal');
      const n = Math.ceil(c.getLength() / 5);
      pts = c.getSpacedPoints(n).map(v => ({ x: v.x, z: v.z }));
    }
    roads.push({ pts, hw: width / 2, type, closed: !!closed, index: roads.length });
  }

  function defineRoads() {
    const r = U.rng(911);
    const loop = [];
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8;
      const R = k % 4 === 0 ? 1900 : 1900 + (r() - 0.5) * 420;
      loop.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    addRoad(loop, 17, 'highway', true);
    addRoad([[-1900, 0], [1900, 0]], 12, 'road', false, true);
    addRoad([[0, -1900], [0, 1900]], 12, 'road', false, true);
    addRoad([[-1300, -1150], [1300, -1150]], 44, 'runway', false, true);
    // twisty pass in the north-east
    addRoad([[0, 1000], [250, 1150], [450, 900], [700, 1250], [950, 1000], [800, 700], [1100, 550], [1250, 800], [1400, 450], [1150, 250], [1000, 0]], 9, 'road');
    // fast sweepers in the north-west
    addRoad([[-1000, 0], [-1200, 500], [-800, 900], [-900, 1300], [-400, 1500], [0, 1400]], 10, 'road');
    // back road in the south-east
    addRoad([[1300, -1150], [1550, -900], [1350, -600], [1500, -300], [1300, 0]], 9, 'road');
    for (let v = -CITY; v <= CITY; v += CITY_STEP) {
      if (v === 0) continue;
      addRoad([[v, -CITY], [v, CITY]], 10, 'street', false, true);
      addRoad([[-CITY, v], [CITY, v]], 10, 'street', false, true);
    }
  }

  // segment lookup grid
  const GC = 100, GN = Math.ceil(SIZE / GC);
  const segGrid = new Array(GN * GN);
  const segs = [];
  function hashRoads() {
    for (const rd of roads) {
      const n = rd.pts.length;
      const last = rd.closed ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = rd.pts[i], b = rd.pts[(i + 1) % n];
        const s = { ax: a.x, az: a.z, bx: b.x, bz: b.z, hw: rd.hw, type: rd.type };
        const id = segs.push(s) - 1;
        const pad = 100 + rd.hw;
        const x0 = Math.floor((Math.min(a.x, b.x) - pad + HALF) / GC), x1 = Math.floor((Math.max(a.x, b.x) + pad + HALF) / GC);
        const z0 = Math.floor((Math.min(a.z, b.z) - pad + HALF) / GC), z1 = Math.floor((Math.max(a.z, b.z) + pad + HALF) / GC);
        for (let gz = Math.max(0, z0); gz <= Math.min(GN - 1, z1); gz++) {
          for (let gx = Math.max(0, x0); gx <= Math.min(GN - 1, x1); gx++) {
            (segGrid[gz * GN + gx] || (segGrid[gz * GN + gx] = [])).push(id);
          }
        }
      }
    }
  }

  // distance from the nearest road edge (negative means on the tarmac); 999 when far away
  function roadDist(x, z) {
    const gx = Math.floor((x + HALF) / GC), gz = Math.floor((z + HALF) / GC);
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return 999;
    const list = segGrid[gz * GN + gx];
    if (!list) return 999;
    let best = 999;
    for (let i = 0; i < list.length; i++) {
      const s = segs[list[i]];
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const t = U.clamp(((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz), 0, 1);
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.hw;
      if (d < best) best = d;
    }
    return best;
  }

  // ---------- terrain ----------
  const heights = new Float32Array((N + 1) * (N + 1));
  const inCity = (x, z) => Math.max(Math.abs(x), Math.abs(z)) < CITY + 60;

  function rawHeight(x, z) {
    const d = roadDist(x, z);
    const r = Math.hypot(x, z);
    const mask = U.smoothstep(10, 90, d) * U.smoothstep(CITY + 50, CITY + 220, Math.max(Math.abs(x), Math.abs(z)));
    const hills = U.fbm(x / 260, z / 260, 4) * 24;
    const m = U.smoothstep(2250, 3000, r);
    const mountain = m * (60 + 300 * (0.5 + 0.5 * U.fbm(x / 520 + 7, z / 520 - 3, 5)) + 60 * Math.abs(U.fbm(x / 140, z / 140, 3)));
    return low(x, z) + (hills + mountain) * mask - 0.5 * (1 - U.smoothstep(0, 14, d));
  }

  function terrainHeight(x, z) {
    const fx = U.clamp((x + HALF) / CELL, 0, N - 0.0001), fz = U.clamp((z + HALF) / CELL, 0, N - 0.0001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h00 = heights[j * (N + 1) + i], h10 = heights[j * (N + 1) + i + 1];
    const h01 = heights[(j + 1) * (N + 1) + i], h11 = heights[(j + 1) * (N + 1) + i + 1];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // surface the car drives on
  function groundAt(x, z, out) {
    const d = roadDist(x, z);
    const road = low(x, z) + ROAD_LIFT;
    let h = road;
    if (d > 0) h = U.lerp(road, terrainHeight(x, z), U.smoothstep(0, 3.5, d));
    if (out) { out.h = h; out.d = d; }
    return h;
  }

  function noiseTexture(size, base, spread, repeat) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const img = x.createImageData(size, size);
    const r = U.rng(size * 7 + base);
    for (let i = 0; i < size * size; i++) {
      const fine = r(), coarse = U.noise((i % size) / 9, Math.floor(i / size) / 9) * 0.5 + 0.5;
      const v = U.clamp(base + (fine - 0.5) * spread + (coarse - 0.5) * spread * 0.8, 0, 255);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return t;
  }

  function buildTerrain(scene) {
    const V = N + 1;
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3), uv = new Float32Array(V * V * 2);
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const x = -HALF + i * CELL, z = -HALF + j * CELL;
        heights[j * V + i] = rawHeight(x, z);
      }
    }
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const k = j * V + i;
        const x = -HALF + i * CELL, z = -HALF + j * CELL, h = heights[k];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        uv[k * 2] = i; uv[k * 2 + 1] = j;
        const hx = heights[j * V + Math.min(N, i + 1)] - heights[j * V + Math.max(0, i - 1)];
        const hz = heights[Math.min(N, j + 1) * V + i] - heights[Math.max(0, j - 1) * V + i];
        const slope = Math.hypot(hx, hz) / (2 * CELL);
        const n = U.fbm(x / 90, z / 90, 3) * 0.5 + 0.5;
        let r = U.lerp(0.20, 0.36, n), g = U.lerp(0.33, 0.42, n), b = U.lerp(0.10, 0.16, n);
        const dry = U.smoothstep(0.35, 0.8, U.fbm(x / 400 + 20, z / 400, 3) * 0.5 + 0.5);
        r = U.lerp(r, 0.52, dry * 0.6); g = U.lerp(g, 0.46, dry * 0.6); b = U.lerp(b, 0.22, dry * 0.6);
        const rock = Math.max(U.smoothstep(0.38, 0.7, slope), U.smoothstep(110, 190, h));
        r = U.lerp(r, 0.40, rock); g = U.lerp(g, 0.36, rock); b = U.lerp(b, 0.32, rock);
        const snow = U.smoothstep(250, 320, h + n * 40);
        r = U.lerp(r, 0.92, snow); g = U.lerp(g, 0.93, snow); b = U.lerp(b, 0.96, snow);
        if (inCity(x, z)) { r = 0.33; g = 0.33; b = 0.34; }
        col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
      }
    }
    const idx = new Uint32Array(N * N * 6);
    let q = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: noiseTexture(256, 205, 90, 2.5), roughness: 1, metalness: 0, envMapIntensity: 0.35 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- road meshes ----------
  function roadTexture(type) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    const r = U.rng(type.length * 31);
    x.fillStyle = '#6b5f4c'; x.fillRect(0, 0, 512, 512);
    const X0 = 51, X1 = 461, W = X1 - X0;         // tarmac spans u 0.1 .. 0.9
    x.fillStyle = type === 'runway' ? '#3b3c3f' : '#2d2e31';
    x.fillRect(X0, 0, W, 512);
    for (let i = 0; i < 9000; i++) {
      const v = 30 + r() * 50;
      x.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
      x.fillRect(X0 + r() * W, r() * 512, 2, 2);
    }
    for (let i = 0; i < 2500; i++) {
      const v = 80 + r() * 60;
      x.fillStyle = `rgba(${v},${v * 0.9},${v * 0.7},0.6)`;
      const px = r() < 0.5 ? r() * X0 : X1 + r() * (512 - X1);
      x.fillRect(px, r() * 512, 3, 3);
    }
    const line = (u, w, dashed, color) => {
      x.fillStyle = color || '#e9e9e2';
      const px = X0 + u * W - w / 2;
      if (dashed) x.fillRect(px, 0, w, 256); else x.fillRect(px, 0, w, 512);
    };
    if (type === 'highway') {
      line(0.03, 6); line(0.97, 6);
      line(0.492, 5, false, '#e3b92c'); line(0.508, 5, false, '#e3b92c');
      line(0.26, 5, true); line(0.74, 5, true);
    } else if (type === 'runway') {
      line(0.03, 8); line(0.97, 8);
      line(0.5, 12, true);
    } else if (type === 'street') {
      line(0.04, 5); line(0.96, 5);
      line(0.5, 5, true);
    } else {
      line(0.04, 6); line(0.96, 6);
      line(0.5, 6, true, '#e3b92c');
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 16;
    return t;
  }

  function buildRoads(scene) {
    const mats = {};
    for (const type of ['highway', 'road', 'street', 'runway']) {
      mats[type] = new THREE.MeshStandardMaterial({ map: roadTexture(type), roughness: 0.82, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    const off = [[-1, 3, 0.9, 0], [-1, 0, 0, 0.1], [1, 0, 0, 0.9], [1, 3, 0.9, 1]];
    for (const rd of roads) {
      const n = rd.pts.length, cnt = rd.closed ? n + 1 : n;
      const pos = [], uv = [], idx = [];
      let dist = 0;
      const lift = ROAD_LIFT + rd.index * 0.004;
      for (let s = 0; s < cnt; s++) {
        const p = rd.pts[s % n];
        const pa = rd.pts[rd.closed ? (s - 1 + n) % n : Math.max(0, s - 1)];
        const pb = rd.pts[rd.closed ? (s + 1) % n : Math.min(n - 1, s + 1)];
        let tx = pb.x - pa.x, tz = pb.z - pa.z;
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        if (s > 0) { const pp = rd.pts[(s - 1) % n]; dist += Math.hypot(p.x - pp.x, p.z - pp.z); }
        for (const o of off) {
          const w = o[0] * (rd.hw + o[1]);
          const x = p.x + tz * w, z = p.z - tx * w;
          pos.push(x, low(x, z) + lift - o[2], z);
          uv.push(o[3], dist / 12);
        }
      }
      for (let s = 0; s < cnt - 1; s++) {
        for (let k = 0; k < 3; k++) {
          const a = s * 4 + k, b = a + 1, c = a + 4, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      if (geo.attributes.normal.getY(1) < 0) {
        for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
        geo.setIndex(idx); geo.computeVertexNormals();
      }
      const mesh = new THREE.Mesh(geo, mats[rd.type]);
      mesh.receiveShadow = true;
      mesh.renderOrder = rd.index;
      scene.add(mesh);
    }
  }

  // ---------- colliders ----------
  const CC = 50;
  const colGrid = new Map();
  function addCollider(c) {
    const x0 = Math.floor((c.minx - 2) / CC), x1 = Math.floor((c.maxx + 2) / CC);
    const z0 = Math.floor((c.minz - 2) / CC), z1 = Math.floor((c.maxz + 2) / CC);
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const key = gx * 4096 + gz;
      let l = colGrid.get(key);
      if (!l) colGrid.set(key, l = []);
      l.push(c);
    }
  }
  const collidersNear = (x, z) => colGrid.get(Math.floor(x / CC) * 4096 + Math.floor(z / CC));

  // ---------- city ----------
  function windowTextures() {
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 256; return c; };
    const a = mk(), e = mk();
    const xa = a.getContext('2d'), xe = e.getContext('2d');
    const r = U.rng(42);
    xa.fillStyle = '#b9b4ab'; xa.fillRect(0, 0, 256, 256);
    xe.fillStyle = '#000'; xe.fillRect(0, 0, 256, 256);
    for (let fy = 0; fy < 8; fy++) for (let fx = 0; fx < 8; fx++) {
      const lit = r() < 0.22;
      const px = fx * 32 + 5, py = fy * 32 + 7;
      xa.fillStyle = lit ? '#e8c98a' : `rgb(${30 + r() * 30},${45 + r() * 30},${60 + r() * 40})`;
      xa.fillRect(px, py, 22, 19);
      if (lit) { xe.fillStyle = '#ffcf7a'; xe.fillRect(px, py, 22, 19); }
    }
    const ta = new THREE.CanvasTexture(a), te = new THREE.CanvasTexture(e);
    for (const t of [ta, te]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; }
    return [ta, te];
  }

  function buildCity(scene) {
    const r = U.rng(2024);
    const pos = [], uv = [], col = [], idx = [], rpos = [], ridx = [];
    const tints = [[0.85, 0.83, 0.8], [0.62, 0.66, 0.72], [0.8, 0.72, 0.62], [0.55, 0.55, 0.58], [0.9, 0.9, 0.92], [0.7, 0.58, 0.5]];
    const addBox = (x0, x1, z0, z1, y0, y1) => {
      const t = tints[Math.floor(r() * tints.length)];
      const uo = Math.floor(r() * 8) / 8, vo = Math.floor(r() * 8) / 8;
      const h = y1 - y0;
      const wall = (ax, az, bx, bz) => {
        const base = pos.length / 3, len = Math.hypot(bx - ax, bz - az);
        pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
        const u1 = Math.round(len / 3) / 8, v1 = Math.round(h / 3.5) / 8;
        uv.push(uo, vo, uo + u1, vo, uo + u1, vo + v1, uo, vo + v1);
        for (let i = 0; i < 4; i++) col.push(t[0], t[1], t[2]);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      wall(x0, z1, x1, z1); wall(x1, z1, x1, z0); wall(x1, z0, x0, z0); wall(x0, z0, x0, z1);
      const b = rpos.length / 3;
      rpos.push(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0);
      ridx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      addCollider({ box: true, minx: x0, maxx: x1, minz: z0, maxz: z1 });
    };
    for (let bx = -CITY; bx < CITY; bx += CITY_STEP) {
      for (let bz = -CITY; bz < CITY; bz += CITY_STEP) {
        for (let sx = 0; sx < 2; sx++) for (let sz = 0; sz < 2; sz++) {
          if (r() < 0.1) continue;
          const lx = bx + 15 + sx * 42, lz = bz + 15 + sz * 42;
          const w = 26 + r() * 12, d = 26 + r() * 12;
          const cx = lx + 19, cz = lz + 19;
          const dc = Math.hypot(cx, cz);
          const h = 12 + r() * 22 + 130 * Math.exp(-(dc * dc) / (210 * 210)) * (0.35 + r() * 0.65);
          const g = low(cx, cz);
          addBox(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, g - 4, g + h);
          if (h > 70 && r() < 0.6) addBox(cx - w / 4, cx + w / 4, cz - d / 4, cz + d / 4, g + h, g + h + 8 + r() * 14);
        }
      }
    }
    const [ta, te] = windowTextures();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: ta, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 0.3, vertexColors: true, roughness: 0.55, metalness: 0.15, envMapIntensity: 0.8 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
    rgeo.setIndex(ridx);
    rgeo.computeVertexNormals();
    scene.add(new THREE.Mesh(rgeo, new THREE.MeshStandardMaterial({ color: 0x4a4a4d, roughness: 0.9 })));
  }

  // ---------- trees and roadside posts ----------
  function buildScenery(scene) {
    const r = U.rng(77);
    const trees = [];
    for (let i = 0; i < 26000 && trees.length < 5200; i++) {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 2950;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      if (inCity(x, z)) continue;
      if (U.fbm(x / 330 + 4, z / 330, 3) < -0.08) continue;
      const d = roadDist(x, z);
      if (d < 9) continue;
      const h = terrainHeight(x, z);
      if (h > 170) continue;
      trees.push({ x, z, h, s: 0.8 + r() * 0.9, c: r() });
    }
    const trunkG = new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6);
    trunkG.translate(0, 1.2, 0);
    const crownG = new THREE.ConeGeometry(1.9, 6.5, 7);
    crownG.translate(0, 5.0, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), trees.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0.3, flatShading: true }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    trees.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.c * 6.28);
      m.compose(new THREE.Vector3(t.x, t.h - 0.2, t.z), q, new THREE.Vector3(t.s, t.s * (0.85 + t.c * 0.4), t.s));
      trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
      c.setRGB(0.07 + t.c * 0.08, 0.2 + t.c * 0.14, 0.06 + t.c * 0.04);
      crowns.setColorAt(i, c);
      addCollider({ box: false, x: t.x, z: t.z, r: 0.3 * t.s, minx: t.x - 1, maxx: t.x + 1, minz: t.z - 1, maxz: t.z + 1 });
    });
    trunks.castShadow = crowns.castShadow = true;
    scene.add(trunks, crowns);

    const posts = [];
    for (const rd of roads) {
      if (rd.type === 'street' || rd.type === 'runway') continue;
      let acc = 0;
      const n = rd.pts.length;
      for (let i = 1; i < n; i++) {
        const a = rd.pts[i - 1], b = rd.pts[i];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        acc += len;
        if (acc < 40) continue;
        acc = 0;
        const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
        for (const s of [1, -1]) {
          const x = b.x + tz * s * (rd.hw + 1.4), z = b.z - tx * s * (rd.hw + 1.4);
          if (inCity(x, z)) continue;
          if (roadDist(x, z) < 0.6) continue;
          posts.push({ x, z });
        }
      }
    }
    const postG = new THREE.BoxGeometry(0.12, 1.0, 0.12);
    postG.translate(0, 0.5, 0);
    const pm = new THREE.InstancedMesh(postG, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, emissive: 0x332a22 }), posts.length);
    posts.forEach((p, i) => {
      m.makeTranslation(p.x, low(p.x, p.z) - 0.35, p.z);
      pm.setMatrixAt(i, m);
    });
    scene.add(pm);
  }

  // ---------- sky ----------
  const SUN = new THREE.Vector3(-0.45, 0.62, -0.5).normalize();
  function skyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: SUN } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float e = max(d.y, 0.0);
          vec3 zen = vec3(0.09, 0.27, 0.66), hor = vec3(0.62, 0.74, 0.86);
          vec3 c = mix(hor, zen, pow(e, 0.45));
          float sd = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.9, 0.75) * pow(sd, 8.0) * 0.25;
          c += vec3(1.0, 0.8, 0.55) * pow(sd, 60.0) * 0.8;
          c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, sd) * 12.0;
          if (d.y > 0.01) {
            vec2 p = d.xz / (d.y + 0.12) * 1.3;
            float cl = smoothstep(0.42, 0.8, fbm(p + 3.0));
            vec3 cc = mix(vec3(0.86, 0.88, 0.92), vec3(1.0, 1.0, 1.0), e) * (0.75 + 0.5 * pow(sd, 4.0));
            c = mix(c, cc, cl * smoothstep(0.01, 0.18, d.y) * 0.85);
          }
          c = mix(c, vec3(0.30, 0.30, 0.27), smoothstep(0.0, -0.08, d.y));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <encodings_fragment>
        }`,
    });
  }

  function buildSky(scene, renderer) {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMaterial());
    sky.frustumCulled = false;
    scene.add(sky);
    // reflections for paint and glass come from the same sky
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
    const pm = new THREE.PMREMGenerator(renderer);
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    scene.environment = pm.fromScene(envScene, 0.02).texture;
    renderer.toneMapping = tm;
    pm.dispose();
    scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.60, 0.72, 0.84), 250, 5200);
    const sun = new THREE.DirectionalLight(0xfff3df, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xb5cdf0, 0x545046, 0.6));
    return { sky, sun };
  }

  function drawMap(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const s = size / SIZE;
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (const rd of roads) {
      x.strokeStyle = rd.type === 'runway' ? 'rgba(255,255,255,0.95)' : rd.type === 'street' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)';
      x.lineWidth = Math.max(1.2, rd.hw * 2 * s * 1.6);
      x.beginPath();
      rd.pts.forEach((p, i) => { const px = (HALF - p.x) * s, py = (HALF - p.z) * s; i ? x.lineTo(px, py) : x.moveTo(px, py); });
      if (rd.closed) x.closePath();
      x.stroke();
    }
    return c;
  }

  function build(scene, renderer) {
    defineRoads();
    hashRoads();
    buildTerrain(scene);
    buildRoads(scene);
    buildCity(scene);
    buildScenery(scene);
    return buildSky(scene, renderer);
  }

  return { build, groundAt, roadDist, collidersNear, drawMap, SUN, SIZE, LIMIT };
})();
