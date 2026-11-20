// bench/verify.mjs — real assertions over the generated scene and the orbit rig.
import { readFileSync } from 'node:fs';
import {
  buildScene, makePoses, audit, resolveOrbit, resolveNaive, cameraDir,
  raycastBVH, raycastBrute, rayTriangle, pointInMesh, pointInBoxes,
  segmentHitsMesh, sha256HexFromArray
} from '../src/core.mjs';
import { resolveOrbitBrute } from '../baseline/naive.mjs';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`PASS ${name} :: ${detail}`); }
  else { fail++; console.log(`FAIL ${name} :: ${detail}`); }
};

const scene = buildScene({ scale: 1 });
const margin = 0.01 * scene.diag;
const minR = 0.005 * scene.diag;

// A1 deterministic build
const scene2 = buildScene({ scale: 1 });
check('A1 scene-build-deterministic', sha256HexFromArray(scene.tris) === sha256HexFromArray(scene2.tris) &&
  scene.tris.length === scene2.tris.length, `hash=${sha256HexFromArray(scene.tris)} tris=${scene.tris.length / 9}`);

// A2 topology of the analytic scene
check('A2 scene-shape', scene.boxes.length === 16 && scene.tris.length / 9 === 192,
  `boxes=16 tris=192 diag=${scene.diag.toFixed(6)}`);

// A3 ray hits the ground plane exactly
const tDrop = raycastBVH(scene.bvh, 0, 5, 0, 0, -1, 0, 100);
check('A3 downward-ray-ground', Math.abs(tDrop - 5) <= 1e-12 * scene.diag, `t=${tDrop}`);

// A4 ray misses
check('A4 upward-ray-miss', raycastBVH(scene.bvh, 0, 2, 0, 0, 1, 0, 100) === Infinity, 't=Infinity');

// A5 BVH vs brute over random rays: identical hit/miss and hit distance
let mism = 0, maxDelta = 0;
const rng = (() => { let a = 5; return () => { a = (Math.imul(a ^ (a >>> 15), a | 1) + 0x6d2b79f5) >>> 0; return a / 4294967296; }; })();
for (let i = 0; i < 5000; i++) {
  const o = [(rng() - 0.5) * 40, rng() * 8, (rng() - 0.5) * 40];
  let d = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
  const L = Math.hypot(d[0], d[1], d[2]); d = d.map(v => v / L);
  const tb = raycastBrute(scene.tris, o[0], o[1], o[2], d[0], d[1], d[2], 200);
  const th = raycastBVH(scene.bvh, o[0], o[1], o[2], d[0], d[1], d[2], 200);
  if ((tb === Infinity) !== (th === Infinity)) mism++;
  else if (tb !== Infinity) maxDelta = Math.max(maxDelta, Math.abs(tb - th));
}
check('A5 bvh-vs-brute-raymatch', mism === 0 && maxDelta <= 1e-12 * scene.diag,
  `rays=5000 mismatch=${mism} max|dt|=${maxDelta}`);

// A6 triangle parity inside test agrees with closed-form box oracle
let insideMism = 0, insideHits = 0;
const rng2 = (() => { let a = 9; return () => { a = (Math.imul(a ^ (a >>> 15), a | 1) + 0x6d2b79f5) >>> 0; return a / 4294967296; }; })();
for (let i = 0; i < 500; i++) {
  const x = (rng2() - 0.5) * 40, y = rng2() * 8, z = (rng2() - 0.5) * 40;
  if (pointInMesh(scene.tris, x, y, z) !== pointInBoxes(scene.boxes, x, y, z)) insideMism++;
  if (pointInBoxes(scene.boxes, x, y, z)) insideHits++;
}
check('A6 parity-vs-box-oracle', insideMism === 0, `points=500 oracle-inside=${insideHits} disagreements=${insideMism}`);

// A7 free pose keeps the requested radius untouched
const freeT = [0, 2, 0];
const free = resolveOrbit(scene, freeT, 0, 0.2, 3);
check('A7 free-pose-unclamped', free.ok && !free.clamped && Math.abs(free.radius - 3) <= 1e-12,
  `reason=${free.reason} radius=${free.radius}`);

// A8 wall-blocked pose gets clamped and stays outside, with clear line of sight
const blocked = resolveOrbit(scene, [0, 2, 0], 0, 0, 30);
const blockedInside = pointInBoxes(scene.boxes, ...blocked.pos);
const blockedLOS = segmentHitsMesh(scene.tris, 0, 2, 0, ...blocked.pos);
check('A8 wall-pose-clamped', blocked.ok && blocked.clamped && blocked.radius < 30 &&
  !blockedInside && !blockedLOS,
  `radius=${blocked.radius.toFixed(6)} tHit=${blocked.tHit.toFixed(6)} inside=${blockedInside} losBlocked=${blockedLOS}`);

// A9 margin is respected whenever the result is not in the near-wall fallback
const slack = blocked.tHit - blocked.radius;
check('A9 margin-respected', slack >= margin * (1 - 1e-9),
  `tHit-radius=${slack.toFixed(6)} margin=${margin.toFixed(6)}`);

// A10 audit: 4000 poses, ours never inside / never occluded
const poses = makePoses(4000, 11, 1, true);
const rep = audit(scene, poses);
check('A10 audit-zero-violations', rep.invalid === 0 && rep.oursInside === 0 && rep.oursBlocked === 0 &&
  rep.naiveInside > 0 && rep.naiveBlocked > 0,
  `poses=${rep.poses} invalid=${rep.invalid} naiveInside=${rep.naiveInside} naiveBlocked=${rep.naiveBlocked} oursInside=${rep.oursInside} oursBlocked=${rep.oursBlocked} clamped=${rep.clamped}`);

// A11 only blocked poses lose radius; free poses keep all of it
check('A11 retained-radius', rep.medianRatio === 1 && rep.meanRatio < 1 && rep.meanRatio > 0.5,
  `medianRatio=${rep.medianRatio} meanRatio=${rep.meanRatio.toFixed(6)} free=${rep.free} clamped=${rep.clamped}`);

// A12 margin slack over every audited clamped pose
let worstSlack = Infinity, slackViolations = 0, slackChecked = 0;
for (const p of poses) {
  const r = resolveOrbit(scene, p.target, p.yaw, p.pitch, p.desired);
  if (!r.ok || !r.clamped || r.degraded) continue;
  slackChecked++;
  const s = r.tHit - r.radius;
  if (s < margin * (1 - 1e-9)) slackViolations++;
  if (s < worstSlack) worstSlack = s;
}
check('A12 margin-all-clamped', slackViolations === 0 && slackChecked > 1000,
  `checked=${slackChecked} worstSlack=${worstSlack.toFixed(6)} violations=${slackViolations}`);

// A13 near-wall fallback survives without entering geometry
const near = resolveOrbit(scene, [17, 2, 0], 0, 0, 10);
check('A13 near-wall-fallback', near.ok && near.degraded && near.reason === 'near-wall' &&
  near.radius < minR && !pointInBoxes(scene.boxes, ...near.pos) &&
  !segmentHitsMesh(scene.tris, 17, 2, 0, ...near.pos),
  `radius=${near.radius.toFixed(6)} minR=${minR.toFixed(6)} reason=${near.reason}`);

// A14 target inside a solid is refused, not silently clamped
const bad = resolveOrbit(scene, [18, 3, 0], 0, 0, 5);
check('A14 target-inside-refused', bad.ok === false && bad.reason === 'target-inside', `ok=${bad.ok} reason=${bad.reason}`);

// A15 LOS oracle sanity (segment through a wall vs short open segment)
const losBad = segmentHitsMesh(scene.tris, 0, 2, 0, 25, 2, 0);
const losOk = segmentHitsMesh(scene.tris, 0, 2, 0, 5, 2, 0);
check('A15 los-oracle-sanity', losBad === true && losOk === false, `through-wall=${losBad} open=${losOk}`);

// A16 scale invariance: 1e-3, 1, 1e3 must classify identically
const scaled = [1e-3, 1, 1e3].map(s => {
  const sc = buildScene({ scale: s });
  const ps = makePoses(500, 13, s, true);
  return audit(sc, ps);
});
const same = scaled.every(r => r.oursInside === 0 && r.oursBlocked === 0 &&
  r.naiveInside === scaled[1].naiveInside && r.naiveBlocked === scaled[1].naiveBlocked &&
  r.clamped === scaled[1].clamped && r.degraded === scaled[1].degraded);
check('A16 scale-invariance', same,
  scaled.map(r => `${r.oursInside}/${r.oursBlocked}/${r.naiveInside}/${r.naiveBlocked}/${r.clamped}`).join(' | '));

// A17 no NaN / no negative radius across the audit
let nan = 0;
for (const p of poses) {
  const r = resolveOrbit(scene, p.target, p.yaw, p.pitch, p.desired);
  if (!r.ok) continue;
  if (!Number.isFinite(r.radius) || r.radius < 0 || r.pos.some(v => !Number.isFinite(v))) nan++;
}
check('A17 finite-outputs', nan === 0, `poses=${poses.length} nonFinite=${nan}`);

// A18 generated data file matches the in-memory scene
const data = JSON.parse(readFileSync(new URL('../data/scene.json', import.meta.url), 'utf8'));
check('A18 sample-file-matches-core', data.triangleCount === scene.tris.length / 9 && data.hash === sha256HexFromArray(scene.tris) &&
  data.boxCount === scene.boxes.length,
  `file tris=${data.triangleCount} hash=${data.hash}`);

// A19 brute baseline agrees with BVH rig on the audit set (same math, no acceleration)
let baselineDiff = 0;
for (let i = 0; i < 600; i++) {
  const p = poses[i];
  const a = resolveOrbit(scene, p.target, p.yaw, p.pitch, p.desired);
  const b = resolveOrbitBrute(scene, p.target, p.yaw, p.pitch, p.desired);
  if (a.ok !== b.ok || Math.abs(a.radius - b.radius) > 1e-9 * scene.diag) baselineDiff++;
}
check('A19 brute-baseline-agrees', baselineDiff === 0, `poses=600 mismatches=${baselineDiff}`);

console.log(`\n${pass}/${pass + fail} assertions passed`);
if (fail) { console.log(`FAILED ${fail}`); process.exit(1); }
process.exit(0);