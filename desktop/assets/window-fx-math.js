// hyadeOS window motion: the math behind the magic lamp and wobbly windows. Pure, no DOM.
// Used by window-fx.js; tests in system/tests/window-fx-math.test.js (node --test system/tests/).
// A Rect is { left, top, width, height } in screen pixels. A mesh is a Float32Array of x,y pairs,
// row by row, (cols + 1) * (rows + 1) vertices covering the window from top-left to bottom-right.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WindowFxMath = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = x => x * x * (3 - 2 * x);
  const easeInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = x => 1 - Math.pow(1 - x, 3);
  const easeInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;
  const LAG = 0.5; // minimize: how much later the far edge of the window follows the near one

  // ── Magic lamp ──────────────────────────────────────────────────────────────
  // Two overlapping phases, like macOS: the sides near the icon pinch in (squeeze) while the rows
  // slide along and into the icon (slide). t = 0 is the window, t = 1 the icon.
  // The minimize starts pinching and sliding almost at once, so something is always moving: the pinch
  // eases out over the first 45%, the slide runs from 6% to the end on one gentle curve.
  // lag: how far apart in time the rows travel (0 = all together).
  // together: the restore, played from t = 1 down to 0 with { lag: small, together: true }: one curve for
  // both phases, fast out of the icon and slowing as it lands (t³ seen from t).
  function lampMesh(win, icon, t, cols, rows, { lag = LAG, together = false } = {}) {
    const out = new Float32Array((cols + 1) * (rows + 1) * 2);
    const restoreCurve = Math.pow(clamp01(t), 3);
    const squeeze = together ? restoreCurve : easeOut(clamp01(t / 0.45));
    const slide = together ? restoreCurve : easeInOutSine(clamp01((t - 0.06) / 0.94));
    const iconBottom = icon.top + icon.height;
    const down = iconBottom >= win.top + win.height / 2; // icon below the window (the usual dock)
    const span = down ? iconBottom - win.top : win.top + win.height - icon.top;
    const winRight = win.left + win.width, iconRight = icon.left + icon.width;
    let k = 0;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      // Rows nearest the icon leave first and the far edge last, so the window stretches into a
      // funnel on its way in instead of just shrinking.
      const lead = down ? 1 - v : v;
      // Each row's share of the slide is not eased a second time: stacked curves made it stall, then jump.
      const rowSlide = clamp01(slide * (1 + lag) - lead * lag);
      const y = lerp(win.top + v * win.height, icon.top + v * icon.height, rowSlide);
      // How far along the way to the icon this row is (0 = far end of the window, 1 = at the icon).
      const along = span > 1 ? clamp01(down ? (y - win.top) / span : (win.top + win.height - y) / span) : v;
      const pinch = squeeze * smooth(along);
      const pull = 1 - (1 - pinch) * (1 - rowSlide * rowSlide); // ends exactly on the icon
      const left = lerp(win.left, icon.left, pull), right = lerp(winRight, iconRight, pull);
      for (let i = 0; i <= cols; i++) {
        out[k++] = lerp(left, right, i / cols);
        out[k++] = y;
      }
    }
    return out;
  }

  // ── Smooth surface through a 4×4 grid of points ─────────────────────────────
  function catmullRom(p0, p1, p2, p3, s) {
    const s2 = s * s, s3 = s2 * s;
    return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3);
  }
  // Value along a 4-point line at u in 0..1, passing through all four points (ends extended straight).
  function along4(a, b, c, d, u) {
    const seg = Math.min(2, Math.floor(u * 3)), s = u * 3 - seg;
    const p = [2 * a - b, a, b, c, d, 2 * d - c];
    return catmullRom(p[seg], p[seg + 1], p[seg + 2], p[seg + 3], s);
  }
  // ctrl: 16 points (x,y), row by row. Returns the surface point at (u, v).
  function surfacePoint(ctrl, u, v) {
    const xs = [0, 0, 0, 0], ys = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      const o = r * 8;
      xs[r] = along4(ctrl[o], ctrl[o + 2], ctrl[o + 4], ctrl[o + 6], u);
      ys[r] = along4(ctrl[o + 1], ctrl[o + 3], ctrl[o + 5], ctrl[o + 7], u);
    }
    return [along4(xs[0], xs[1], xs[2], xs[3], v), along4(ys[0], ys[1], ys[2], ys[3], v)];
  }

  // ── Wobbly window ───────────────────────────────────────────────────────────
  // 16 masses on springs pulling each one to its place in the rigid window. The one nearest the
  // grab point is held by the pointer while dragging; the farther a point, the looser its spring,
  // so far corners lag, swing and overshoot. Neighbour springs keep the sheet in one piece.
  const N = 4;
  const STIFF = 1400, FALLOFF = 1.3, NEIGHBOUR = 360, ZETA = 0.42, MAX_STEP = 1 / 240; // tuned: ~100px bend on a fast fling, settles in ~0.4s

  function restPoint(rect, i) {
    const c = i % N, r = Math.floor(i / N);
    return [rect.left + rect.width * c / (N - 1), rect.top + rect.height * r / (N - 1)];
  }

  function createWobble(rect, grabX, grabY) {
    const pos = new Float32Array(N * N * 2), vel = new Float32Array(N * N * 2), k = new Float32Array(N * N);
    let grab = 0, best = Infinity;
    const diag = Math.hypot(rect.width, rect.height) || 1;
    for (let i = 0; i < N * N; i++) {
      const [x, y] = restPoint(rect, i);
      pos[i * 2] = x; pos[i * 2 + 1] = y;
      const d = Math.hypot(x - grabX, y - grabY);
      if (d < best) { best = d; grab = i; }
    }
    const [gx, gy] = restPoint(rect, grab);
    for (let i = 0; i < N * N; i++) {
      const [x, y] = restPoint(rect, i);
      k[i] = STIFF / (1 + FALLOFF * Math.hypot(x - gx, y - gy) / diag * 2);
    }
    return { pos, vel, k, grab, w: rect.width, h: rect.height };
  }

  function stepOnce(w, rect, held, dt) {
    const { pos, vel, k } = w;
    for (let i = 0; i < N * N; i++) {
      const ix = i * 2, iy = ix + 1;
      const [tx, ty] = restPoint(rect, i);
      if (held && i === w.grab) { pos[ix] = tx; pos[iy] = ty; vel[ix] = vel[iy] = 0; continue; }
      let fx = k[i] * (tx - pos[ix]), fy = k[i] * (ty - pos[iy]);
      const c = i % N, r = Math.floor(i / N);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nc >= N || nr < 0 || nr >= N) continue;
        const n = (nr * N + nc) * 2;
        fx += NEIGHBOUR * ((pos[n] - pos[ix]) - dc * rect.width / (N - 1));
        fy += NEIGHBOUR * ((pos[n + 1] - pos[iy]) - dr * rect.height / (N - 1));
      }
      const damp = 2 * ZETA * Math.sqrt(k[i] + 2 * NEIGHBOUR);
      vel[ix] += (fx - damp * vel[ix]) * dt; vel[iy] += (fy - damp * vel[iy]) * dt;
      pos[ix] += vel[ix] * dt; pos[iy] += vel[iy] * dt;
    }
  }

  // pointer: { x, y } while the window is held, null once it is let go.
  function stepWobble(w, rect, pointer, dt) {
    let left = Math.min(dt, 0.05);
    while (left > 1e-6) { const h = Math.min(MAX_STEP, left); stepOnce(w, rect, !!pointer, h); left -= h; }
    w.w = rect.width; w.h = rect.height;
  }

  function wobbleSettled(w, rect) {
    for (let i = 0; i < N * N; i++) {
      const [tx, ty] = restPoint(rect, i);
      if (Math.abs(w.pos[i * 2] - tx) > 0.3 || Math.abs(w.pos[i * 2 + 1] - ty) > 0.3) return false;
      if (Math.abs(w.vel[i * 2]) > 4 || Math.abs(w.vel[i * 2 + 1]) > 4) return false;
    }
    return true;
  }

  function wobbleMesh(w, cols, rows) {
    const out = new Float32Array((cols + 1) * (rows + 1) * 2);
    let k = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const [x, y] = surfacePoint(w.pos, i / cols, j / rows);
      out[k++] = x; out[k++] = y;
    }
    return out;
  }

  return { lampMesh, catmullRom, surfacePoint, createWobble, stepWobble, wobbleSettled, wobbleMesh, easeInOut };
});
