// WebXR VR: the same VR match as Cardboard (vr.js), in a real headset or
// any browser that offers an immersive-vr session (Quest, Pico, Vision Pro,
// a PC headset through Chrome or Edge). Where there is no WebXR the
// Cardboard view is used instead.
//
// The game draws its scene with a 2D canvas, and a headset only shows WebGL.
// So each eye is drawn into its own canvas (renderXR in render.js), from
// that eye's place in the world and looking the way it looks, and here that
// picture goes up to the GPU and onto the eye's half of the headset's
// screen. The canvas camera never rolls and covers a little more than the
// eye sees: a small shader maps every pixel of the headset's view (rolled,
// off-centre lenses and all) onto it. The same mapping lets an eye whose
// picture was drawn a frame ago still follow the head this frame, so a
// headset that can't keep up redraws every other frame (as Cardboard does)
// and the view still never lags the head.
//
// Controls: the trigger (or A/X) is the headset button: hold for a power
// shot, let go to hit. The grip pauses (and resumes). B/Y or a thumbstick
// click recentres. Hands-free headsets send a select (a pinch, a tap), which
// works as the trigger. Looking down or up and pressing still pauses and
// recentres, and the pause menu is still turn and press.
(function () {
  const CT = (window.CT = window.CT || {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

  // ---------------- pose maths ----------------
  // WebXR space: x right, y up, looking down -z. Quaternions {x, y, z, w}.
  function rot(q, v) {
    const { x, y, z, w } = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // The camera with no roll that looks along yaw/pitch: its right, up and
  // forward, in WebXR space.
  function basis(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return { R: [cy, 0, sy], U: [-sy * sp, cp, cy * sp], F: [sy * cp, sp, -cy * cp] };
  }

  // Which way an orientation looks, as the head pose vr.js uses: yaw + =
  // turned right, pitch + = looking up, roll + = head tilted left.
  function angles(q) {
    const f = rot(q, [0, 0, -1]), r = rot(q, [1, 0, 0]);
    const yaw = Math.atan2(f[0], -f[2]), pitch = Math.asin(clamp(f[1], -1, 1));
    const b = basis(yaw, pitch);
    return { yaw, pitch, roll: Math.atan2(dot(r, b.U), dot(r, b.R)) };
  }

  // How far a point has moved from where the head was at the last recentre,
  // in metres to the right, forward (down the court) and up. Kept to a
  // small space: lean and step, but not wander off the court.
  const ROOM = 1.2, DUCK = 1.2, RISE = 0.5;
  function courtOffset(p, p0, yaw0) {
    const d = [p.x - p0[0], p.y - p0[1], p.z - p0[2]];
    const fw = [Math.sin(yaw0), 0, -Math.cos(yaw0)], rt = [Math.cos(yaw0), 0, Math.sin(yaw0)];
    return { right: clamp(dot(d, rt), -ROOM, ROOM), fwd: clamp(dot(d, fw), -ROOM, ROOM), up: clamp(d[1], -DUCK, RISE) };
  }

  // The tangents of the widest the eyes see, from their projection
  // matrices (column-major; ndc x = P0 x/d - P8), plus a margin so a
  // rolled head or an eye drawn a frame ago still has picture at the edges.
  const MARGIN = 1.15;
  function reach(views) {
    let tx = 0.5, ty = 0.5;
    for (const v of views) {
      const P = v.projectionMatrix;
      tx = Math.max(tx, Math.abs((1 + P[8]) / P[0]), Math.abs((-1 + P[8]) / P[0]));
      ty = Math.max(ty, Math.abs((1 + P[9]) / P[5]), Math.abs((-1 + P[9]) / P[5]));
    }
    return { tx: Math.min(tx * MARGIN, 3), ty: Math.min(ty * MARGIN, 3) };
  }

  // The canvas each eye is drawn into: EYE_W wide (in the renderer's
  // pixels: line widths and text are sized for a phone's eye of about this
  // width), as tall as the eyes' shape, f pixels per unit of tangent.
  const EYE_W = 600;
  function canvasFit(views) {
    const { tx, ty } = reach(views);
    const w = EYE_W, h = Math.round(EYE_W * ty / tx);
    return { w, h, f: (w / 2) / tx };
  }

  // The shader's matrix for one eye: from the eye's view space (the ray
  // for each of its pixels) to the camera its picture was drawn with
  // (x right, y up, z forward). Column-major for WebGL.
  function warpMatrix(q, drawn) {
    const b = basis(drawn.yaw, drawn.pitch), rows = [b.R, b.U, b.F];
    const cols = [rot(q, [1, 0, 0]), rot(q, [0, 1, 0]), rot(q, [0, 0, 1])];
    const m = new Float32Array(9);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) m[j * 3 + i] = dot(rows[i], cols[j]);
    return m;
  }

  // ---------------- the session ----------------
  const XR = { supported: false, live: false };
  let sess = null;   // { session, gl, layer, space, prog, texs, fit, drawn, opts, select, edges }

  // Ask once at load whether there's a headset to use; calls back when it knows.
  function check(cb) {
    const xr = typeof navigator !== 'undefined' && navigator.xr;
    if (!xr || !xr.isSessionSupported || (typeof isSecureContext !== 'undefined' && !isSecureContext)) return;
    xr.isSessionSupported('immersive-vr').then((ok) => { XR.supported = !!ok; if (cb) cb(XR.supported); }).catch(() => {});
  }

  const VS = 'attribute vec2 a; varying vec2 n; void main() { n = a; gl_Position = vec4(a, 0.0, 1.0); }';
  const FS = [
    'precision highp float;',
    'varying vec2 n;',
    'uniform vec4 lens;',   // the eye's projection: ray = (n.x * lens.x + lens.y, n.y * lens.z + lens.w, -1)
    'uniform mat3 warp;',    // eye view space to the picture's camera
    'uniform vec4 pic;',     // the picture: f/w, cx/w, f/h, cy/h
    'uniform sampler2D tex;',
    'void main() {',
    '  vec3 d = warp * vec3(n.x * lens.x + lens.y, n.y * lens.z + lens.w, -1.0);',
    '  if (d.z <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }',
    '  gl_FragColor = texture2D(tex, vec2(pic.y + pic.x * d.x / d.z, pic.w - pic.z * d.y / d.z));',
    '}',
  ].join('\n');

  function program(gl) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(p);
    const u = (k) => gl.getUniformLocation(p, k);
    return { p, lens: u('lens'), warp: u('warp'), pic: u('pic'), tex: u('tex') };
  }

  function texture(gl) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Start a headset session. Call it straight from a tap or click (the
  // browser only allows it then). opts:
  //   head:  a vr.js head (createHead); its pose is kept up to date here
  //   fit(k): the eye canvas to draw ({ w, h, f }); called when it changes
  //   frame(t, eyes): run the game and draw; returns the eyes' canvases
  //          when it drew new pictures, or null to show the last ones again
  //   end(): the session is over (Exit VR, or the headset's own menu)
  //   blur(on): the headset's own menu is over the game (on) or gone
  // Resolves when the session is running; rejects if it couldn't start.
  function start(opts) {
    if (sess) return Promise.resolve();
    const req = navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    return req.then(async (session) => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: false, antialias: false, depth: false, stencil: false });
        if (!gl) throw new Error('no WebGL');
        if (gl.makeXRCompatible) await gl.makeXRCompatible();
        const layer = new XRWebGLLayer(session, gl, { antialias: false, depth: false, stencil: false, alpha: false });
        session.updateRenderState({ baseLayer: layer, depthNear: 0.1, depthFar: 1000 });
        const space = await session.requestReferenceSpace('local');
        const s = sess = { session, gl, layer, space, prog: program(gl), texs: [], fit: null, drawn: [], opts, select: new Set(), pauseEdge: false, recentreEdge: false, prev: new Map(), anyFrame: false };
        space.addEventListener && space.addEventListener('reset', () => { opts.head.recentreNext = true; });
        session.addEventListener('selectstart', (e) => s.select.add(e.inputSource));
        session.addEventListener('selectend', (e) => s.select.delete(e.inputSource));
        session.addEventListener('squeezestart', () => { s.pauseEdge = true; });
        session.addEventListener('visibilitychange', () => { if (opts.blur) opts.blur(session.visibilityState !== 'visible'); });
        session.addEventListener('end', () => {
          if (sess !== s) return;
          sess = null; XR.live = false;
          try { opts.end(); } catch (e) { /* the page carries on */ }
        });
        XR.live = true;
        session.requestAnimationFrame((t, f) => onFrame(s, t, f));
      } catch (err) {
        sess = null; XR.live = false;
        session.end().catch(() => {});
        throw err;
      }
    });
  }

  function stop() {
    if (!sess) return;
    const s = sess;
    sess = null; XR.live = false;
    s.session.end().catch(() => {});
  }

  function onFrame(s, t, frame) {
    if (sess !== s) return;
    s.session.requestAnimationFrame((t2, f2) => onFrame(s, t2, f2));
    const pose = frame.getViewerPose(s.space);
    if (!pose) return;
    const gl = s.gl, head = s.opts.head, views = pose.views;
    // the head, as vr.js keeps it (recentre and headPose work unchanged)
    const tp = pose.transform.position;
    head.raw = angles(pose.transform.orientation);
    head.rawPos = [tp.x, tp.y, tp.z];
    if (!head.pos0 || head.recentreNext) { head.yaw0 = head.raw.yaw; head.pos0 = head.rawPos; head.recentreNext = false; }

    // the eye canvas: refit when the headset's view changes shape
    const k = canvasFit(views);
    if (!s.fit || s.fit.w !== k.w || s.fit.h !== k.h || Math.abs(s.fit.f - k.f) > 0.5) { s.fit = k; s.opts.fit(k); }

    // each eye: where it is (from the recentred spot) and which way it looks
    const eyes = views.map((v) => {
      const a = angles(v.transform.orientation), pitch = clamp(a.pitch, -1.45, 1.45);
      return { yaw: wrap(a.yaw - head.yaw0), pitch, absYaw: a.yaw, ...courtOffset(v.transform.position, head.pos0, head.yaw0) };
    });
    let pics = null;
    try { pics = s.opts.frame(t, eyes); } catch (e) { console.error(e); }
    if (pics) {
      pics.forEach((cv, i) => {
        if (!s.texs[i]) s.texs[i] = texture(gl);
        gl.bindTexture(gl.TEXTURE_2D, s.texs[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
        s.drawn[i] = { yaw: eyes[i].absYaw, pitch: eyes[i].pitch, fit: s.fit };
      });
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, s.layer.framebuffer);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const P = s.prog;
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(P.tex, 0);
    views.forEach((v, i) => {
      const d = s.drawn[i] || s.drawn[0];
      if (!d) return;
      const vp = s.layer.getViewport(v);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const M = v.projectionMatrix;
      gl.uniform4f(P.lens, 1 / M[0], M[8] / M[0], 1 / M[5], M[9] / M[5]);
      gl.uniformMatrix3fv(P.warp, false, warpMatrix(v.transform.orientation, d));
      const f = d.fit;
      gl.uniform4f(P.pic, f.f / f.w, 0.5, f.f / f.h, 0.5);
      gl.bindTexture(gl.TEXTURE_2D, s.texs[i] || s.texs[0]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  }

  // The controllers this frame: down (the trigger, A/X, or a select held),
  // and whether the grip (pause) or B/Y or a stick click (recentre) was
  // just pressed.
  function buttons() {
    const out = { down: false, pause: false, recentre: false };
    if (!sess) return out;
    const s = sess;
    out.down = s.select.size > 0;
    for (const src of s.session.inputSources || []) {
      const gp = src.gamepad;
      if (!gp) continue;
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      if (b(0) || b(4)) out.down = true;
      const re = b(3) || b(5), was = s.prev.get(src) || false;
      if (re && !was) out.recentre = true;
      s.prev.set(src, re);
    }
    out.pause = s.pauseEdge; s.pauseEdge = false;
    return out;
  }

  // A short buzz in the hands, for your own hits.
  function buzz(strength, ms) {
    if (!sess) return;
    for (const src of sess.session.inputSources || []) {
      const h = src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
      try { if (h && h.pulse) h.pulse(strength, ms); } catch (e) { /* optional */ }
    }
  }

  Object.assign(XR, { check, start, stop, buttons, buzz, angles, courtOffset, canvasFit, warpMatrix, basis, rot });
  CT.XR = XR;
})();
