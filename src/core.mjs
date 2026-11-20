// src/core.mjs — pure ES module. No DOM, no three.js, no I/O.
// Orbit-camera clearance: analytic scene, BVH ray casts, constrained radius.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scene = union of axis-aligned boxes (a gallery: ground, walls, pillars, slabs).
// Boxes give a closed-form containment oracle, so "is the camera inside geometry"
// is decided without any epsilon and independently of the triangle/BVH path.
export function buildBoxes(scale = 1) {
  const B = [];
  const add = (cx, cy, cz, hx, hy, hz) => B.push({ cx: cx * scale, cy: cy * scale, cz: cz * scale, hx: hx * scale, hy: hy * scale, hz: hz * scale });
  add(0, -0.5, 0, 18, 0.5, 18);           // ground
  add(-18, 3, 0, 0.5, 3, 18);             // wall -x
  add(18, 3, 0, 0.5, 3, 18);              // wall +x
  add(0, 3, -18, 18, 3, 0.5);             // wall -z
  add(0, 3, 18, 18, 3, 0.5);              // wall +z
  for (const x of [-9, 0, 9]) {
    for (const z of [-9, 0, 9]) {
      if (x === 0 && z === 0) continue;   // leave the centre open
      add(x, 2.5, z, 0.9, 2.5, 0.9);      // pillars
    }
  }
  add(-5, 0.6, 4.5, 1.4, 0.6, 1.4);       // low plinths
  add(5.5, 0.6, -4, 1.4, 0.6, 1.4);
  add(4.5, 1.1, 5, 1.0, 1.1, 1.0);
  return B;
}

// 12 triangles per box, outward winding, non-indexed Float64.
export function boxTriangles(b) {
  const x0 = b.cx - b.hx, x1 = b.cx + b.hx;
  const y0 = b.cy - b.hy, y1 = b.cy + b.hy;
  const z0 = b.cz - b.hz, z1 = b.cz + b.hz;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 2, 1, 0, 3, 2], [4, 5, 6, 4, 6, 7], [0, 1, 5, 0, 5, 4],
             [3, 7, 6, 3, 6, 2], [0, 4, 7, 0, 7, 3], [1, 2, 6, 1, 6, 5]];
  const out = [];
  for (const f of q) for (const i of f) out.push(v[i][0], v[i][1], v[i][2]);
  return out;
}

function triAABB(t, i) {
  const a = i * 9;
  const x0 = Math.min(t[a], t[a + 3], t[a + 6]), x1 = Math.max(t[a], t[a + 3], t[a + 6]);
  const y0 = Math.min(t[a + 1], t[a + 4], t[a + 7]), y1 = Math.max(t[a + 1], t[a + 4], t[a + 7]);
  const z0 = Math.min(t[a + 2], t[a + 5], t[a + 8]), z1 = Math.max(t[a + 2], t[a + 5], t[a + 8]);
  return [x0, y0, z0, x1, y1, z1];
}

// Median-split BVH over triangle AABBs. Deterministic: no RNG, stable order.
export function buildBVH(tris, leafSize = 4) {
  const n = tris.length / 9;
  const order = new Int32Array(n);
  const box = new Float64Array(n * 6);
  for (let i = 0; i < n; i++) {
    order[i] = i;
    const b = triAABB(tris, i);
    box.set(b, i * 6);
  }
  const nodes = [];
  const build = (start, count) => {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = start; k < start + count; k++) {
      const b = box.subarray(order[k] * 6, order[k] * 6 + 6);
      for (let a = 0; a < 3; a++) { if (b[a] < mn[a]) mn[a] = b[a]; if (b[a + 3] > mx[a]) mx[a] = b[a + 3]; }
    }
    const node = { mn, mx, start, count, left: -1, right: -1 };
    const id = nodes.length;
    nodes.push(node);
    if (count <= leafSize) return id;
    let ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    let axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : (ext[1] >= ext[2] ? 1 : 2);
    const c = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
    const idx = Array.from(order.subarray(start, start + count));
    idx.sort((p, q) => (box[p * 6 + axis] + box[p * 6 + 3 + axis]) - (box[q * 6 + axis] + box[q * 6 + 3 + axis]) || p - q);
    for (let i = 0; i < count; i++) order[start + i] = idx[i];
    const mid = count >> 1;
    node.left = build(start, mid);
    node.right = build(start + mid, count - mid);
    node.count = 0;                      // interior node: children own the range
    return id;
  };
  build(0, n);
  return { nodes, order, tris };
}

// Relative tolerances only: both scale with the operand's own magnitude.
const PARALLEL_REL = 1e-12;

// Moller-Trumbore. Returns t>0 or Infinity. `epsT` is a relative-to-triangle-size slack.
export function rayTriangle(ox, oy, oz, dx, dy, dz, t, i, maxT = Infinity) {
  const a = i * 9;
  const ax = t[a], ay = t[a + 1], az = t[a + 2];
  const e1x = t[a + 3] - ax, e1y = t[a + 4] - ay, e1z = t[a + 5] - az;
  const e2x = t[a + 6] - ax, e2y = t[a + 7] - ay, e2z = t[a + 8] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  const scale = Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z);
  if (scale === 0 || Math.abs(det) <= PARALLEL_REL * scale) return Infinity;
  const inv = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (!(tt > 0) || tt > maxT) return Infinity;
  return tt;
}

function slab(node, ox, oy, oz, idx, idy, idz, tMax) {
  let t0 = 0, t1 = tMax;
  const o = [ox, oy, oz], d = [idx, idy, idz];
  for (let a = 0; a < 3; a++) {
    const inv = d[a];
    let ta = (node.mn[a] - o[a]) * inv;
    let tb = (node.mx[a] - o[a]) * inv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}

export function raycastBVH(bvh, ox, oy, oz, dx, dy, dz, maxT = Infinity) {
  const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
  const { nodes, order, tris } = bvh;
  let best = maxT, hit = false;
  const stack = [0];
  while (stack.length) {
    const node = nodes[stack.pop()];
    if (!slab(node, ox, oy, oz, idx, idy, idz, best)) continue;
    if (node.left < 0) {
      for (let k = node.start; k < node.start + node.count; k++) {
        const t = rayTriangle(ox, oy, oz, dx, dy, dz, tris, order[k], best);
        if (t < best) { best = t; hit = true; }
      }
    } else {
      stack.push(node.left, node.right);
    }
  }
  return hit ? best : Infinity;
}

export function raycastBrute(tris, ox, oy, oz, dx, dy, dz, maxT = Infinity) {
  let best = maxT, hit = false;
  const n = tris.length / 9;
  for (let i = 0; i < n; i++) {
    const t = rayTriangle(ox, oy, oz, dx, dy, dz, tris, i, best);
    if (t < best) { best = t; hit = true; }
  }
  return hit ? best : Infinity;
}

export function pointInBox(b, x, y, z) {
  return Math.abs(x - b.cx) <= b.hx && Math.abs(y - b.cy) <= b.hy && Math.abs(z - b.cz) <= b.hz;
}

export function pointInBoxes(boxes, x, y, z) {
  for (const b of boxes) if (pointInBox(b, x, y, z)) return true;
  return false;
}

// Triangle parity oracle (independent of the box oracle, shares only the mesh).
export function pointInMesh(tris, x, y, z) {
  const dx = 0.2672612419124244, dy = 0.5345224838248488, dz = 0.8017837257372732;
  let hits = 0;
  const n = tris.length / 9;
  for (let i = 0; i < n; i++) {
    const t = rayTriangle(x, y, z, dx, dy, dz, tris, i, Infinity);
    if (t < Infinity) hits++;
  }
  return (hits & 1) === 1;
}

export function segmentHitsMesh(tris, ax, ay, az, bx, by, bz) {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const len = Math.hypot(vx, vy, vz);
  if (len === 0) return false;
  const dx = vx / len, dy = vy / len, dz = vz / len;
  const n = tris.length / 9;
  for (let i = 0; i < n; i++) {
    const t = rayTriangle(ax, ay, az, dx, dy, dz, tris, i, len * (1 - 1e-9));
    if (t < Infinity) return true;
  }
  return false;
}

export function buildScene({ seed = 7, scale = 1 } = {}) {
  const boxes = buildBoxes(scale);
  const chunks = boxes.map(boxTriangles);
  const flat = [];
  for (const c of chunks) for (const v of c) flat.push(v);
  const tris = Float64Array.from(flat);
  const bvh = buildBVH(tris);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let a = 0; a < 3; a++) {
    if (tris[i + a] < mn[a]) mn[a] = tris[i + a];
    if (tris[i + a] > mx[a]) mx[a] = tris[i + a];
  }
  const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  return { seed, scale, boxes, tris, bvh, diag, bounds: { min: mn, max: mx } };
}

export function cameraDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [cp * Math.cos(yaw), Math.sin(pitch), cp * Math.sin(yaw)];
}

// Constrained orbit radius. Guarantees: returned position lies strictly on the
// clear side of the first hit along the exact camera ray, unless target is inside.
export function resolveOrbit(scene, target, yaw, pitch, desired, opts = {}) {
  const margin = (opts.marginRel ?? 0.01) * scene.diag;
  const minR = (opts.minRel ?? 0.005) * scene.diag;
  const inside = pointInBoxes(scene.boxes, target[0], target[1], target[2]);
  if (inside) return { ok: false, reason: 'target-inside', radius: 0, pos: [...target], tHit: 0, clamped: false };
  const d = cameraDir(yaw, pitch);
  const t = raycastBVH(scene.bvh, target[0], target[1], target[2], d[0], d[1], d[2], desired + margin);
  let r = Math.min(desired, Math.max(0, t - margin));
  let degraded = false;
  if (r < minR) { r = Math.min(desired, t * 0.5); degraded = true; }
  const clamped = r < desired;
  return {
    ok: true, reason: degraded ? 'near-wall' : (clamped ? 'clamped' : 'free'),
    radius: r, pos: [target[0] + d[0] * r, target[1] + d[1] * r, target[2] + d[2] * r],
    tHit: t, clamped, degraded
  };
}

// Naive baseline: ignores geometry entirely.
export function resolveNaive(scene, target, yaw, pitch, desired) {
  const d = cameraDir(yaw, pitch);
  return { pos: [target[0] + d[0] * desired, target[1] + d[1] * desired, target[2] + d[2] * desired], radius: desired };
}

// Targets that fall inside a solid are resampled: the audit is about the camera rig,
// not about invalid targets. `rejectInside=false` keeps them for the negative test.
export function makePoses(count, seed = 11, scale = 1, rejectInside = true) {
  const rng = mulberry32(seed);
  const boxes = buildBoxes(1);
  const poses = [];
  let guard = 0;
  while (poses.length < count) {
    const raw = [(rng() - 0.5) * 10, 1.2 + rng() * 1.8, (rng() - 0.5) * 10];
    const yaw = rng() * Math.PI * 2;
    const pitch = (rng() - 0.5) * 1.2;
    const desired = 3 + rng() * 21;
    // The decision is made on unit-scale coordinates, so the same seed produces
    // the same pose set at every scale (no scale-dependent resampling).
    if (rejectInside && pointInBoxes(boxes, raw[0], raw[1], raw[2])) {
      if (++guard > count * 50) throw new Error('pose rejection failed');
      continue;
    }
    poses.push({ target: raw.map(v => v * scale), yaw, pitch, desired: desired * scale });
  }
  return poses;
}

// Full audit. Ground truth for "inside solid" is the closed-form box oracle,
// the LOS test is an independent brute-force segment/triangle test.
export function audit(scene, poses) {
  let naiveInside = 0, naiveBlocked = 0, oursInside = 0, oursBlocked = 0;
  let clamped = 0, degraded = 0, invalid = 0, free = 0;
  let sumRetained = 0, retainedN = 0;
  const ratios = [];
  for (const p of poses) {
    const n = resolveNaive(scene, p.target, p.yaw, p.pitch, p.desired);
    const o = resolveOrbit(scene, p.target, p.yaw, p.pitch, p.desired);
    const ni = pointInBoxes(scene.boxes, n.pos[0], n.pos[1], n.pos[2]);
    const nb = segmentHitsMesh(scene.tris, p.target[0], p.target[1], p.target[2], n.pos[0], n.pos[1], n.pos[2]);
    if (ni) naiveInside++;
    if (nb) naiveBlocked++;
    if (!o.ok) { invalid++; continue; }
    const oi = pointInBoxes(scene.boxes, o.pos[0], o.pos[1], o.pos[2]);
    const ob = segmentHitsMesh(scene.tris, p.target[0], p.target[1], p.target[2], o.pos[0], o.pos[1], o.pos[2]);
    if (oi) oursInside++;
    if (ob) oursBlocked++;
    if (o.clamped) clamped++;
    if (o.degraded) degraded++;
    if (o.reason === 'free') free++;
    const ratio = o.radius / p.desired;
    ratios.push(ratio);
    sumRetained += ratio; retainedN++;
  }
  ratios.sort((a, b) => a - b);
  const median = ratios.length ? ratios[ratios.length >> 1] : 0;
  return { poses: poses.length, naiveInside, naiveBlocked, oursInside, oursBlocked, clamped, degraded, invalid, free, medianRatio: median, meanRatio: retainedN ? sumRetained / retainedN : 0 };
}

export function digestHex(arr) {
  // Deterministic 32-bit FNV-1a over float64 bits (not a cryptographic hash).
  const buf = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5n;
  for (let i = 0; i < arr.length; i++) {
    buf.setFloat64(0, arr[i]);
    for (let b = 0; b < 8; b++) {
      h ^= BigInt(buf.getUint8(b));
      h = (h * 0x01000193n) & 0xffffffffn;
    }
  }
  return h.toString(16).padStart(8, '0');
}