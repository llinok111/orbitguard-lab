// main.js — rendering + interaction only. All geometry/visibility math is in src/core.mjs.
import * as THREE from 'three';
import {
  buildScene, makePoses, audit, resolveOrbit, resolveNaive,
  pointInBoxes, segmentHitsMesh
} from './src/core.mjs';

const scene3 = buildScene({ scale: 1 });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 45, 95);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 300);
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x1a2230, 1.35);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
sun.position.set(12, 22, 8);
scene.add(sun);

const matStone = new THREE.MeshStandardMaterial({ color: 0x44576b, roughness: 0.88, metalness: 0.03 });
const matWarm = new THREE.MeshStandardMaterial({ color: 0x7a5a44, roughness: 0.8 });
const boxMeshes = [];
scene3.boxes.forEach((b, i) => {
  const geo = new THREE.BoxGeometry(2 * b.hx, 2 * b.hy, 2 * b.hz);
  const mesh = new THREE.Mesh(geo, i === 0 ? matStone : (i % 3 === 0 ? matWarm : matStone));
  mesh.position.set(b.cx, b.cy, b.cz);
  scene.add(mesh);
  boxMeshes.push(mesh);
});

const target = new THREE.Vector3(0, 2, 0);
const targetDot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x7fd1ff }));
targetDot.position.copy(target);
scene.add(targetDot);

const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.85 }));
scene.add(ghost);

const actualLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([target.clone(), target.clone()]),
  new THREE.LineBasicMaterial({ color: 0x4ade80 })
);
const ghostLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([target.clone(), target.clone()]),
  new THREE.LineBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.55 })
);
scene.add(actualLine, ghostLine);

const pose = { yaw: 0.6, pitch: 0.24, desired: 13 };
let dragging = false, lastX = 0, lastY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  pose.yaw -= (e.clientX - lastX) * 0.006;
  pose.pitch = Math.max(-0.45, Math.min(1.15, pose.pitch + (e.clientY - lastY) * 0.004));
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  pose.desired = Math.max(1.5, Math.min(34, pose.desired * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: false });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const $ = (id) => document.getElementById(id);
const fmt = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : '∞');

function frame() {
  const r = resolveOrbit(scene3, [target.x, target.y, target.z], pose.yaw, pose.pitch, pose.desired);
  const n = resolveNaive(scene3, [target.x, target.y, target.z], pose.yaw, pose.pitch, pose.desired);
  const inside = !r.ok ? true : pointInBoxes(scene3.boxes, r.pos[0], r.pos[1], r.pos[2]);
  const losBad = !r.ok ? true : segmentHitsMesh(scene3.tris, target.x, target.y, target.z, r.pos[0], r.pos[1], r.pos[2]);
  const naiveInside = pointInBoxes(scene3.boxes, n.pos[0], n.pos[1], n.pos[2]);

  camera.position.set(r.pos[0], r.pos[1], r.pos[2]);
  camera.lookAt(target);
  ghost.position.set(n.pos[0], n.pos[1], n.pos[2]);
  ghost.visible = naiveInside;
  actualLine.geometry.setFromPoints([target.clone(), new THREE.Vector3(r.pos[0], r.pos[1], r.pos[2])]);
  ghostLine.geometry.setFromPoints([target.clone(), new THREE.Vector3(n.pos[0], n.pos[1], n.pos[2])]);

  $('v-desired').textContent = fmt(pose.desired);
  $('v-actual').textContent = fmt(r.radius);
  $('v-hit').textContent = fmt(r.tHit);
  const st = $('v-status');
  st.textContent = r.ok ? r.reason : r.reason;
  st.className = r.reason === 'free' ? 'ok' : (r.reason === 'near-wall' ? 'warn' : 'bad');
  $('v-inside').textContent = String(inside);
  $('v-inside').className = inside ? 'bad' : 'ok';
  $('v-los').textContent = String(losBad);
  $('v-los').className = losBad ? 'bad' : 'ok';
  $('v-naive').textContent = String(naiveInside);
  $('v-naive').className = naiveInside ? 'bad' : 'v';

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Node/browser parity: the same 4,000-pose seed must reproduce bench/result.json.
const NODE_POSES = 4000;
fetch('./bench/result.json').then(r => r.json()).then(j => {
  const a = j.audit;
  $('v-node').textContent = `naiveInside=${a.naiveInside} naiveBlocked=${a.naiveBlocked} oursInside=${a.oursInside} oursBlocked=${a.oursBlocked} clamped=${a.clamped}`;
  $('v-node').dataset.node = JSON.stringify(a);
}).catch(() => { $('v-node').textContent = 'bench/result.json not reachable'; });

$('btn-audit').addEventListener('click', () => {
  const t0 = performance.now();
  const rep = audit(scene3, makePoses(NODE_POSES, 11, 1, true));
  const ms = performance.now() - t0;
  const node = JSON.parse($('v-node').dataset.node || 'null');
  const match = node && node.naiveInside === rep.naiveInside && node.naiveBlocked === rep.naiveBlocked &&
    node.oursInside === rep.oursInside && node.oursBlocked === rep.oursBlocked;
  $('v-browser').textContent = `browser: naiveInside=${rep.naiveInside} naiveBlocked=${rep.naiveBlocked} ` +
    `oursInside=${rep.oursInside} oursBlocked=${rep.oursBlocked} clamped=${rep.clamped} (${ms.toFixed(0)} ms) — ` +
    (match ? 'matches node' : 'MISMATCH vs node');
  $('v-browser').className = match ? 'ok' : 'bad';
});