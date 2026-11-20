// bench/bench.mjs — 100k orbit-resolve queries, BVH vs the brute-force baseline.
import { writeFileSync } from 'node:fs';
import { buildScene, makePoses, audit, resolveOrbit, digestHex } from '../src/core.mjs';
import { resolveOrbitBrute } from '../baseline/naive.mjs';

const poses = makePoses(4000, 11, 1, true);

const PASSES = 5;                       // 5 x 20,000 = 100,000 queries per sample
const QUERIES = 20000 * PASSES;
const now = () => Number(process.hrtime.bigint()) / 1e6;

function run(kind) {
  const fn = kind === 'bvh' ? resolveOrbit : resolveOrbitBrute;
  const t0 = now();
  let acc = 0;
  for (let p = 0; p < PASSES; p++) {
    for (let i = 0; i < 20000; i++) {
      const q = poses[(i + p * 20000) % poses.length];
      acc += fn(scene, q.target, q.yaw, q.pitch, q.desired).radius;
    }
  }
  return { ms: now() - t0, acc };
}

// Process-cold: scene + BVH build and the very first constrained query, before the
// audit and before any warmup pass. (Node/module startup is outside this timer.)
const coldT0 = now();
const scene = buildScene({ scale: 1 });
resolveOrbit(scene, poses[0].target, poses[0].yaw, poses[0].pitch, poses[0].desired);
const coldScene = now() - coldT0;

const rep = audit(buildScene({ scale: 1 }), poses);
const warm = [run('bvh'), run('brute')];
const postWarmup = { bvh: run('bvh').ms, brute: run('brute').ms };
const samples = { bvh: [], brute: [] };
for (let i = 0; i < 7; i++) { samples.bvh.push(run('bvh').ms); samples.brute.push(run('brute').ms); }

const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const mean = s.reduce((x, y) => x + y, 0) / s.length;
  const med = s[s.length >> 1];
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  const sd = Math.sqrt(s.reduce((x, y) => x + (y - mean) ** 2, 0) / s.length);
  return { samples: s, min: s[0], median: med, p95, mean, stddev: sd, rsd: sd / mean };
};
const b = stat(samples.bvh), n = stat(samples.brute);
const out = {
  scene: { boxes: scene.boxes.length, triangles: scene.tris.length / 9, bboxDiag: scene.diag, hash: digestHex(scene.tris) },
  audit: rep,
  queriesPerSample: QUERIES,
  samplesCount: 7,
  warmup: 2,
  coldMs: { sceneBuildPlusFirstQuery: coldScene, postWarmupBvhPass: postWarmup.bvh, postWarmupBrutePass: postWarmup.brute },
  coldIncludes: 'scene build + BVH build + first constrained query, timed before the audit and any warmup',
  p95Note: 'nearest-rank over 7 samples, i.e. the maximum sample',
  bvh: b,
  brute: { ...n },
  perQueryUs: { bvh: b.median * 1000 / QUERIES, brute: n.median * 1000 / QUERIES },
  speedupMedian: n.median / b.median,
  warmAccUm: warm[1].acc
};
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({
  queriesPerSample: QUERIES, samples: 7,
  bvh: { coldScene: coldScene.toFixed(2), postWarmupPass: postWarmup.bvh.toFixed(2), median: b.median.toFixed(2), p95max: b.p95.toFixed(2), rsd: (b.rsd * 100).toFixed(2), us: out.perQueryUs.bvh.toFixed(4) },
  brute: { postWarmupPass: postWarmup.brute.toFixed(2), median: n.median.toFixed(2), p95max: n.p95.toFixed(2), rsd: (n.rsd * 100).toFixed(2), us: out.perQueryUs.brute.toFixed(4) },
  speedup: out.speedupMedian.toFixed(2) + 'x',
  audit: { naiveInside: rep.naiveInside, naiveBlocked: rep.naiveBlocked, oursInside: rep.oursInside, oursBlocked: rep.oursBlocked, clamped: rep.clamped }
}, null, 2));