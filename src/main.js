// Kitchen Planner — Step 1: build a scaled 3D room from tape-measure dimensions.
//
// The scene works in metres (1 world unit = 1 m). Everything here is deliberately
// simple and self-contained so later steps — solid blocks for cabinets/appliances,
// selecting/labelling them, importing furniture models — can slot in cleanly.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1e23);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // keep the camera above the floor
controls.minDistance = 1;
controls.maxDistance = 40;

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x555a66, 0.85));

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
scene.add(sun);

// ---------------------------------------------------------------------------
// Room construction
// ---------------------------------------------------------------------------
// Everything for the room lives under one group so rebuilding is a clean swap.
let roomGroup = null;

const materials = {
  floor: new THREE.MeshStandardMaterial({ color: 0xb9a98f, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe7e9ee, roughness: 1.0, side: THREE.DoubleSide }),
};

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
  });
  scene.remove(group);
}

/**
 * Build the room shell from dimensions in metres.
 * @param {number} length  X extent
 * @param {number} width   Z extent
 * @param {number} height  Y extent
 */
function buildRoom(length, width, height) {
  if (roomGroup) disposeGroup(roomGroup);
  roomGroup = new THREE.Group();

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(length, width), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  roomGroup.add(floor);

  // Floor grid (0.5 m squares) for a sense of scale
  const grid = new THREE.GridHelper(
    Math.max(length, width),
    Math.max(length, width) / 0.5,
    0x8a8f99,
    0x40454d
  );
  grid.position.y = 0.002; // avoid z-fighting with the floor
  // Trim the grid to the room footprint by scaling non-uniformly is awkward;
  // a full square grid reads fine and keeps the code simple for now.
  roomGroup.add(grid);

  const t = 0.05; // wall thickness (m)
  const wall = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.wall);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  const hy = height / 2;
  // Back wall (far side, along X). Front is left open so you can see in.
  roomGroup.add(wall(length + t, height, t, 0, hy, -width / 2));
  // Left wall (along Z)
  roomGroup.add(wall(t, height, width, -length / 2, hy, 0));
  // Right wall (along Z)
  roomGroup.add(wall(t, height, width, length / 2, hy, 0));

  scene.add(roomGroup);

  frameRoom(length, width, height);
  updateShadowFrustum(length, width);
}

// Position the camera to look into the open front of the room, framed to fit.
function frameRoom(length, width, height) {
  const target = new THREE.Vector3(0, Math.min(height * 0.4, 0.9), 0);
  controls.target.copy(target);

  const span = Math.max(length, width, height);
  camera.position.set(length * 0.55, height * 0.9 + span * 0.35, width * 0.95 + span * 0.6);
  controls.maxDistance = span * 4;
  controls.update();
}

function updateShadowFrustum(length, width) {
  const r = Math.max(length, width);
  const cam = sun.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const panel = document.getElementById('panel');
const hud = document.getElementById('hud');
const readout = document.getElementById('readout');

const num = (id) => parseFloat(document.getElementById(id).value);

function build() {
  const length = clamp(num('length'), 0.5, 20);
  const width = clamp(num('width'), 0.5, 20);
  const height = clamp(num('height'), 1.8, 4);
  if (!isFinite(length) || !isFinite(width) || !isFinite(height)) return;

  buildRoom(length, width, height);
  readout.textContent = `${length} × ${width} × ${height} m`;
  panel.classList.add('hidden');
  hud.classList.remove('hidden');
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

document.getElementById('build').addEventListener('click', build);
document.getElementById('edit').addEventListener('click', () => {
  panel.classList.remove('hidden');
  hud.classList.add('hidden');
});

// ---------------------------------------------------------------------------
// Resize + render loop
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function tick() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
