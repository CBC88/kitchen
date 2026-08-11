# Kitchen Planner

A mobile web app for planning furniture layout in a real kitchen. You give it
tape-measure dimensions, it builds a clean, scaled 3D room out of **solid
geometry** (not messy meshes), and — as later steps land — you'll add labelled
cabinets/appliances, mark them fixed or removable, and drop in furniture models
to see how they fit.

> **Where this is up to:** the app **opens pre-modelled as an attic galley
> kitchen** — the appliance run (sink · dishwasher · oven+hob · drawers · fridge)
> on one long wall, wall cabinets above, a sloped ceiling, and a window + door on
> the short walls; the opposite long wall (the IKEA-shelf wall) is left **blank**
> for planning new furniture. All of it is **parametric** (Edit room, tap any
> item). Four walls with **auto-hide** (the wall between you and the room fades as
> you orbit) so you can see both runs — works with **touch and mouse** (phone and
> desktop). Plus grid/wall snapping and a wall-photo trace backdrop.
>
> The dimensions are **estimates** — only the 2.405 m height is measured. Use a
> tape and correct Length/Width and the slope's low-end height in **Edit room**.

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

## How to use

1. Set up the room → **Build room**. As well as **Length / Width / Height**, you
   can turn on a **sloped ceiling** (give the low-end height and which way it
   slopes down) and add a **door** and a **window** — each on the Back, Left, or
   Right wall, with its own size and position (the front is left open so you can
   see in). Drag to orbit · pinch to zoom · two-finger drag to pan.
2. Tap **＋ Add item** and pick from the presets (base/sink/wall cabinet, oven,
   hob, **fridge**, **dishwasher**, worktop, tall unit…). It drops into the
   middle of the room.
3. **Tap an item** to select it. The panel lets you change its **name**, **type**,
   **fixed/removable**, **size** (cm), **height off floor**, **rotation**, or
   **delete** it.
4. To reposition, tap **✥ Move** — you're now in *move mode*: drag the item across
   the floor and it **snaps to a 5 cm grid and flush to the walls** (toggle
   **Snap/Free** in the bar). Tap **Done** when it's in place.
5. Tap **🖼 Wall photo** → **Choose a photo** of one wall, pick which wall it's
   on, set opacity, then trace by moving items over it.
6. Tap **Edit sizes** to change the room and rebuild.

### Tracing from a photo — what it can and can't do

A single wall photo is a flat **front view**: it gives you widths and heights,
but **not depth** (use standard sizes — base units are ~60 cm deep — or your tape
measure). Take the photo **straight-on**; the app doesn't correct perspective.
Knowing automatically that "this is an oven" would need AI and isn't part of this
step — here, *you* read the photo and place the boxes.

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
2. ✅ **Items** — add/move/resize/rotate solid boxes; select, name, type, set
   fixed vs. removable, delete. **+ wall-photo backdrop** to trace against.
3. **Save / load** a layout (so your work survives a refresh).
4. **Furniture import** — load `.glb`/`.obj` models (the "IKEA" path via file
   import) and place/scale them.
5. *(Optional, later)* Smarter photo help — perspective correction, or
   classic-CV rectangle suggestions.
6. *(Research spike)* Full photogrammetry / AI object recognition — deliberately
   last, because turning a few phone photos into clean, labelled solids is the
   hard, risky part.

## Tech

- [Three.js](https://threejs.org/) for WebGL 3D (loaded from a CDN via an import
  map — no bundler needed).
- Plain HTML/CSS/JS. Runs in any modern mobile browser.
