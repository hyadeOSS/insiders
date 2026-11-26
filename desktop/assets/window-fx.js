// hyadeOS window motion: the magic lamp and wobbly windows.
// A window can't bend as a web page, so while an effect plays, its picture (taken by Electron,
// hyadeOSElectron.captureRect) is drawn on a bendable mesh in one WebGL canvas and the live window
// is hidden (opacity 0, which keeps a drag's pointer capture); it comes back the moment the effect ends. The math is in
// window-fx-math.js. Spec: docs/superpowers/specs/2026-11-25-window-motion-design.md
(function () {
  'use strict';
  const M = window.WindowFxMath;
  const CAPTURE_TIMEOUT = 250;
  const LAMP_MS = 620;      // minimize: into the dock
  const RESTORE_MS = 400;   // restore: out of the dock, quicker
  const RESTORE_LAG = 0.15; // restore: rows rise nearly together, pinch and rise at the same time
  const LAMP_GRID = [12, 40], WOBBLE_GRID = [24, 24];

  let canvas = null, gl = null, prog = null, glFailed = false;
  const effects = new Map(); // popup -> effect
  let raf = 0, last = 0;

  // ── WebGL ───────────────────────────────────────────────────────────────────
  const VS = `attribute vec2 a_pos; attribute vec2 a_uv; uniform vec2 u_view; varying vec2 v_uv;
    void main() { v_uv = a_uv; gl_Position = vec4(a_pos.x / u_view.x * 2.0 - 1.0, 1.0 - a_pos.y / u_view.y * 2.0, 0.0, 1.0); }`;
  // Cuts the window's rounded corners out of the picture (it was taken with the desktop behind them).
  const FS = `precision mediump float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_size; uniform float u_radius; uniform float u_alpha;
    void main() {
      vec2 p = v_uv * u_size; vec2 q = abs(p - u_size * 0.5) - (u_size * 0.5 - vec2(u_radius));
      float d = length(max(q, 0.0)) - u_radius;
      float a = u_alpha * (1.0 - smoothstep(-0.75, 0.75, d));
      vec4 c = texture2D(u_tex, v_uv); gl_FragColor = vec4(c.rgb * a, a);
    }`;

  function setupGL() {
    if (gl || glFailed) return !!gl;
    canvas = document.createElement('canvas');
    canvas.id = 'windowFx';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;display:none;z-index:300';
    document.body.appendChild(canvas);
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) { glFailed = true; canvas.remove(); return false; }
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { glFailed = true; gl = null; canvas.remove(); return false; }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); effects.forEach((fx, popup) => finish(popup)); glFailed = true; gl = null; });
    return true;
  }

  // One grid (uv coordinates + triangle indices) per size, made once.
  const grids = new Map();
  function grid(cols, rows) {
    const key = cols + 'x' + rows;
    if (grids.has(key)) return grids.get(key);
    const uv = new Float32Array((cols + 1) * (rows + 1) * 2), idx = new Uint16Array(cols * rows * 6);
    let k = 0, n = 0;
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) { uv[k++] = i / cols; uv[k++] = j / rows; }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.set([a, b, c, b, d, c], n); n += 6;
    }
    const g = { uv: gl.createBuffer(), idx: gl.createBuffer(), pos: gl.createBuffer(), count: idx.length };
    gl.bindBuffer(gl.ARRAY_BUFFER, g.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    grids.set(key, g);
    return g;
  }

  function textureFor(shot) {
    if (shot.texture) return shot.texture;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shot.bitmap);
    shot.texture = t;
    return t;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1, w = innerWidth, h = innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform2f(gl.getUniformLocation(prog, 'u_view'), w, h);
    const aPos = gl.getAttribLocation(prog, 'a_pos'), aUv = gl.getAttribLocation(prog, 'a_uv');
    let z = 0;
    effects.forEach(fx => {
      if (!fx.mesh) return;
      z = Math.max(z, fx.z);
      const g = grid(fx.cols, fx.rows);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pos); gl.bufferData(gl.ARRAY_BUFFER, fx.mesh, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.uv);
      gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.idx);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textureFor(fx.shot));
      gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
      gl.uniform2f(gl.getUniformLocation(prog, 'u_size'), fx.shot.rect.width, fx.shot.rect.height);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_radius'), fx.shot.radius);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_alpha'), fx.alpha);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_SHORT, 0);
    });
    // Same layer as the window it stands in for, so windows above it stay above it.
    canvas.style.zIndex = String(z || 300);
  }

  // The canvas only draws while something moves; idle, it is hidden and no frame is scheduled.
  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    effects.forEach((fx, popup) => { if (fx.update(now, dt) === false) finish(popup); });
    if (!gl) return;
    if (effects.size) { draw(); raf = requestAnimationFrame(tick); }
    else { canvas.style.display = 'none'; last = 0; }
  }
  function run() {
    canvas.style.display = 'block';
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function start(popup, fx) {
    finish(popup);
    fx.z = parseInt(popup.style.zIndex, 10) || 300;
    effects.set(popup, fx);
    run();
  }

  // Ends an effect: the live window shows again unless the effect hides it for good (lamp into the dock).
  function finish(popup) {
    const fx = effects.get(popup);
    if (!fx) return;
    effects.delete(popup);
    if (!fx.keepHidden) popup.style.opacity = '';
    fx.done?.();
  }

  // ── Picture of a window ─────────────────────────────────────────────────────
  const available = () => !!(M && window.hyadeOSElectron?.captureRect && window.createImageBitmap && setupGL());

  async function capture(popup) {
    if (!available()) return null;
    const r = popup.getBoundingClientRect();
    const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
    if (rect.width < 8 || rect.height < 8) return null;
    try {
      const shot = await Promise.race([
        window.hyadeOSElectron.captureRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }),
        new Promise(resolve => setTimeout(() => resolve(null), CAPTURE_TIMEOUT))
      ]);
      if (!shot || !shot.data) return null;
      const bitmap = await createImageBitmap(new Blob([shot.data], { type: 'image/jpeg' }));
      // Electron clamps to the window: keep the area the picture really covers.
      const got = shot.rect ? { left: shot.rect.x, top: shot.rect.y, width: shot.rect.width, height: shot.rect.height } : rect;
      return { bitmap, rect: got, radius: parseFloat(getComputedStyle(popup).borderTopLeftRadius) || 0 };
    } catch (e) { return null; }
  }

  function forget(popup, shot) {
    if (shot?.texture && gl) gl.deleteTexture(shot.texture);
    shot?.bitmap?.close?.();
  }

  // ── Magic lamp ──────────────────────────────────────────────────────────────
  // dir 'in': from the window into the icon (minimize). 'out': from the icon into the window (restore);
  // win is where the window will be. Resolves when the effect is over.
  function lamp(popup, shot, icon, dir, win = shot.rect) {
    return new Promise(resolve => {
      if (!available()) { resolve(false); return; }
      popup.style.opacity = '0';
      const [cols, rows] = LAMP_GRID, begin = performance.now();
      const fx = {
        shot, cols, rows, alpha: 1, mesh: null, keepHidden: dir === 'in',
        done: () => resolve(true),
        update(now) {
          const p = Math.min(1, (now - begin) / (dir === 'in' ? LAMP_MS : RESTORE_MS));
          const t = dir === 'in' ? p : 1 - p;
          fx.mesh = dir === 'in' ? M.lampMesh(win, icon, t, cols, rows) : M.lampMesh(win, icon, t, cols, rows, { lag: RESTORE_LAG, together: true });
          // Fades only right at the icon end.
          fx.alpha = 1 - Math.max(0, (t - 0.85) / 0.15);
          return p < 1;
        }
      };
      fx.update(begin);
      start(popup, fx);
    });
  }

  // ── Wobbly drag ─────────────────────────────────────────────────────────────
  // dragStart takes the picture; until it arrives (≤ 250 ms) the window stays put (isPending), then
  // the mesh takes over from where the pointer is, so the first frame already swings.
  function dragStart(popup, x, y) {
    finish(popup);
    if (!available()) return;
    // While pending it draws nothing; the capture always settles (it times out), replacing update or removing fx.
    const fx = { pending: true, cols: WOBBLE_GRID[0], rows: WOBBLE_GRID[1], alpha: 1, mesh: null, rect: null, pointer: { x, y }, wobble: null, shot: null, update: () => true };
    effects.set(popup, fx); // not drawing yet
    capture(popup).then(shot => {
      if (effects.get(popup) !== fx) { forget(popup, shot); return; }
      if (!shot) { effects.delete(popup); return; }
      const r = popup.getBoundingClientRect();
      fx.shot = shot;
      fx.rect = fx.rect || { left: r.left, top: r.top, width: r.width, height: r.height };
      fx.wobble = M.createWobble(shot.rect, fx.pointer.x, fx.pointer.y);
      fx.pending = false;
      fx.done = () => forget(popup, shot);
      fx.update = (now, dt) => {
        M.stepWobble(fx.wobble, fx.rect, fx.pointer, dt);
        fx.mesh = M.wobbleMesh(fx.wobble, fx.cols, fx.rows);
        return !!fx.pointer || !M.wobbleSettled(fx.wobble, fx.rect);
      };
      popup.style.opacity = '0';
      fx.z = parseInt(popup.style.zIndex, 10) || 300;
      run();
    });
  }
  const isPending = popup => !!effects.get(popup)?.pending;
  function dragMove(popup, rect, x, y) {
    const fx = effects.get(popup);
    if (!fx || !fx.pointer) return;
    fx.rect = rect; fx.pointer = { x, y };
  }
  // Let go: the window settles with a few jiggles. handOver (dropped on a snap zone or tile): at once.
  function dragEnd(popup, handOver) {
    const fx = effects.get(popup);
    if (!fx || !fx.pointer) return;
    if (handOver || fx.pending) { finish(popup); return; }
    fx.pointer = null;
  }

  window.WindowFX = { available, capture, lamp, forget, dragStart, dragMove, dragEnd, isPending, cancel: finish };
})();
