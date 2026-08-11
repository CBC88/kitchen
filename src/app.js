// Kitchen Planner — Step 2 (+ move mode, snapping, quick-add presets)
//
// Room + solid "items" (cabinets / appliances): add from a preset picker,
// tap to select and change size/type/status, enter an explicit MOVE MODE to
// drag them across the floor (snapping to a grid and flush to walls), rotate,
// and delete. Plus a wall-photo backdrop to trace over. No AI.
//
// Plain-script build using global THREE + THREE.OrbitControls, so the same
// file powers the repo (CDN scripts) and the offline preview (inlined scripts).

(function () {
  'use strict';

  // ---- Item catalogue: defaults per type (metres) -------------------------
  // size = [width(x), depth(z), height(y)]; elevation = bottom above floor.
  const TYPES = {
    base:       { label: 'Base cabinet', color: 0xd8cbb0, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    drawers:    { label: 'Drawers',      color: 0xcdbfa2, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    tallunit:   { label: 'Tall unit',    color: 0xd2c6ac, size: [0.60, 0.60, 2.10], elevation: 0.00 },
    worktop:    { label: 'Worktop',      color: 0x8a8f99, size: [1.20, 0.62, 0.04], elevation: 0.85 },
    wall:       { label: 'Wall cabinet', color: 0xe0d6c0, size: [0.60, 0.35, 0.70], elevation: 1.45 },
    sink:       { label: 'Sink cabinet', color: 0x9fa6b0, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    oven:       { label: 'Oven',         color: 0x3a3f47, size: [0.60, 0.60, 0.60], elevation: 0.00 },
    hob:        { label: 'Hob / cooker', color: 0x2b2f36, size: [0.60, 0.60, 0.90], elevation: 0.00 },
    fridge:     { label: 'Fridge',       color: 0xdfe3ea, size: [0.60, 0.65, 1.80], elevation: 0.00 },
    dishwasher: { label: 'Dishwasher',   color: 0xc9ced6, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    other:      { label: 'Other',        color: 0xb9c0c9, size: [0.60, 0.60, 0.60], elevation: 0.00 },
  };

  const GRID = 0.05;       // 5 cm snap grid
  const WALL_SNAP = 0.18;  // snap flush to a wall within this distance (m)
  const SEL_COLOR = 0x4c9aff, MOVE_COLOR = 0x36d17a;

  // ---- Renderer / scene / camera ------------------------------------------
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1e23);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 0.8;
  controls.maxDistance = 40;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x555a66, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  scene.add(sun);

  // ---- Room ----------------------------------------------------------------
  let room = { L: 3.6, W: 2.8, H: 2.4 };
  let slopeCfg = { on: false, low: 2.0, dir: 'right' };
  let roomGroup = null;
  let roomWalls = [];      // { group, n(normal), p(point) } for camera-facing auto-hide
  let ceilMeshRef = null;
  const WALLT = 0.06; // wall thickness (m)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe7e9ee, roughness: 1.0, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb9a98f, roughness: 0.95 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 1.0, side: THREE.DoubleSide });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide });

  const lerp = (a, b, t) => a + (b - a) * t;

  // Height of the (possibly sloped) ceiling at a plan position.
  function ceilingHeight(x, z) {
    const { L, W, H } = room;
    if (!slopeCfg.on) return H;
    const lo = slopeCfg.low;
    if (slopeCfg.dir === 'left')  return lerp(lo, H, (x + L / 2) / L); // low at x=-L/2
    if (slopeCfg.dir === 'right') return lerp(H, lo, (x + L / 2) / L); // low at x=+L/2
    if (slopeCfg.dir === 'back')  return lerp(lo, H, (z + W / 2) / W); // low at z=-W/2
    if (slopeCfg.dir === 'front') return lerp(H, lo, (z + W / 2) / W); // low at z=+W/2
    return H;
  }

  // Build one wall (as a solid) from plan point A→B, following the ceiling for
  // its top edge, with door openings (notched to the floor) and window openings
  // (rectangular holes + a glass pane). Local shape coords: x = along wall, y = up.
  function makeWall(ax, az, bx, bz, doors, windows) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const topA = ceilingHeight(ax, az), topB = ceilingHeight(bx, bz);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    doors.slice().sort((p, q) => p.u - q.u).forEach((d) => {
      const u0 = clamp(d.u - d.width / 2, 0.03, len - 0.03);
      const u1 = clamp(d.u + d.width / 2, 0.03, len - 0.03);
      if (u1 <= u0) return;
      const tmin = Math.min(lerp(topA, topB, u0 / len), lerp(topA, topB, u1 / len));
      const dh = Math.min(d.height, tmin - 0.05);
      shape.lineTo(u0, 0); shape.lineTo(u0, dh); shape.lineTo(u1, dh); shape.lineTo(u1, 0);
    });
    shape.lineTo(len, 0);
    shape.lineTo(len, topB);
    shape.lineTo(0, topA);
    shape.lineTo(0, 0);

    const panes = [];
    windows.forEach((w) => {
      const u0 = clamp(w.u - w.width / 2, 0.05, len - 0.05);
      const u1 = clamp(w.u + w.width / 2, 0.05, len - 0.05);
      const y0 = Math.max(0.05, w.sill);
      const tmid = lerp(topA, topB, w.u / len);
      const y1 = Math.min(y0 + w.height, tmid - 0.05);
      if (u1 <= u0 || y1 <= y0) return;
      const hole = new THREE.Path();
      hole.moveTo(u0, y0); hole.lineTo(u1, y0); hole.lineTo(u1, y1); hole.lineTo(u0, y1); hole.lineTo(u0, y0);
      shape.holes.push(hole);
      panes.push([(u0 + u1) / 2, (y0 + y1) / 2, u1 - u0, y1 - y0]);
    });

    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALLT, bevelEnabled: false });
    geo.computeVertexNormals();

    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    panes.forEach((p) => {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(p[2], p[3]), glassMat);
      pane.position.set(p[0], p[1], WALLT / 2);
      group.add(pane);
    });
    group.rotation.y = Math.atan2(-dz, dx);
    group.position.set(ax, 0, az);
    return group;
  }

  function buildRoom(cfg) {
    room = { L: cfg.L, W: cfg.W, H: cfg.H };
    slopeCfg = cfg.slope;
    const { L, W, H } = room;

    if (roomGroup) {
      roomGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      scene.remove(roomGroup);
    }
    roomGroup = new THREE.Group();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(L, W), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    roomGroup.add(floor);

    const grid = new THREE.GridHelper(Math.max(L, W), Math.max(2, Math.round(Math.max(L, W) / 0.5)), 0x8a8f99, 0x40454d);
    grid.position.y = 0.002;
    roomGroup.add(grid);

    // Ceiling as a single quad through the four corner heights.
    const corners = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
    const cy = corners.map((c) => ceilingHeight(c[0], c[1]));
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      corners[0][0], cy[0], corners[0][1], corners[1][0], cy[1], corners[1][1], corners[2][0], cy[2], corners[2][1],
      corners[0][0], cy[0], corners[0][1], corners[2][0], cy[2], corners[2][1], corners[3][0], cy[3], corners[3][1],
    ]), 3));
    cg.computeVertexNormals();
    const ceil = new THREE.Mesh(cg, ceilMat);
    ceil.receiveShadow = true;
    roomGroup.add(ceil);

    ceilMeshRef = ceil;

    // Distribute the door/window onto their walls.
    const byWall = { back: { d: [], w: [] }, front: { d: [], w: [] }, left: { d: [], w: [] }, right: { d: [], w: [] } };
    const wallLen = (name) => (name === 'back' || name === 'front' ? L : W);
    if (cfg.door.on && byWall[cfg.door.wall]) {
      byWall[cfg.door.wall].d.push({ u: cfg.door.pos * wallLen(cfg.door.wall), width: cfg.door.width, height: cfg.door.height });
    }
    if (cfg.window.on && byWall[cfg.window.wall]) {
      byWall[cfg.window.wall].w.push({ u: cfg.window.pos * wallLen(cfg.window.wall), width: cfg.window.width, height: cfg.window.height, sill: cfg.window.sill });
    }

    // Four walls (A→B chosen so each wall's thickness sits inside the room).
    roomWalls = [];
    const addWall = (grp, nx, nz, px, pz) => {
      roomWalls.push({ group: grp, n: new THREE.Vector3(nx, 0, nz), p: new THREE.Vector3(px, H / 2, pz) });
      roomGroup.add(grp);
    };
    addWall(makeWall(-L / 2, -W / 2, L / 2, -W / 2, byWall.back.d, byWall.back.w), 0, -1, 0, -W / 2);  // back
    addWall(makeWall(L / 2, W / 2, -L / 2, W / 2, byWall.front.d, byWall.front.w), 0, 1, 0, W / 2);      // front
    addWall(makeWall(-L / 2, W / 2, -L / 2, -W / 2, byWall.left.d, byWall.left.w), -1, 0, -L / 2, 0);    // left
    addWall(makeWall(L / 2, -W / 2, L / 2, W / 2, byWall.right.d, byWall.right.w), 1, 0, L / 2, 0);       // right
    scene.add(roomGroup);

    const r = Math.max(L, W);
    const sc = sun.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.updateProjectionMatrix();

    controls.target.set(0, Math.min(H * 0.4, 0.9), 0);
    const span = Math.max(L, W, H);
    camera.position.set(L * 0.55, H * 0.9 + span * 0.35, W * 0.95 + span * 0.6);
    controls.maxDistance = span * 4;
    controls.update();
  }

  // ---- Items ---------------------------------------------------------------
  const items = [];
  const itemMeshes = [];
  let selected = null;
  let selBox = null;
  const counters = {};

  // Create an item, optionally with explicit size/position/name (used for the
  // pre-model). Does not select — callers decide.
  function createItem(typeKey, opts) {
    opts = opts || {};
    const T = TYPES[typeKey] || TYPES.other;
    const w = opts.w != null ? opts.w : T.size[0];
    const d = opts.d != null ? opts.d : T.size[1];
    const h = opts.h != null ? opts.h : T.size[2];
    const elev = opts.elev != null ? opts.elev : T.elevation;
    counters[typeKey] = (counters[typeKey] || 0) + 1;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: T.color, roughness: 0.85 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const it = {
      mesh, type: typeKey, fixed: !!opts.fixed,
      name: opts.name || (counters[typeKey] > 1 ? `${T.label} ${counters[typeKey]}` : T.label),
      w, d, h, elev, rot: opts.rot || 0,
    };
    mesh.userData.item = it;
    placeMesh(it);
    mesh.position.x = opts.x || 0;
    mesh.position.z = opts.z || 0;

    scene.add(mesh);
    items.push(it);
    itemMeshes.push(mesh);
    return it;
  }

  function addItem(typeKey) { select(createItem(typeKey, {})); }

  function placeMesh(it) {
    it.mesh.geometry.dispose();
    it.mesh.geometry = new THREE.BoxGeometry(it.w, it.h, it.d);
    it.mesh.position.y = it.elev + it.h / 2;
    it.mesh.rotation.y = it.rot * Math.PI / 180;
    if (selected === it && selBox) selBox.update();
  }

  function deleteItem(it) {
    if (selected === it) select(null);
    scene.remove(it.mesh);
    it.mesh.geometry.dispose();
    it.mesh.material.dispose();
    items.splice(items.indexOf(it), 1);
    itemMeshes.splice(itemMeshes.indexOf(it.mesh), 1);
  }

  function select(it) {
    if (moveMode) exitMove(false);
    selected = it;
    if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
    if (it) {
      selBox = new THREE.BoxHelper(it.mesh, SEL_COLOR);
      selBox.material.depthTest = false;
      scene.add(selBox);
      openInspector(it);
    } else {
      closeSheets();
    }
  }

  // Axis-aligned footprint half-extents, accounting for the item's rotation.
  function footprint(it) {
    const a = it.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    return {
      hx: (it.w / 2) * c + (it.d / 2) * s,
      hz: (it.w / 2) * s + (it.d / 2) * c,
    };
  }

  // ---- Move mode -----------------------------------------------------------
  let moveMode = false;
  let snapOn = true;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let dragging = null;
  const grab = new THREE.Vector2();

  function toNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function enterMove() {
    if (!selected) return;
    moveMode = true;
    controls.enabled = false;
    if (selBox) selBox.material.color.setHex(MOVE_COLOR);
    $('moveLabel').textContent = 'Moving ' + selected.name;
    inspector.classList.add('hidden');
    moveBar.classList.remove('hidden');
  }

  function exitMove(reopen) {
    moveMode = false;
    dragging = null;
    controls.enabled = true;
    moveBar.classList.add('hidden');
    if (selBox) selBox.material.color.setHex(SEL_COLOR);
    if (reopen && selected) openInspector(selected);
  }

  function snapPosition(it, rawX, rawZ) {
    const { L, W } = room;
    const { hx, hz } = footprint(it);
    let x = rawX, z = rawZ;
    if (snapOn) {
      x = Math.round(x / GRID) * GRID;
      z = Math.round(z / GRID) * GRID;
      const leftX = -L / 2 + hx, rightX = L / 2 - hx, backZ = -W / 2 + hz, frontZ = W / 2 - hz;
      if (Math.abs(rawX - leftX) < WALL_SNAP) x = leftX;
      else if (Math.abs(rawX - rightX) < WALL_SNAP) x = rightX;
      if (Math.abs(rawZ - backZ) < WALL_SNAP) z = backZ;
      else if (Math.abs(rawZ - frontZ) < WALL_SNAP) z = frontZ;
    }
    x = clamp(x, -L / 2 + hx, L / 2 - hx);
    z = clamp(z, -W / 2 + hz, W / 2 - hz);
    return { x, z };
  }

  // pointerdown (capture phase, so we decide before OrbitControls' handler)
  canvas.addEventListener('pointerdown', (e) => {
    if (moveMode && selected) {
      toNdc(e);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        dragging = selected;
        grab.set(hitPoint.x - selected.mesh.position.x, hitPoint.z - selected.mesh.position.z);
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    // not moving: tap to select / deselect (never drags the camera off an item)
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(itemMeshes, false);
    if (hits.length) select(hits[0].object.userData.item);
    else if (!isSheetOpen()) select(null);
  }, true);

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const p = snapPosition(dragging, hitPoint.x - grab.x, hitPoint.z - grab.z);
      dragging.mesh.position.x = p.x;
      dragging.mesh.position.z = p.z;
      if (selBox) selBox.update();
    }
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = null;
    if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Wall photo backdrop -------------------------------------------------
  let photoMesh = null, photoTex = null, photoWall = 'back', photoOpacity = 0.85;

  function setPhoto(dataUrl) {
    const img = new Image();
    img.onload = () => {
      if (photoTex) photoTex.dispose();
      photoTex = new THREE.Texture(img);
      if ('colorSpace' in photoTex) photoTex.colorSpace = THREE.SRGBColorSpace;
      else photoTex.encoding = THREE.sRGBEncoding;
      photoTex.needsUpdate = true;
      placePhoto();
    };
    img.src = dataUrl;
  }

  function placePhoto() {
    if (!photoTex) return;
    if (photoMesh) { scene.remove(photoMesh); photoMesh.geometry.dispose(); photoMesh.material.dispose(); }
    const { L, W, H } = room, eps = 0.03;
    let planeW = L, pos = [0, H / 2, -W / 2 + eps], rotY = 0;
    if (photoWall === 'left')  { planeW = W; pos = [-L / 2 + eps, H / 2, 0]; rotY = Math.PI / 2; }
    if (photoWall === 'right') { planeW = W; pos = [L / 2 - eps, H / 2, 0];  rotY = -Math.PI / 2; }
    const mat = new THREE.MeshBasicMaterial({
      map: photoTex, transparent: true, opacity: photoOpacity,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    });
    photoMesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, H), mat);
    photoMesh.position.set(pos[0], pos[1], pos[2]);
    photoMesh.rotation.y = rotY;
    photoMesh.renderOrder = 1;
    scene.add(photoMesh);
  }

  function removePhoto() {
    if (photoMesh) { scene.remove(photoMesh); photoMesh.geometry.dispose(); photoMesh.material.dispose(); photoMesh = null; }
    if (photoTex) { photoTex.dispose(); photoTex = null; }
  }

  // ---- UI wiring -----------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (id) => parseFloat($(id).value);

  const panel = $('panel'), hud = $('hud'), toolbar = $('toolbar');
  const inspector = $('inspector'), photoPanel = $('photoPanel');
  const addSheet = $('addSheet'), moveBar = $('moveBar');

  function readSeg(id) { const b = $(id).querySelector('button.on'); return b ? b.dataset.v : null; }

  function build() {
    const L = clamp(num('length'), 0.5, 20);
    const W = clamp(num('width'), 0.5, 20);
    const H = clamp(num('height'), 1.8, 4);
    if (![L, W, H].every(isFinite)) return;
    const cfg = {
      L, W, H,
      slope: { on: $('slopeOn').checked, low: clamp(num('slopeLow'), 1.2, H), dir: readSeg('slopeDir') || 'right' },
      door: {
        on: $('doorOn').checked, wall: readSeg('doorWall') || 'left',
        width: clamp(num('doorW'), 40, 200) / 100, height: clamp(num('doorH'), 100, 260) / 100,
        pos: (parseFloat($('doorPos').value) || 50) / 100,
      },
      window: {
        on: $('winOn').checked, wall: readSeg('winWall') || 'right',
        width: clamp(num('winW'), 30, 300) / 100, height: clamp(num('winH'), 20, 220) / 100,
        sill: clamp(num('winSill'), 0, 200) / 100, pos: (parseFloat($('winPos').value) || 50) / 100,
      },
    };
    buildRoom(cfg);
    if (photoTex) placePhoto();
    $('readout').textContent = `${L} × ${W} m` + (cfg.slope.on ? ' · sloped' : '');
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    toolbar.classList.remove('hidden');
  }

  // Panel toggles + single-select segmented groups
  [['slopeOn', 'slopeOpts'], ['doorOn', 'doorOpts'], ['winOn', 'winOpts']].forEach(([cb, opts]) => {
    const update = () => $(opts).classList.toggle('hidden', !$(cb).checked);
    $(cb).addEventListener('change', update);
    update();
  });
  ['slopeDir', 'doorWall', 'winWall'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (b) setSeg(id, b.dataset.v);
    });
  });
  $('build').addEventListener('click', build);
  $('edit').addEventListener('click', () => {
    if (moveMode) exitMove(false);
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
    toolbar.classList.add('hidden');
    closeSheets();
    select(null);
  });

  // Type <select> in the inspector
  const typeSel = $('insType');
  Object.keys(TYPES).forEach((k) => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = TYPES[k].label;
    typeSel.appendChild(opt);
  });

  // Add-item picker chips
  const addChips = $('addChips');
  Object.keys(TYPES).forEach((k) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<span class="sw" style="background:#${TYPES[k].color.toString(16).padStart(6, '0')}"></span>${TYPES[k].label}`;
    b.addEventListener('click', () => { addSheet.classList.add('hidden'); addItem(k); });
    addChips.appendChild(b);
  });

  // Toolbar
  $('addBtn').addEventListener('click', () => {
    if (moveMode) exitMove(false);
    select(null);
    photoPanel.classList.add('hidden');
    addSheet.classList.remove('hidden');
  });
  $('addClose').addEventListener('click', () => addSheet.classList.add('hidden'));
  $('photoBtn').addEventListener('click', () => {
    if (moveMode) exitMove(false);
    select(null);
    addSheet.classList.add('hidden');
    syncPhotoPanel();
    photoPanel.classList.remove('hidden');
  });

  // Inspector
  function openInspector(it) {
    photoPanel.classList.add('hidden');
    addSheet.classList.add('hidden');
    $('insTitle').textContent = TYPES[it.type] ? TYPES[it.type].label : 'Item';
    $('insName').value = it.name;
    typeSel.value = it.type;
    $('insW').value = Math.round(it.w * 100);
    $('insD').value = Math.round(it.d * 100);
    $('insH').value = Math.round(it.h * 100);
    $('insElev').value = Math.round(it.elev * 100);
    $('insRot').value = it.rot;
    setSeg('insFixed', it.fixed ? 'fixed' : 'removable');
    inspector.classList.remove('hidden');
  }

  $('insMove').addEventListener('click', enterMove);
  $('moveDone').addEventListener('click', () => exitMove(true));
  $('snapSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    snapOn = b.dataset.v === 'on'; setSeg('snapSeg', b.dataset.v);
  });

  $('insClose').addEventListener('click', () => select(null));
  $('insName').addEventListener('input', (e) => { if (selected) selected.name = e.target.value; });
  typeSel.addEventListener('change', (e) => {
    if (!selected) return;
    const k = e.target.value, T = TYPES[k];
    selected.type = k;
    selected.mesh.material.color.setHex(T.color);
    selected.w = T.size[0]; selected.d = T.size[1]; selected.h = T.size[2]; selected.elev = T.elevation;
    placeMesh(selected);
    openInspector(selected);
  });

  const sizeHandler = () => {
    if (!selected) return;
    selected.w = clamp(num('insW'), 5, 600) / 100;
    selected.d = clamp(num('insD'), 5, 600) / 100;
    selected.h = clamp(num('insH'), 1, 300) / 100;
    selected.elev = clamp(num('insElev'), 0, 250) / 100;
    placeMesh(selected);
  };
  ['insW', 'insD', 'insH', 'insElev'].forEach((id) => $(id).addEventListener('input', sizeHandler));
  $('insRot').addEventListener('input', (e) => {
    if (!selected) return;
    selected.rot = parseInt(e.target.value, 10) || 0;
    placeMesh(selected);
  });
  $('insDelete').addEventListener('click', () => {
    if (!selected) return;
    if (selected.fixed && !window.confirm('This item is marked Fixed. Delete it anyway?')) return;
    deleteItem(selected);
  });

  function setSeg(groupId, value) {
    $(groupId).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  }
  $('insFixed').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !selected) return;
    selected.fixed = b.dataset.v === 'fixed';
    setSeg('insFixed', b.dataset.v);
  });

  // Photo panel
  function syncPhotoPanel() { setSeg('photoWall', photoWall); $('photoOpacity').value = photoOpacity; }
  $('photoClose').addEventListener('click', () => photoPanel.classList.add('hidden'));
  $('photoChoose').addEventListener('click', () => $('photoFile').click());
  $('photoFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  $('photoWall').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    photoWall = b.dataset.v; setSeg('photoWall', photoWall); placePhoto();
  });
  $('photoOpacity').addEventListener('input', (e) => {
    photoOpacity = parseFloat(e.target.value);
    if (photoMesh) photoMesh.material.opacity = photoOpacity;
  });
  $('photoRemove').addEventListener('click', () => { removePhoto(); photoPanel.classList.add('hidden'); });

  function isSheetOpen() {
    return !inspector.classList.contains('hidden') ||
           !photoPanel.classList.contains('hidden') ||
           !addSheet.classList.contains('hidden');
  }
  function closeSheets() {
    inspector.classList.add('hidden');
    photoPanel.classList.add('hidden');
    addSheet.classList.add('hidden');
  }

  // ---- Pre-model: this attic galley kitchen --------------------------------
  // A starting point built from the photos. Dimensions are estimates (only the
  // 2.405 m height is measured) — everything is editable via Edit room / tapping
  // items. The appliance run sits on the back wall; the front wall (your IKEA
  // shelf wall) is left blank for new furniture.
  function premodel() {
    // Reflect the room params in the panel so Edit room shows/edits them.
    $('length').value = 3.0; $('width').value = 1.8; $('height').value = 2.405;
    $('slopeOn').checked = true; $('slopeLow').value = 1.4; setSeg('slopeDir', 'front');
    $('doorOn').checked = true; setSeg('doorWall', 'right'); $('doorW').value = 80; $('doorH').value = 200; $('doorPos').value = 50;
    $('winOn').checked = true; setSeg('winWall', 'left'); $('winW').value = 110; $('winH').value = 130; $('winSill').value = 90; $('winPos').value = 55;
    ['slopeOpts', 'doorOpts', 'winOpts'].forEach((id) => $(id).classList.remove('hidden'));

    build(); // reads the panel → builds the room, hides panel, shows HUD/toolbar

    const zBase = -room.W / 2 + WALLT + 0.30;  // base cabinets (60 deep) on back wall
    const zFridge = -room.W / 2 + WALLT + 0.325; // fridge (65 deep)
    const zTop = -room.W / 2 + WALLT + 0.31;   // worktop
    const zWall = -room.W / 2 + WALLT + 0.175; // wall cabinets (35 deep)

    // Appliance run, window end → door end.
    createItem('sink',       { x: -1.2, z: zBase,   fixed: true, name: 'Sink' });
    createItem('dishwasher', { x: -0.6, z: zBase,   fixed: true, name: 'Dishwasher' });
    createItem('oven',       { x:  0.0, z: zBase,   fixed: true, name: 'Oven + hob' });
    createItem('drawers',    { x:  0.6, z: zBase,   fixed: true, name: 'Drawers' });
    createItem('fridge',     { x:  1.2, z: zFridge, fixed: true, name: 'Fridge' });
    // Worktop across the base units (not the fridge).
    createItem('worktop',    { x: -0.3, z: zTop, w: 2.4, fixed: true, name: 'Worktop' });
    // A few wall cabinets above.
    createItem('wall', { x: -0.9, z: zWall, elev: 1.45, fixed: true, name: 'Wall cabinet' });
    createItem('wall', { x: -0.3, z: zWall, elev: 1.45, fixed: true, name: 'Wall cabinet 2' });
    createItem('wall', { x:  0.6, z: zWall, elev: 1.45, fixed: true, name: 'Wall cabinet 3' });
  }

  // ---- Resize + render loop ------------------------------------------------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  premodel(); // build the kitchen on load

  // Hide any wall (and the ceiling) sitting between the camera and the room,
  // so you can always see inside as you orbit — works with touch and mouse.
  function updateCutaway() {
    const c = camera.position;
    for (const w of roomWalls) {
      const d = w.n.x * (c.x - w.p.x) + w.n.z * (c.z - w.p.z);
      w.group.visible = d < 0.05;
    }
    if (ceilMeshRef) ceilMeshRef.visible = c.y < room.H + 0.15;
  }

  (function tick() {
    controls.update();
    updateCutaway();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();
})();
