// baseline/naive.mjs — the same camera constraint, but with a brute-force ray cast
// over every triangle. This is the control baseline for the bench numbers.
import { cameraDir, pointInBoxes, raycastBrute } from '../src/core.mjs';

export function resolveOrbitBrute(scene, target, yaw, pitch, desired, opts = {}) {
  const margin = (opts.marginRel ?? 0.01) * scene.diag;
  const minR = (opts.minRel ?? 0.005) * scene.diag;
  if (pointInBoxes(scene.boxes, target[0], target[1], target[2])) {
    return { ok: false, reason: 'target-inside', radius: 0, pos: [...target], tHit: 0, clamped: false };
  }
  const d = cameraDir(yaw, pitch);
  const t = raycastBrute(scene.tris, target[0], target[1], target[2], d[0], d[1], d[2], desired + margin);
  let r = Math.min(desired, Math.max(0, t - margin));
  let degraded = false;
  if (r < minR) { r = Math.min(desired, t * 0.5); degraded = true; }
  return {
    ok: true, reason: degraded ? 'near-wall' : (r < desired ? 'clamped' : 'free'),
    radius: r, pos: [target[0] + d[0] * r, target[1] + d[1] * r, target[2] + d[2] * r],
    tHit: t, clamped: r < desired, degraded
  };
}