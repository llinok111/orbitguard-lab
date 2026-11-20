// tools/gen-sample.mjs — deterministic scene export. Running twice is byte-identical.
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildScene, sha256HexFromArray } from '../src/core.mjs';

const scene = buildScene({ scale: 1 });
const payload = {
  generator: 'tools/gen-sample.mjs',
  seed: scene.seed,
  scale: scene.scale,
  triangleCount: scene.tris.length / 9,
  boxCount: scene.boxes.length,
  bboxDiag: scene.diag,
  hash: sha256HexFromArray(scene.tris),
  boxes: scene.boxes,
  triangles: Array.from(scene.tris)
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/scene.json', import.meta.url), JSON.stringify(payload, null, 0) + '\n');
console.log(`scene: ${payload.triangleCount} triangles, ${payload.boxCount} boxes, diag ${scene.diag.toFixed(4)}, hash ${payload.hash}`);