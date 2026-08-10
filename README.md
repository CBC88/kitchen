# Kitchen Planner

A mobile web app for planning furniture layout in a real kitchen. You give it
tape-measure dimensions, it builds a clean, scaled 3D room out of **solid
geometry** (not messy meshes), and — as later steps land — you'll add labelled
cabinets/appliances, mark them fixed or removable, and drop in furniture models
to see how they fit.

> **Where this is up to:** Step 1 — build a scaled 3D room from length × width ×
> height. This is the foundation the rest is built on.

## View it on your phone

The app is a single static page (no build step). The easiest way to open it on
your phone is **GitHub Pages**:

1. Push this branch to GitHub (already done if Claude set it up for you).
2. On GitHub: **Settings → Pages → Build and deployment**, set **Source =
   Deploy from a branch**, pick this branch and the `/ (root)` folder, **Save**.
3. Wait a minute, then open the URL GitHub gives you on your phone's browser.

To run it on a computer instead, serve the folder over http (it needs http, not
a double-clicked file, because it loads Three.js as modules):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## How to use (Step 1)

- Enter **Length**, **Width** and **Height** in metres and tap **Build room**.
- **Drag** to orbit · **pinch** to zoom · **two-finger drag** to pan.
- Tap **Edit sizes** to change the dimensions and rebuild.

## Design notes

- **1 world unit = 1 metre.** Everything is measured, so the model scales to
  your real kitchen.
- **Solid geometry by construction.** The room and (later) each cabinet/appliance
  is its own solid object — individually selectable and deletable — rather than
  being extracted from a scanned mesh. This is the deliberate choice that keeps
  the model clean and editable, and it's why measurements (not photogrammetry)
  drive the geometry.

## Roadmap

1. ✅ **Room shell** — scaled 3D room from dimensions.
2. **Blocks** — add/move/resize solid boxes; select, label, set fixed vs.
   removable, delete. (A usable planner on its own.)
3. **Save / load** a layout.
4. **Furniture import** — load `.glb`/`.obj` models (the "IKEA" path via file
   import) and place/scale them.
5. *(Optional)* Photo backdrop to trace against.
6. *(Research spike)* Photogrammetry from photos — deliberately last, because
   turning a few phone photos into clean solids is the hard, risky part.

## Tech

- [Three.js](https://threejs.org/) for WebGL 3D (loaded from a CDN via an import
  map — no bundler needed).
- Plain HTML/CSS/JS. Runs in any modern mobile browser.
