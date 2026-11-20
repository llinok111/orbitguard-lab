# orbitguard-lab

**Promise:** on 4,000 random orbit poses, a fixed-radius camera ends up **inside solid geometry 369 times** and **behind an occluder 1,868 times**; this constrained rig is **inside 0/4,000 and occluded 0/4,000**, and 100,000 constrained resolve queries take **220.69 ms** (2.207 µs/query) against **1,461.07 ms** for the brute-force baseline in `baseline/naive.mjs` — **6.62× faster**, median of 7 samples after 2 warmups, RSD 1.89 %.

Upstream: none

## Run it

```bash
node tools/gen-sample.mjs        # deterministic scene -> data/scene.json
node bench/verify.mjs            # 19 assertions, exit 0
node bench/bench.mjs             # 7 samples + cold start -> bench/result.json
python3 -m http.server 4173      # open http://localhost:4173 (three r170 via CDN importmap)
```

Node 20+ is enough for every command above; the page needs a WebGL2 browser.

## What it is

A 3D orbit-camera clearance rig. The camera orbits a target at a **desired** radius; the rig
casts the exact target→camera ray, finds the first surface hit, and pulls the camera in front of
it with a margin. The result is guaranteed to sit on the clear side of the first hit, and the
line of sight from the target stays unblocked.

The point of the project is that the guarantee is **recomputable outside the browser**: the same
`src/core.mjs` is imported by the page, by `bench/verify.mjs`, and by `bench/bench.mjs`. The page
has a button that re-runs the exact 4,000-pose audit in the browser and compares the four counts
with `bench/result.json`.

Scene: 16 axis-aligned boxes (ground, 4 walls, 8 pillars, 3 plinths/slabs), 192 triangles,
bounding-box diagonal 52.792. All thresholds are **relative to that diagonal**: margin = 1 %
(0.52792), minimum radius = 0.5 % (0.26396). There is no absolute epsilon in the containment
or line-of-sight oracle — those are closed-form / parity tests.

## Evidence (real output of `node bench/verify.mjs` and `node bench/bench.mjs`)

| Check | Measured | Baseline |
|---|---|---|
| Camera inside solid, 4,000 poses | **0** | naive fixed radius: **369** |
| Line of sight blocked, 4,000 poses | **0** | naive fixed radius: **1,868** |
| Poses needing a clamp | 1,925 | — |
| Poses refused (target inside a solid) | 0 (explicitly tested separately, A14) | — |
| Retained-radius ratio (median / mean) | **1.000 / 0.739** | 1.000 / 1.000 but invalid |
| 100,000 constrained resolves, median | **220.69 ms** = 2.207 µs/query | brute force **1,461.07 ms** = 14.611 µs/query |
| Cold: scene build + BVH build + first query | **4.07 ms** | no build (brute) |
| First timed 100k pass | 219.90 ms | 1,442.77 ms |
| p95 (= max of 7 samples) / stddev | 229.58 ms / 4.18 ms | 1,498.48 ms / 19.85 ms |
| RSD of the 7 medians | **1.89 %** | 1.35 % |
| Margin slack, every non-fallback clamped pose | ≥ 0.52792 (worst = 0.52792) | — |
| BVH vs brute, 5,000 random rays | identical hit/miss, max\|Δt\| = **0** | — |
| Triangle-parity inside test vs closed-form box oracle, 1,000 points (140 inside) | **0 disagreements** | — |
| Uniform scale 1e-6 / 1e-3 / 1 / 1e3 / 1e6, 200 poses each | identical counts **and** per-pose radius/desired ratio, max\|Δ\| = **5.55e-16** | — |
| Assertions | **19/19 pass** | — |

Raw numbers live in `bench/result.json`; every figure above is a rounded copy of that file or of the
`bench/verify.mjs` output, and `node bench/bench.mjs` regenerates the timing block.

The speedup is modest because the scene has only 192 triangles — BVH build and traversal overhead
is a large share at that size. The claim is exactly the measured 6.62×, not a projection. Wall-clock
numbers are host-specific; `node bench/bench.mjs` prints the numbers for your machine, and the
correctness counts (the 0/0 and 369/1868 figures) are deterministic and do not depend on timing.

## Why the counts are trustworthy

- **Inside** is decided twice, by two different oracles: a closed-form point-in-box test and a
  triangle-parity ray test. They are compared on 1,000 random points, including the ground-slab
  interior below y=0 (A6).
- **Occlusion** is decided by a brute-force segment/triangle test that walks *all* 192 triangles
  and does not use the BVH (A15 sanity, plus per-pose checks in A10).
- The naive baseline is executed on the same poses with the same `rayTriangle` kernel; A19 checks
  that the BVH rig and the brute rig return the same radius on 600 poses.
- Scale invariance is asserted per pose, not assumed: the same seed produces the same pose set at
  1e-6, 1e-3, 1, 1e3 and 1e6; the counts and every radius/desired ratio must match (A16).
- Honest caveat: BVH and brute share the ray/triangle kernel and its relative parallel tolerance.
  A5/A19 therefore prove the accelerator is equivalent, **not** that the kernel is correct; the
  independent evidence for the kernel is A3 (analytic axis-aligned hit at exactly t=5) and A6
  (parity vs closed-form boxes).

## Known limitations

- The scene is a union of axis-aligned boxes; the rig itself works on any triangle soup, but the
  independent containment oracle is only closed-form for boxes.
- One spherical orbit target; no multi-target, no camera path smoothing, no temporal coherence.
- Only the **camera point** is kept outside geometry. The near plane is not tested, so a very
  shallow clamp can still clip a wall with the near plane.
- When `tHit - margin` falls below the minimum radius, the rig falls back to `tHit / 2` and reports
  `near-wall`; the camera stays outside but the framing becomes very tight (A13).
- The camera thresholds are relative: `marginRel=0.01` and `minRel=0.005` are fractions of the
  bounding-box diagonal. Kernel tolerances are local-relative too (`|det| ≤ 1e-12·|e1||e2|`, segment
  cutoff `len·(1−1e-9)`), so the classification is scale-free under uniform scaling; non-uniform
  scale is out of scope.
- BVH is a median-split AABB tree rebuilt per scene. The 4.07 ms cold number covers scene + BVH
  build + the first query; the 100k-query timed passes exclude the build.

## 本轮创新

B 档。台账里没有任何「相机可见性」项目：`swept-collide-lab` 算的是运动球的最早接触时间，
`pointcloud-studio`/`pointpick-lab` 是查询加速，`tangentframe-lab` 修的是切线标架。这里的
新东西是把「轨道相机不穿模 + 目标视线不被挡」做成一份**离线可复算的证书**：同一份
`src/core.mjs` 在 node 里跑 4,000 姿态审计、在浏览器里由按钮原样复跑并逐项对账，且所有
相机阈值是包围盒对角线比例、核内公差是局部相对量，1e-6..1e6 五个量级逐姿态半径比 max|Δ|=5.55e-16——「所见即所验」，而不是
只在浏览器里看着不穿模。

## License

MIT © 2026 llinok111. See `LICENSE`.