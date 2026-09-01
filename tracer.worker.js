/* aleks-pt worker — unidirectional path tracer, NEE on Lambert only */

const EPS = 1e-4;
const MAX_DEPTH = 6;
const RR_DEPTH = 3;

let W = 160;
let H = 120;
let accum = null;
let sppPass = 0;
let scanY = 0;
let totalPaths = 0;
let totalRays = 0;

const state = {
  left: "glass",
  right: "metal",
  eta: 1.5,
  fuzz: 0.04,
  theta: 0.08,
  phi: 0.0,
  radius: 3.45,
};

function resetBuf() {
  accum = new Float32Array(W * H * 3);
  sppPass = 0;
  scanY = 0;
}

function v(x, y, z) {
  return { x, y, z };
}
function add(a, b) {
  return v(a.x + b.x, a.y + b.y, a.z + b.z);
}
function sub(a, b) {
  return v(a.x - b.x, a.y - b.y, a.z - b.z);
}
function mul(a, s) {
  return v(a.x * s, a.y * s, a.z * s);
}
function cmul(a, b) {
  return v(a.x * b.x, a.y * b.y, a.z * b.z);
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function len(a) {
  return Math.sqrt(dot(a, a));
}
function nrm(a) {
  const l = len(a) || 1;
  return mul(a, 1 / l);
}
function cross(a, b) {
  return v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function camera() {
  const look = v(0, 1.0, 0);
  const orig = add(
    look,
    v(
      state.radius * Math.cos(state.theta) * Math.sin(state.phi),
      state.radius * Math.sin(state.theta),
      state.radius * Math.cos(state.theta) * Math.cos(state.phi)
    )
  );
  const fwd = nrm(sub(look, orig));
  let right = cross(fwd, v(0, 1, 0));
  if (len(right) < 1e-6) right = v(1, 0, 0);
  right = nrm(right);
  const up = nrm(cross(right, fwd));
  return { orig, fwd, right, up, fov: 38 };
}

const LIGHT = {
  min: v(-0.28, 1.999, -0.28),
  max: v(0.28, 1.999, 0.28),
  n: v(0, -1, 0),
  emit: v(18, 17.4, 16.2),
};
const LIGHT_AREA = 0.56 * 0.56;

function matFor(kind) {
  if (kind === "glass") return { t: "glass", eta: state.eta };
  if (kind === "metal") return { t: "metal", albedo: v(0.95, 0.93, 0.88), fuzz: state.fuzz };
  return { t: "lambert", albedo: v(0.75, 0.75, 0.72) };
}

function hitSphere(ro, rd, c, r, tmin, tmax) {
  const oc = sub(ro, c);
  const a = dot(rd, rd);
  const b = 2 * dot(oc, rd);
  const cc = dot(oc, oc) - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < tmin || t > tmax) t = (-b + sq) / (2 * a);
  if (t < tmin || t > tmax) return null;
  const p = add(ro, mul(rd, t));
  const n = nrm(sub(p, c));
  return { t, p, n };
}

function hitPlane(ro, rd, p0, n, umin, umax, vmin, vmax, uaxis, vaxis, tmin, tmax) {
  const denom = dot(rd, n);
  if (Math.abs(denom) < 1e-8) return null;
  const t = dot(sub(p0, ro), n) / denom;
  if (t < tmin || t > tmax) return null;
  const p = add(ro, mul(rd, t));
  const u = uaxis === "x" ? p.x : uaxis === "y" ? p.y : p.z;
  const vv = vaxis === "x" ? p.x : vaxis === "y" ? p.y : p.z;
  if (u < umin || u > umax || vv < vmin || vv > vmax) return null;
  return { t, p, n: nrm(n) };
}

function intersect(ro, rd) {
  let tmin = EPS;
  let tmax = 1e6;
  let hit = null;

  const walls = [
    { p: v(-1, 0, 0), n: v(1, 0, 0), u: "y", v: "z", umin: 0, umax: 2, vmin: -1, vmax: 1, m: { t: "lambert", albedo: v(0.75, 0.07, 0.07) } },
    { p: v(1, 0, 0), n: v(-1, 0, 0), u: "y", v: "z", umin: 0, umax: 2, vmin: -1, vmax: 1, m: { t: "lambert", albedo: v(0.09, 0.48, 0.12) } },
    { p: v(0, 0, 0), n: v(0, 1, 0), u: "x", v: "z", umin: -1, umax: 1, vmin: -1, vmax: 1, m: { t: "lambert", albedo: v(0.73, 0.73, 0.73) } },
    { p: v(0, 2, 0), n: v(0, -1, 0), u: "x", v: "z", umin: -1, umax: 1, vmin: -1, vmax: 1, m: { t: "lambert", albedo: v(0.73, 0.73, 0.73) } },
    { p: v(0, 0, -1), n: v(0, 0, 1), u: "x", v: "y", umin: -1, umax: 1, vmin: 0, vmax: 2, m: { t: "lambert", albedo: v(0.73, 0.73, 0.73) } },
  ];

  for (const w of walls) {
    const h = hitPlane(ro, rd, w.p, w.n, w.umin, w.umax, w.vmin, w.vmax, w.u, w.v, tmin, tmax);
    if (h) {
      tmax = h.t;
      hit = { ...h, m: w.m, light: false };
    }
  }

  const lh = hitPlane(ro, rd, v(0, 1.999, 0), LIGHT.n, LIGHT.min.x, LIGHT.max.x, LIGHT.min.z, LIGHT.max.z, "x", "z", tmin, tmax);
  if (lh) {
    tmax = lh.t;
    hit = { ...lh, m: { t: "light", emit: LIGHT.emit }, light: true };
  }

  const s1 = hitSphere(ro, rd, v(-0.42, 0.4, 0.12), 0.4, tmin, tmax);
  if (s1) {
    tmax = s1.t;
    hit = { ...s1, m: matFor(state.left), light: false };
  }
  const s2 = hitSphere(ro, rd, v(0.46, 0.32, -0.18), 0.32, tmin, tmax);
  if (s2) {
    hit = { ...s2, m: matFor(state.right), light: false };
  }
  return hit;
}

function randomOnLight() {
  return v(
    LIGHT.min.x + Math.random() * (LIGHT.max.x - LIGHT.min.x),
    1.999,
    LIGHT.min.z + Math.random() * (LIGHT.max.z - LIGHT.min.z)
  );
}

function ortho(n) {
  const a = Math.abs(n.x) > 0.1 ? v(0, 1, 0) : v(1, 0, 0);
  const t = nrm(cross(n, a));
  const b = cross(n, t);
  return { t, b };
}

function cosineHemisphere(n) {
  const r1 = Math.random();
  const r2 = Math.random();
  const phi = 2 * Math.PI * r1;
  const su = Math.sqrt(r2);
  const x = Math.cos(phi) * su;
  const y = Math.sin(phi) * su;
  const z = Math.sqrt(Math.max(0, 1 - r2));
  const o = ortho(n);
  return nrm(add(add(mul(o.t, x), mul(o.b, y)), mul(n, z)));
}

function unitSphere() {
  for (;;) {
    const p = v(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (dot(p, p) < 1) return nrm(p);
  }
}

function reflect(i, n) {
  return sub(i, mul(n, 2 * dot(i, n)));
}

function refract(uv, n, etaiOverEtat) {
  const cos = Math.min(dot(mul(uv, -1), n), 1);
  const rOutPerp = mul(add(uv, mul(n, cos)), etaiOverEtat);
  const k = 1 - dot(rOutPerp, rOutPerp);
  if (k < 0) return null;
  const rOutPar = mul(n, -Math.sqrt(k));
  return add(rOutPerp, rOutPar);
}

function schlick(cos, r0) {
  const m = 1 - cos;
  return r0 + (1 - r0) * m * m * m * m * m;
}

function sampleLight(p, n) {
  const lp = randomOnLight();
  const toL = sub(lp, p);
  const dist2 = dot(toL, toL);
  const dist = Math.sqrt(dist2);
  const dir = mul(toL, 1 / dist);
  const cosS = dot(n, dir);
  const cosL = dot(LIGHT.n, mul(dir, -1));
  if (cosS <= 0 || cosL <= 0) return v(0, 0, 0);
  const sh = intersect(add(p, mul(n, EPS)), dir);
  if (!sh || !sh.light) return v(0, 0, 0);
  const pdf = dist2 / (cosL * LIGHT_AREA);
  const brdf = 1 / Math.PI;
  return mul(LIGHT.emit, (brdf * cosS) / pdf);
}

function trace(ro, rd) {
  let col = v(0, 0, 0);
  let thru = v(1, 1, 1);
  let specular = true;
  totalPaths++;

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    totalRays++;
    const h = intersect(ro, rd);
    if (!h) break;

    const front = dot(rd, h.n) < 0;
    const n = front ? h.n : mul(h.n, -1);

    if (h.light) {
      if (specular) col = add(col, cmul(thru, h.m.emit));
      break;
    }

    const m = h.m;
    if (m.t === "lambert") {
      const nee = sampleLight(h.p, n);
      col = add(col, cmul(thru, cmul(m.albedo, nee)));
      const dir = cosineHemisphere(n);
      thru = cmul(thru, m.albedo);
      specular = false;
      ro = add(h.p, mul(n, EPS));
      rd = dir;
    } else if (m.t === "metal") {
      const refl = reflect(rd, n);
      const dir = nrm(add(refl, mul(unitSphere(), m.fuzz)));
      if (dot(dir, n) <= 0) break;
      thru = cmul(thru, m.albedo);
      specular = true;
      ro = add(h.p, mul(n, EPS));
      rd = dir;
    } else if (m.t === "glass") {
      const eta = front ? 1 / m.eta : m.eta;
      const cos = Math.min(dot(mul(rd, -1), n), 1);
      const r0 = ((1 - m.eta) / (1 + m.eta)) ** 2;
      const F = schlick(cos, r0);
      let dir;
      const refr = refract(rd, n, eta);
      if (!refr || Math.random() < F) dir = nrm(reflect(rd, n));
      else dir = nrm(refr);
      specular = true;
      ro = add(h.p, mul(dir, 2e-3));
      rd = dir;
    }

    if (depth >= RR_DEPTH) {
      const p = Math.max(thru.x, thru.y, thru.z);
      if (Math.random() > p) break;
      thru = mul(thru, 1 / Math.max(p, 1e-4));
    }
  }
  return col;
}

function cameraRay(i, j, cam) {
  const u = (i + Math.random()) / W;
  const vv = (j + Math.random()) / H;
  const aspect = W / H;
  const tan = Math.tan((cam.fov * Math.PI) / 180 / 2);
  const px = (2 * u - 1) * tan * aspect;
  const py = (1 - 2 * vv) * tan;
  const dir = nrm(add(add(cam.fwd, mul(cam.right, px)), mul(cam.up, py)));
  return { o: cam.orig, d: dir };
}

function tonemap(x) {
  const y = x / (1 + x);
  return Math.pow(clamp01(y), 1 / 2.2) * 255;
}

function tick(budgetMs) {
  const cam = camera();
  const t0 = performance.now();
  while (performance.now() - t0 < budgetMs) {
    const y = scanY;
    for (let x = 0; x < W; x++) {
      const ray = cameraRay(x, y, cam);
      const c = trace(ray.o, ray.d);
      const i = (y * W + x) * 3;
      accum[i] += c.x;
      accum[i + 1] += c.y;
      accum[i + 2] += c.z;
    }
    scanY++;
    if (scanY >= H) {
      scanY = 0;
      sppPass++;
    }
  }
}

function rgba() {
  const out = new Uint8ClampedArray(W * H * 4);
  const div = Math.max(sppPass + scanY / H, 1e-4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = tonemap(accum[i * 3] / div);
    out[i * 4 + 1] = tonemap(accum[i * 3 + 1] / div);
    out[i * 4 + 2] = tonemap(accum[i * 3 + 2] / div);
    out[i * 4 + 3] = 255;
  }
  return out;
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    W = msg.w;
    H = msg.h;
    Object.assign(state, msg.state || {});
    resetBuf();
    totalPaths = 0;
    totalRays = 0;
  } else if (msg.type === "state") {
    Object.assign(state, msg.state);
    resetBuf();
    totalPaths = 0;
    totalRays = 0;
  } else if (msg.type === "reset") {
    resetBuf();
    totalPaths = 0;
    totalRays = 0;
  } else if (msg.type === "tick") {
    const rays0 = totalRays;
    const t0 = performance.now();
    tick(msg.budget || 28);
    const ms = performance.now() - t0;
    const pixels = rgba();
    postMessage(
      {
        type: "frame",
        w: W,
        h: H,
        rgba: pixels.buffer,
        spp: sppPass + scanY / H,
        paths: totalPaths,
        rays: totalRays,
        drays: totalRays - rays0,
        ms,
      },
      [pixels.buffer]
    );
  }
};
