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
  let roomGroup = null;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe7e9ee, roughness: 1.0, side: THREE.DoubleSide });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb9a98f, roughness: 0.95 });

  function buildRoom(L, W, H) {
    room = { L, W, H };
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

    const t = 0.05, hy = H / 2;
    const wall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      return m;
    };
    roomGroup.add(wall(L + t, H, t, 0, hy, -W / 2)); // back
    roomGroup.add(wall(t, H, W, -L / 2, hy, 0));      // left
    roomGroup.add(wall(t, H, W, L / 2, hy, 0));       // right
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

  function addItem(typeKey) {
    const T = TYPES[typeKey] || TYPES.other;
    const [w, d, h] = T.size;
    counters[typeKey] = (counters[typeKey] || 0) + 1;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: T.color, roughness: 0.85 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const it = {
      mesh, type: typeKey, fixed: false,
      name: counters[typeKey] > 1 ? `${T.label} ${counters[typeKey]}` : T.label,
      w, d, h, elev: T.elevation, rot: 0,
    };
    mesh.userData.item = it;
    placeMesh(it);
    mesh.position.x = 0;
    mesh.position.z = 0;

    scene.add(mesh);
    items.push(it);
    itemMeshes.push(mesh);
    select(it);
  }

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

  function build() {
    const L = clamp(num('length'), 0.5, 20);
    const W = clamp(num('width'), 0.5, 20);
    const H = clamp(num('height'), 1.8, 4);
    if (![L, W, H].every(isFinite)) return;
    buildRoom(L, W, H);
    if (photoTex) placePhoto();
    $('readout').textContent = `${L} × ${W} × ${H} m`;
    panel.classList.add('hidden');
    hud.classList.remove('hidden');
    toolbar.classList.remove('hidden');
  }
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

  // ---- Resize + render loop ------------------------------------------------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  (function tick() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();
})();
