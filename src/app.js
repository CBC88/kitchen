// Kitchen Planner — Step 2
// Room + solid "items" (cabinets / appliances) you can add, select, label,
// mark fixed/removable, resize, rotate, drag across the floor, and delete —
// plus a wall-photo backdrop you can trace over. No AI: you interpret the
// photo, the app just shows it in the room at the right scale.
//
// Plain-script build using the global THREE + THREE.OrbitControls. The same
// file powers the repo (CDN scripts) and the offline preview (inlined scripts).

(function () {
  'use strict';

  // ---- Item catalogue: sensible defaults per type (sizes in metres) --------
  // size = [width(x), depth(z), height(y)]; elevation = bottom above floor.
  const TYPES = {
    base:       { label: 'Base cabinet', color: 0xd8cbb0, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    drawers:    { label: 'Drawers',      color: 0xcdbfa2, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    wall:       { label: 'Wall cabinet', color: 0xe0d6c0, size: [0.60, 0.35, 0.70], elevation: 1.45 },
    worktop:    { label: 'Worktop',      color: 0x8a8f99, size: [1.20, 0.62, 0.04], elevation: 0.85 },
    tallunit:   { label: 'Tall unit',    color: 0xd2c6ac, size: [0.60, 0.60, 2.10], elevation: 0.00 },
    oven:       { label: 'Oven',         color: 0x3a3f47, size: [0.60, 0.60, 0.60], elevation: 0.00 },
    hob:        { label: 'Hob / cooker', color: 0x2b2f36, size: [0.60, 0.60, 0.90], elevation: 0.00 },
    fridge:     { label: 'Fridge',       color: 0xdfe3ea, size: [0.60, 0.65, 1.80], elevation: 0.00 },
    sink:       { label: 'Sink unit',    color: 0x9fa6b0, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    dishwasher: { label: 'Dishwasher',   color: 0xc9ced6, size: [0.60, 0.60, 0.85], elevation: 0.00 },
    other:      { label: 'Other',        color: 0xb9c0c9, size: [0.60, 0.60, 0.60], elevation: 0.00 },
  };

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

    // shadow frustum + camera framing
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
  const items = [];          // { mesh, name, type, fixed, w, d, h, elev, rot }
  const itemMeshes = [];     // for raycasting
  let selected = null;
  let selBox = null;         // BoxHelper outline
  const counters = {};       // per-type name counters

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
    // start near the middle of the room
    it.mesh.position.x = 0;
    it.mesh.position.z = 0;

    scene.add(mesh);
    items.push(it);
    itemMeshes.push(mesh);
    select(it);
  }

  // Rebuild geometry + reposition after any size/elevation/rotation change.
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
    selected = it;
    if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
    if (it) {
      selBox = new THREE.BoxHelper(it.mesh, 0x4c9aff);
      selBox.material.depthTest = false;
      scene.add(selBox);
      openInspector(it);
    } else {
      closeSheets();
    }
  }

  // ---- Pointer: select + drag across the floor -----------------------------
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

  // Capture phase so we can decide before OrbitControls' own handler runs.
  canvas.addEventListener('pointerdown', (e) => {
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(itemMeshes, false);
    if (hits.length) {
      const it = hits[0].object.userData.item;
      select(it);
      // begin drag on the floor plane
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        dragging = it;
        grab.set(hitPoint.x - it.mesh.position.x, hitPoint.z - it.mesh.position.z);
        controls.enabled = false; // stop OrbitControls from also rotating
        canvas.setPointerCapture(e.pointerId);
      }
    } else if (!isSheetOpen()) {
      select(null); // tap empty space to deselect (only when no sheet is open)
    }
  }, true);

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    toNdc(e);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      const halfX = room.L / 2 - dragging.w / 2;
      const halfZ = room.W / 2 - dragging.d / 2;
      dragging.mesh.position.x = clamp(hitPoint.x - grab.x, -halfX, halfX);
      dragging.mesh.position.z = clamp(hitPoint.z - grab.z, -halfZ, halfZ);
      if (selBox) selBox.update();
    }
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = null;
    controls.enabled = true;
    if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Wall photo backdrop -------------------------------------------------
  let photoMesh = null;
  let photoTex = null;
  let photoWall = 'back';
  let photoOpacity = 0.85;

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

    const { L, W, H } = room;
    const eps = 0.03;
    let planeW, geoM, pos, rotY = 0;
    if (photoWall === 'back')  { planeW = L; pos = [0, H / 2, -W / 2 + eps]; rotY = 0; }
    if (photoWall === 'left')  { planeW = W; pos = [-L / 2 + eps, H / 2, 0]; rotY = Math.PI / 2; }
    if (photoWall === 'right') { planeW = W; pos = [L / 2 - eps, H / 2, 0];  rotY = -Math.PI / 2; }

    geoM = new THREE.PlaneGeometry(planeW, H);
    const mat = new THREE.MeshBasicMaterial({
      map: photoTex, transparent: true, opacity: photoOpacity,
      side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    });
    photoMesh = new THREE.Mesh(geoM, mat);
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

  // Setup / build
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
    panel.classList.remove('hidden');
    hud.classList.add('hidden');
    toolbar.classList.add('hidden');
    closeSheets();
    select(null);
  });

  // Populate the type <select> once
  const typeSel = $('insType');
  Object.keys(TYPES).forEach((k) => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = TYPES[k].label;
    typeSel.appendChild(opt);
  });

  // Toolbar
  $('addBtn').addEventListener('click', () => addItem('base'));
  $('photoBtn').addEventListener('click', () => {
    select(null);
    inspector.classList.add('hidden');
    syncPhotoPanel();
    photoPanel.classList.remove('hidden');
  });

  // Inspector
  function openInspector(it) {
    photoPanel.classList.add('hidden');
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

  $('insClose').addEventListener('click', () => select(null));
  $('insName').addEventListener('input', (e) => { if (selected) selected.name = e.target.value; });
  typeSel.addEventListener('change', (e) => {
    if (!selected) return;
    const k = e.target.value;
    const T = TYPES[k];
    selected.type = k;
    selected.mesh.material.color.setHex(T.color);
    // adopt the type's typical size + elevation as a starting point
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

  // Segmented controls (fixed/removable, photo wall)
  function setSeg(groupId, value) {
    $(groupId).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  }
  $('insFixed').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !selected) return;
    selected.fixed = b.dataset.v === 'fixed';
    setSeg('insFixed', b.dataset.v);
  });

  // Photo panel
  function syncPhotoPanel() {
    setSeg('photoWall', photoWall);
    $('photoOpacity').value = photoOpacity;
  }
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

  // Sheet helpers
  function isSheetOpen() { return !inspector.classList.contains('hidden') || !photoPanel.classList.contains('hidden'); }
  function closeSheets() { inspector.classList.add('hidden'); photoPanel.classList.add('hidden'); }

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
