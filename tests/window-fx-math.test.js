// Run: node --test system/tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../desktop/assets/window-fx-math.js");

const WIN = { left: 300, top: 120, width: 800, height: 500 };
const ICON = { left: 640, top: 1030, width: 40, height: 40 };
const vertex = (mesh, cols, i, j) => [mesh[(j * (cols + 1) + i) * 2], mesh[(j * (cols + 1) + i) * 2 + 1]];
const rowWidth = (mesh, cols, j) => vertex(mesh, cols, cols, j)[0] - vertex(mesh, cols, 0, j)[0];

test("lamp-t0-is-window", () => {
  const cols = 4, rows = 6, mesh = M.lampMesh(WIN, ICON, 0, cols, rows);
  assert.equal(mesh.length, (cols + 1) * (rows + 1) * 2);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const [x, y] = vertex(mesh, cols, i, j);
    assert.ok(Math.abs(x - (WIN.left + WIN.width * i / cols)) < 0.01, `x ${i},${j}`);
    assert.ok(Math.abs(y - (WIN.top + WIN.height * j / rows)) < 0.01, `y ${i},${j}`);
  }
});

test("lamp-t1-inside-icon", () => {
  const mesh = M.lampMesh(WIN, ICON, 1, 6, 10);
  for (let k = 0; k < mesh.length; k += 2) {
    assert.ok(mesh[k] >= ICON.left - 1 && mesh[k] <= ICON.left + ICON.width + 1, "x " + mesh[k]);
    assert.ok(mesh[k + 1] >= ICON.top - 1 && mesh[k + 1] <= ICON.top + ICON.height + 1, "y " + mesh[k + 1]);
  }
});

test("lamp-bottom-narrows-first", () => {
  const cols = 4, rows = 10, mesh = M.lampMesh(WIN, ICON, 0.3, cols, rows);
  assert.ok(rowWidth(mesh, cols, rows) < rowWidth(mesh, cols, 0) - 50, "bottom should be clearly narrower");
});

test("lamp-stretches-into-a-funnel", () => {
  // Midway the near (bottom) edge has reached the icon while the far (top) edge is still up high.
  const cols = 4, rows = 10, mesh = M.lampMesh(WIN, ICON, 0.6, cols, rows);
  const topY = vertex(mesh, cols, 0, 0)[1], bottomY = vertex(mesh, cols, 0, rows)[1];
  assert.ok(bottomY > ICON.top - 40, "bottom row nearly at the icon, got " + bottomY);
  assert.ok(bottomY - topY > WIN.height * 0.8, "still stretched tall, got " + (bottomY - topY));
  assert.ok(rowWidth(mesh, cols, 0) > rowWidth(mesh, cols, rows) * 2, "wide at the top, narrow at the icon");
});

test("restore-rises-in-one-piece", () => {
  // The restore plays t from 1 to 0. It keeps the title bar travelling, the bottom following, and never
  // folds the window over itself.
  const cols = 4, rows = 10, opts = { lag: 0.15, together: true };
  const restoreWay = M.lampMesh(WIN, ICON, 0.6, cols, rows, opts);
  assert.ok(vertex(restoreWay, cols, 0, 0)[1] - WIN.top > 20, "restore way: title bar still on its way, got " + vertex(restoreWay, cols, 0, 0)[1]);
  assert.ok(vertex(restoreWay, cols, 0, rows)[1] < ICON.top, "restore way: the bottom has left the icon");
  for (let s = 0; s <= 20; s++) {
    const m = M.lampMesh(WIN, ICON, s / 20, cols, rows, opts);
    for (let j = 1; j <= rows; j++) assert.ok(vertex(m, cols, 0, j)[1] >= vertex(m, cols, 0, j - 1)[1] - 0.01, `folded at t=${s / 20}, row ${j}`);
  }
  assert.ok(vertex(M.lampMesh(WIN, ICON, 1, cols, rows, opts), cols, 0, 0)[1] >= ICON.top - 1, "starts at the icon");
  assert.ok(Math.abs(vertex(M.lampMesh(WIN, ICON, 0, cols, rows, opts), cols, 0, 0)[1] - WIN.top) < 0.01, "ends on the window");
});

test("minimize-never-stalls", () => {
  // From the first tenth to the last, some part of the window moves at least a few pixels every 10%:
  // no long "nothing happens" stretch followed by a jump (what the old timing did).
  const cols = 4, rows = 10;
  let prev = M.lampMesh(WIN, ICON, 0.1, cols, rows);
  for (let s = 2; s <= 9; s++) {
    const m = M.lampMesh(WIN, ICON, s / 10, cols, rows);
    let moved = 0, jump = 0;
    for (let k = 0; k < m.length; k++) { moved = Math.max(moved, Math.abs(m[k] - prev[k])); }
    for (const j of [0, rows]) jump = Math.max(jump, Math.abs(vertex(m, cols, 0, j)[1] - vertex(prev, cols, 0, j)[1]));
    assert.ok(moved > 3, `nothing moved between ${s - 1}0% and ${s}0%`);
    assert.ok(jump < 300, `jump of ${jump.toFixed(0)}px between ${s - 1}0% and ${s}0%`);
    prev = m;
  }
});

test("lamp-works-when-icon-is-above", () => {
  const mesh = M.lampMesh(WIN, { left: 100, top: 10, width: 40, height: 40 }, 1, 4, 4);
  for (let k = 0; k < mesh.length; k++) assert.ok(Number.isFinite(mesh[k]));
});

test("catmull-passes-through-points", () => {
  assert.equal(M.catmullRom(0, 10, 20, 50, 0), 10);
  assert.equal(M.catmullRom(0, 10, 20, 50, 1), 20);
  assert.ok(Math.abs(M.catmullRom(0, 10, 20, 30, 0.5) - 15) < 1e-9, "straight line stays straight");
});

test("wobble-pinned-point-follows-pointer", () => {
  const w = M.createWobble(WIN, WIN.left + 10, WIN.top + 10);
  const moved = { ...WIN, left: WIN.left + 150, top: WIN.top + 60 };
  M.stepWobble(w, moved, { x: WIN.left + 160, y: WIN.top + 70 }, 1 / 60);
  const [x, y] = [w.pos[w.grab * 2], w.pos[w.grab * 2 + 1]];
  assert.ok(Math.abs(x - moved.left) < 0.5 && Math.abs(y - moved.top) < 0.5, `pinned point at ${x},${y}`);
});

test("wobble-far-corner-lags", () => {
  const w = M.createWobble(WIN, WIN.left + 5, WIN.top + 5); // grab near the top-left corner
  const moved = { ...WIN, left: WIN.left + 200 };
  M.stepWobble(w, moved, { x: WIN.left + 205, y: WIN.top + 5 }, 1 / 60);
  const farX = w.pos[15 * 2]; // bottom-right control point
  assert.ok(farX - (WIN.left + WIN.width) < 150, "far corner should not jump the whole way at once");
});

test("wobble-settles", () => {
  const w = M.createWobble(WIN, WIN.left + 400, WIN.top + 20);
  const moved = { ...WIN, left: WIN.left + 300, top: WIN.top + 80 };
  for (let i = 0; i < 10; i++) M.stepWobble(w, moved, { x: moved.left + 400, y: moved.top + 20 }, 1 / 60);
  assert.equal(M.wobbleSettled(w, moved), false, "still moving right after a fast drag");
  for (let i = 0; i < 180; i++) M.stepWobble(w, moved, null, 1 / 60);
  assert.equal(M.wobbleSettled(w, moved), true);
  const cols = 6, rows = 6, mesh = M.wobbleMesh(w, cols, rows);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const [x, y] = vertex(mesh, cols, i, j);
    assert.ok(Math.abs(x - (moved.left + moved.width * i / cols)) < 0.5 && Math.abs(y - (moved.top + moved.height * j / rows)) < 0.5, `mesh ${i},${j}`);
  }
});
