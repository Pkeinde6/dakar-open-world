// Dakar Open World — moteur du jeu (Three.js)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const D = window.MAP_DATA;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// ---------------- Projection ----------------
const [LAT0, LON0] = D.origin;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const ll = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const CITIES = { 1: { name: 'Dakar', p: ll(14.6687, -17.4325) }, 2: { name: 'Diourbel', p: ll(14.6555, -16.2316) }, 3: { name: 'Touba', p: ll(14.8611, -15.8757) } };

// ---------------- Decode roads ----------------
//            mway trunk prim  sec  tert  resid uncl  living serv track link
// defaults for streets the facade survey (tools/widths.mjs) could not measure; Dakar medians are ~9 m
const WIDTH = [11,  11,   10,   9.5, 9,    8,    7.5,  5.5,   5,    4,    7];
const SIDEW = [0,   2.5,  3,    3,   2.5,  2,    2,    1,     1,    0,    0];
const SPEED = [30,  23,   16,   14,  12,   8,    8,    5,     6,    7,    14];
const DRIVABLE = t => t !== 9 || true;
const roads = [];
for (const [t, ni, ow, lanes, flat, mw, ms] of D.roads) {
  const pts = []; let x = 0, z = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x += flat[i]; z += flat[i + 1];
    if (pts.length) { // subdivide long segments (<= 40 m)
      const [px, pz] = pts[pts.length - 1], L = Math.hypot(x - px, z - pz), n = Math.ceil(L / 40);
      for (let k = 1; k < n; k++) pts.push([px + (x - px) * k / n, pz + (z - pz) * k / n]);
    }
    pts.push([x, z]);
  }
  if (pts.length < 2) continue;
  const w = mw ? mw / 10 : lanes ? clamp(lanes * 3.3 + 1, 5, 18) : WIDTH[t], side = ms ? Math.min(3.5, ms / 10) : SIDEW[t];
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  roads.push({ t, name: ni >= 0 ? D.names[ni] : '', ow, w, side, pts, cum, len: cum[cum.length - 1] });
}

// spatial grid of segments
const CELL = 200;
const ckey = (gx, gz) => (gx + 4000) * 10000 + (gz + 4000);
const cellOf = v => Math.floor(v / CELL);
const segGrid = new Map();
roads.forEach((r, ri) => {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const k = ckey(cellOf((r.pts[i][0] + r.pts[i + 1][0]) / 2), cellOf((r.pts[i][1] + r.pts[i + 1][1]) / 2));
    let a = segGrid.get(k); if (!a) segGrid.set(k, a = []); a.push(ri, i);
  }
});
// endpoints graph (for AI)
const endKey = (x, z) => Math.round(x / 4) * 100000 + Math.round(z / 4);
const ends = new Map();
roads.forEach((r, ri) => {
  for (const e of [0, 1]) {
    const p = e ? r.pts[r.pts.length - 1] : r.pts[0], k = endKey(p[0], p[1]);
    let a = ends.get(k); if (!a) ends.set(k, a = []); a.push([ri, e]);
  }
});

// how far (x,z) sits inside the nearest road+sidewalk band (>0 = overlapping), with outward push direction
function roadOverlap(x, z, margin = 0.4) {
  let worst = 0, px = 0, pz = 0; const gx = cellOf(x), gz = cellOf(z);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const s = segGrid.get(ckey(gx + a, gz + b)); if (!s) continue;
    for (let j = 0; j < s.length; j += 2) {
      const r = roads[s[j]], i = s[j + 1]; if (r.t > 8) continue;
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      const band = r.w / 2 + Math.max(0.3, r.side) + margin, o = band - d;
      if (o > worst) { worst = o; const k = d > 1e-3 ? 1 / d : 0; px = (x - qx) * k; pz = (z - qz) * k; if (!k) { const l = Math.sqrt(L2); px = -dz / l; pz = dx / l; } }
    }
  }
  return worst > 0 ? { o: worst, px, pz } : null;
}
// nudge a point off every carriageway (margin < 0 lets it stand on the sidewalk); null if it can't be cleared
function clearOfRoads(x, z, margin = 0.4) { for (let it = 0; it < 4; it++) { const ov = roadOverlap(x, z, margin); if (!ov) return [x, z]; if (ov.o > 8) return null; x += ov.px * (ov.o + 0.05); z += ov.pz * (ov.o + 0.05); } return null; }
function nearestRoad(x, z, maxCells = 1, filter) {
  let best = null, bd = 1e9; const gx = cellOf(x), gz = cellOf(z);
  for (let a = -maxCells; a <= maxCells; a++) for (let b = -maxCells; b <= maxCells; b++) {
    const s = segGrid.get(ckey(gx + a, gz + b)); if (!s) continue;
    for (let j = 0; j < s.length; j += 2) {
      const r = roads[s[j]], i = s[j + 1]; if (filter && !filter(r)) continue;
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = { r, ri: s[j], i, t, x: px, z: pz, d, h: Math.atan2(dx, dz) }; }
    }
  }
  return best;
}

// ---------------- GPS routing (A* on the real road graph) ----------------
let graph = null;
const vkey = (x, z) => Math.round(x) * 1000003 + Math.round(z);
function buildGraph() {
  const pos = new Map(), adj = new Map();
  const add = (a, b, d) => { let l = adj.get(a); if (!l) adj.set(a, l = []); l.push(b, d); };
  for (const r of roads) {
    if (r.t === 8 && r.len < 30) continue;
    for (let i = 0; i < r.pts.length; i++) { const k = vkey(r.pts[i][0], r.pts[i][1]); if (!pos.has(k)) pos.set(k, r.pts[i]); }
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = vkey(r.pts[i][0], r.pts[i][1]), b = vkey(r.pts[i + 1][0], r.pts[i + 1][1]);
      const d = (r.cum[i + 1] - r.cum[i]) / (SPEED[r.t] / 10); // weight by travel time
      add(a, b, d); if (!r.ow) add(b, a, d);
    }
  }
  graph = { pos, adj };
}
function nearestVertex(x, z) {
  const nr = nearestRoad(x, z, 3, r => r.t <= 8 || r.t === 10); if (!nr) return null;
  const p = nr.t < 0.5 ? nr.r.pts[nr.i] : nr.r.pts[nr.i + 1]; return vkey(p[0], p[1]);
}
function findRoute(x0, z0, x1, z1) {
  if (!graph) buildGraph();
  const s = nearestVertex(x0, z0), g = nearestVertex(x1, z1); if (s == null || g == null) return null;
  const [gx, gz] = graph.pos.get(g); const H = k => { const p = graph.pos.get(k); return Math.hypot(p[0] - gx, p[1] - gz) / 3; };
  const heap = [[H(s), s]], gs = new Map([[s, 0]]), came = new Map(); let n = 0;
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length && n++ < 400000) {
    const [, u] = pop(); if (u === g) break;
    const l = graph.adj.get(u); if (!l) continue; const gu = gs.get(u);
    for (let i = 0; i < l.length; i += 2) { const v = l[i], nd = gu + l[i + 1]; if (nd < (gs.get(v) ?? 1e18)) { gs.set(v, nd); came.set(v, u); push([nd + H(v), v]); } }
  }
  if (!came.has(g)) return null;
  const path = []; let k = g; while (k !== undefined) { path.push(graph.pos.get(k)); k = came.get(k); }
  path.reverse(); let len = 0; for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return { path, len };
}
let route = null, routeT = 0;
function updateRoute(dt) {
  if (!waypoint) { route = null; return; }
  if (Math.hypot(waypoint[0] - player.x, waypoint[1] - player.z) < 40) { toast('Tu es arrivé à destination'); waypoint = null; route = null; return; }
  routeT -= dt; if (routeT > 0) return; routeT = 3;
  route = findRoute(player.x, player.z, waypoint[0], waypoint[1]);
}
function strokeRoute(ctx, w) {
  if (!route) return; ctx.strokeStyle = '#c86bff'; ctx.lineWidth = w; ctx.beginPath();
  route.path.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)); ctx.lineTo(...waypoint); ctx.stroke();
}

// places
const places =D.places.map(([name, type, x, z]) => ({ name, type, x, z }));
const cityPlaces = places.filter(p => p.type === 'city' || p.type === 'town');
const quartPlaces = places.filter(p => p.type !== 'city' && p.type !== 'town');

// ---------------- Marches & proprete ----------------
// Street markets spill onto the carriageway: tables, tarps on poles, basins and sacks on the ground.
// Positions from the real markets (OSM / plans de Dakar), radius = how far the stalls spread into the streets.
const MARCHES = [
  ['Marché Sandaga', 14.6693, -17.4373, 190], ['Marché Kermel', 14.6695, -17.4302, 80], ['Marché Tilène', 14.6772, -17.4478, 150],
  ['Marché de Colobane', 14.6965, -17.4450, 230], ['Marché HLM', 14.7095, -17.4445, 160], ['Marché Castors', 14.7232, -17.4482, 140],
  ['Marché de Grand Yoff', 14.7380, -17.4540, 130], ['Marché de Yoff', 14.7590, -17.4690, 90], ['Marché de Ouakam', 14.7240, -17.4880, 90],
  ['Marché Zinc de Pikine', 14.7535, -17.3960, 170], ['Marché de Thiaroye', 14.7480, -17.3690, 150], ['Marché du Jeudi', 14.7760, -17.4001, 150],
  ['Marché de Rufisque', 14.7160, -17.2740, 150], ['Marché Ocass de Touba', 14.8580, -15.8800, 220], ['Marché de Diourbel', 14.6560, -16.2330, 140],
].map(([n, a, b, r]) => { const [x, z] = ll(a, b); return { n, x, z, r }; });
// quartiers populaires ou les dechets plastiques trainent le plus (sachets d'eau, sacs noirs) ; 0 = propre, 1 = sale
const SALE = [['Colobane', 0.85], ['Medina', 0.7], ['Gueule Tapée', 0.6], ['Rebeuss', 0.6], ['Pikine', 0.85], ['Pikine Ouest', 0.8], ['Thiaroye', 0.85], ['Guédiawaye', 0.75],
  ['Grand Yoff', 0.7], ['Arafat', 0.7], ['Parcelles Assainies', 0.6], ['Djida Thiaroye Kaw', 0.85], ['Yeumbeul', 0.8], ['Dalifort', 0.7], ['Hann Bel-Air', 0.6],
  ['Almadies', 0.05], ['Ngor', 0.25], ['Mermoz', 0.15], ['Point E', 0.12], ['Fann Résidence', 0.08], ['Dakar-Plateau', 0.25], ['Sacré Coeur', 0.2]]
  .map(([n, v]) => { const p = places.find(q => q.name === n); return p && { x: p.x, z: p.z, v }; }).filter(Boolean);
function marcheAt(x, z) { for (const m of MARCHES) { const d = Math.hypot(m.x - x, m.z - z); if (d < m.r) return { m, k: 1 - d / m.r }; } return null; }
function saleAt(x, z) {
  const mk = marcheAt(x, z); if (mk) return 0.75 + 0.25 * mk.k;
  let v = 0.35, best = 2200; for (const s of SALE) { const d = Math.hypot(s.x - x, s.z - z); if (d < best) { best = d; v = s.v; } }
  return v;
}

// signals
const signals = [];
for (let i = 0; i < D.signals.length; i += 2) {
  const x = D.signals[i], z = D.signals[i + 1];
  const nr = nearestRoad(x, z, 1, r => r.t <= 4 || r.t === 10) || nearestRoad(x, z, 1);
  signals.push({ x, z, ref: nr ? nr.h : 0, g: (i / 2) % 4, hacked: 0 });
}
const sigGrid = new Map();
signals.forEach((s, i) => { const k = ckey(cellOf(s.x), cellOf(s.z)); let a = sigGrid.get(k); if (!a) sigGrid.set(k, a = []); a.push(i); });
let time = 0;
function signalState(s, heading) { // 'g','y','r' for a vehicle with given heading
  if (s.hacked > time) return 'r';
  const axisA = Math.abs(Math.cos(heading - s.ref)) > 0.707;
  const t = (time + s.g * 7.5) % 30;
  if (axisA) return t < 12 ? 'g' : t < 15 ? 'y' : 'r';
  return t < 15 ? 'r' : t < 27 ? 'g' : 'y';
}

// buildings grid
const bGrid = new Map();
D.buildings.forEach((b, i) => { const f = b[2]; const k = ckey(cellOf(f[0]), cellOf(f[1])); let a = bGrid.get(k); if (!a) bGrid.set(k, a = []); a.push(i); });

// water polygon (sea around Dakar) from coastline
let waterPoly = null;
if (D.coast && D.coast.length > 20) {
  const c = []; for (let i = 0; i < D.coast.length; i += 2) c.push([D.coast[i], D.coast[i + 1]]);
  const s = c[0], e = c[c.length - 1];
  waterPoly = c.concat([[e[0] - 3000, 30000], [-30000, 30000], [-30000, -50000], [s[0], -50000]]);
}
function inPoly(x, z, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins; } return ins; }
const isWater = (x, z) => waterPoly && x < 46000 && inPoly(x, z, waterPoly);

// ---------------- Renderer / scene ----------------
const canvas = $('game');
// Quality presets (P to switch). "Bas" is tuned for integrated GPUs (Intel UHD).
const QUALITY = [
  { name: 'Bas', pr: 0.75, shadow: 0, radius: 2, traffic: 12, peds: 10, bloom: false, bshadow: false, fog: 0.0024 },
  { name: 'Moyen', pr: 1, shadow: 1024, radius: 3, traffic: 20, peds: 20, bloom: true, bshadow: false, fog: 0.0014 },
  { name: 'Haut', pr: Math.min(devicePixelRatio, 1.5), shadow: 2048, radius: 4, traffic: 26, peds: 34, bloom: true, bshadow: true, fog: 0.0011 },
];
let qIdx = (() => { try { const v = localStorage.getItem('dow-quality'); if (v != null) return +v; } catch (e) { } return /Intel|UHD|Iris|Mali|Adreno/i.test(gpuName()) ? 0 : 1; })();
function gpuName() { try { const g = document.createElement('canvas').getContext('webgl'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { return ''; } }
let Q = QUALITY[qIdx];
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 9000);

const sky = new Sky(); sky.scale.setScalar(20000); scene.add(sky);
const su = sky.material.uniforms; su.turbidity.value = 8; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.85;
const sunDir = new THREE.Vector3();
const hemi = new THREE.HemisphereLight(0xfff1dc, 0xb08a5a, 0.7); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b8, 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow || 512, Q.shadow || 512); renderer.shadowMap.enabled = Q.shadow > 0; Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 600 }); sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;

const MODES = [{ name: 'Golden hour', elev: 9, az: 250, fog: 0xe9c9a0, exp: 0.8, sun: 2.6, hemi: 0.7, night: 0, hdr: 'qwantani_late_afternoon_puresky' },
               { name: 'Midi', elev: 60, az: 200, fog: 0xcfe0ea, exp: 0.7, sun: 3.0, hemi: 0.9, night: 0, hdr: 'kloofendal_48d_partly_cloudy_puresky' },
               { name: 'Nuit', elev: -6, az: 250, fog: 0x0b1424, exp: 0.9, sun: 0.15, hemi: 0.12, night: 1, hdr: 'qwantani_night_puresky' }];
// HDRI environments (image-based lighting), loaded lazily; procedural sky env is the fallback
const hdrEnv = {}, rgbe = new RGBELoader();
function loadHdr(m) {
  if (m.hdr in hdrEnv) return; hdrEnv[m.hdr] = null;
  rgbe.load(`textures/${m.hdr}.hdr`, (t) => { t.mapping = THREE.EquirectangularReflectionMapping; hdrEnv[m.hdr] = pmrem.fromEquirectangular(t).texture; t.dispose(); if (MODES[modeIdx] === m) scene.environment = hdrEnv[m.hdr]; }, undefined, () => {});
}
let modeIdx = 0, night = 0;
scene.fog = new THREE.FogExp2(0xe9c9a0, Q.fog);
function applyMode() {
  const m = MODES[modeIdx]; night = m.night;
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - Math.max(m.elev, -2)), THREE.MathUtils.degToRad(m.az));
  su.sunPosition.value.copy(sunDir);
  sun.intensity = m.sun; sun.color.set(night ? 0x8fa8ff : m.elev < 15 ? 0xffd2a0 : 0xfff4e6);
  hemi.intensity = m.hemi; scene.fog.color.set(m.fog); renderer.toneMappingExposure = m.exp;
  if (envRT) envRT.dispose();
  const s2 = new THREE.Scene(); const sk = sky.clone(); s2.add(sk); envRT = pmrem.fromScene(s2); scene.environment = hdrEnv[m.hdr] || envRT.texture; loadHdr(m);
  scene.environmentIntensity = night ? 0.35 : 0.9;
  sky.visible = !night; scene.background = night ? new THREE.Color(0x05080f) : null;
  for (const m2 of nightMats) m2.emissiveIntensity = night ? m2.userData.nightI : (m2.userData.dayI || 0);
  bloom.strength = night ? 0.9 : 0.25;
  headL.visible = headR.visible = !!night;
  toast(`Ambiance : ${m.name}`);
}

// post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 4, innerHeight / 4), 0.25, 0.6, 0.85); composer.addPass(bloom); bloom.enabled = Q.bloom;
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, glitch: { value: 0 }, t: { value: 0 }, wanted: { value: 0 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float glitch,t,wanted;varying vec2 vUv;
  void main(){vec2 uv=vUv;float g=glitch;
    if(g>0.){float line=step(.92,fract(sin(floor(uv.y*60.+t*40.)*43758.5)));uv.x+=line*g*.04*sin(t*90.);}
    vec3 c=vec3(texture2D(tDiffuse,uv+vec2(g*.006,0)).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-vec2(g*.006,0)).b);
    float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,1.12);c=(c-.5)*1.06+.5;c*=vec3(1.03,1.0,.96);
    float v=smoothstep(.95,.35,length(vUv-.5));c*=mix(.72,1.,v);
    if(g>0.)c+=vec3(0.,.15,.2)*g*step(.5,fract(uv.y*200.));
    gl_FragColor=vec4(c,1.);}`
});
composer.addPass(grade); composer.addPass(new OutputPass());

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

// ---------------- Procedural textures ----------------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const noise = (g, w, h, base, amp, n = 6000) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (Math.random() - .5) * amp; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };
const asphaltTex = canvasTex(256, 256, (g, w, h) => { noise(g, w, h, '#ffffff', 0.25, 9000); for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(0,0,0,.07)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rand(10, 40), rand(5, 20), Math.random() * 3, 0, 7); g.fill(); } });
const sandTex = canvasTex(512, 512, (g, w, h) => { noise(g, w, h, '#d6b88a', 0.22, 26000); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${pick(['120,100,60', '160,140,90', '230,210,170'])},.12)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, rand(10, 60), rand(6, 30), Math.random() * 3, 0, 7); g.fill(); } });
// facade: 4 bays x 4 floors (3.5 m x 3.1 m each). Dakar houses: small windows behind wrought-iron grilles,
// aluminium or wooden louvres painted green/blue, a few balconies and split air-conditioners, rain/dust streaks.
const facadeTex = canvasTex(512, 512, (g) => {
  noise(g, 512, 512, '#ffffff', 0.1, 9000);
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${pick(['120,100,80', '90,80,70', '255,250,240'])},${rand(.03, .08)})`; g.beginPath(); g.ellipse(rand(0, 512), rand(0, 512), rand(20, 90), rand(10, 50), rand(0, 3), 0, 7); g.fill(); }
  const grille = (x, y, w, h) => { // fer forge : barreaux + volutes
    g.strokeStyle = pick(['#1d1d1f', '#2b3a33', '#3a2a22', '#e8e4da']); g.lineWidth = 2.2;
    for (let k = 0; k <= w; k += 9) { g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + k, y + h); g.stroke(); }
    g.beginPath(); g.moveTo(x, y + h * 0.5); g.lineTo(x + w, y + h * 0.5); g.stroke();
    if (Math.random() < 0.6) for (let k = 4; k < w; k += 18) { g.beginPath(); g.arc(x + k + 4, y + h * 0.5 - 6, 5, 0, Math.PI * 1.6); g.stroke(); g.beginPath(); g.arc(x + k + 4, y + h * 0.5 + 6, 5, Math.PI, Math.PI * 2.6); g.stroke(); }
  };
  for (let fx = 0; fx < 4; fx++) for (let fy = 0; fy < 4; fy++) {
    const x = fx * 128, y = fy * 128;
    g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(x, y + 120, 128, 8); // floor band (dalle)
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y + 118, 128, 2);
    const r = Math.random();
    if (r < 0.1) continue; // mur aveugle
    const ww = r < 0.3 ? 40 : 56, wh = r < 0.3 ? 40 : 58, wx = x + (128 - ww) / 2, wy = y + 30;
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12); // encadrement
    const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh); grd.addColorStop(0, pick(['#6f8696', '#5f7f78', '#7d8a94'])); grd.addColorStop(1, '#1b2228');
    g.fillStyle = grd; g.fillRect(wx, wy, ww, wh);
    if (Math.random() < 0.45) { // persiennes
      g.fillStyle = pick(['#2f7d5b', '#2a5d8f', '#7a5534', '#a8b3b8', '#c9c1a8']); g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(0,0,0,.28)'; for (let k = wy + 3; k < wy + wh; k += 5) g.fillRect(wx, k, ww, 1.6);
      if (Math.random() < 0.5) { g.fillStyle = grd; g.fillRect(wx + ww / 2, wy, ww / 2, wh); } // un battant ouvert
    }
    if (Math.random() < 0.7) grille(wx, wy, ww, wh);
    g.fillStyle = 'rgba(70,55,40,.13)'; g.fillRect(wx + 3, wy + wh + 6, ww - 6, rand(20, 50)); // coulure sous l'appui
    if (fy > 0 && Math.random() < 0.18) { // balcon : dalle + garde-corps
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 14, wy + wh + 12, 100, 5); g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(x + 12, wy + wh + 8, 104, 5);
      g.strokeStyle = pick(['#1d1d1f', '#e8e4da', '#2b4a6a']); g.lineWidth = 2; for (let k = x + 14; k < x + 116; k += 7) { g.beginPath(); g.moveTo(k, wy + wh - 18); g.lineTo(k, wy + wh + 8); g.stroke(); }
      g.fillRect(x + 12, wy + wh - 20, 104, 3);
    } else if (Math.random() < 0.15) { // climatiseur
      g.fillStyle = '#e9e9e4'; g.fillRect(wx + ww + 4, wy + wh - 10, 26, 18); g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(wx + ww + 17, wy + wh - 1, 6, 0, 7); g.fill();
      g.fillStyle = 'rgba(40,30,20,.18)'; g.fillRect(wx + ww + 10, wy + wh + 8, 4, 50);
    }
  }
  g.fillStyle = '#fff'; g.fillRect(0, 496, 24, 16); // coin uni : sert aux toits et aux edicules (uv 0.01)
});
// ground-floor shopfronts: 8 shops across the texture, each with a painted sign
const SHOPS = [['ALIMENTATION', '#1f6fb5'], ['BOUTIQUE', '#c0392b'], ['Orange Money', '#ff7900'], ['WAVE', '#1dc8f2'], ['QUINCAILLERIE', '#2c3e50'], ['TAILLEUR', '#8e44ad'], ['PHARMACIE', '#27ae60'], ['DIBITERIE', '#a0522d'], ['TÉLÉCENTRE', '#16a085'], ['COIFFURE', '#d35400'], ['MULTISERVICES', '#2980b9'], ['DÉPÔT GAZ', '#7f8c8d']];
const shopTex = canvasTex(1024, 128, (g) => {
  for (let i = 0; i < 8; i++) {
    const x = i * 128, [name, col] = pick(SHOPS);
    g.fillStyle = pick(['#e9dcc3', '#f1e6cf', '#d9c7a6', '#efe2c9']); g.fillRect(x, 0, 128, 128);
    g.fillStyle = col; g.fillRect(x + 4, 6, 120, 30); // sign board
    g.fillStyle = '#fff'; g.font = 'bold 15px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name.slice(0, 13), x + 64, 22);
    if (name === 'PHARMACIE') { g.fillStyle = '#2ecc71'; g.fillRect(x + 6, 10, 8, 22); g.fillRect(x + 1, 17, 18, 8); }
    const open = Math.random() < 0.6;
    if (open) { // open shop: dark interior with shelves
      g.fillStyle = '#2a2420'; g.fillRect(x + 14, 44, 100, 84);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) { g.fillStyle = pick(['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#27ae60', '#e67e22']); g.fillRect(x + 18 + k * 11, 52 + r * 18, 8, 10); }
    } else { // metal rolling shutter
      g.fillStyle = pick(['#8a9399', '#5d7a8c', '#6e8f6a', '#a59b8c']); g.fillRect(x + 14, 44, 100, 84);
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 46; y < 128; y += 5) g.fillRect(x + 14, y, 100, 1.5);
    }
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, 120, 128, 8);
  }
});
shopTex.wrapT = THREE.ClampToEdgeWrapping;
const shopMat = new THREE.MeshStandardMaterial({ map: shopTex, roughness: 0.8, vertexColors: true });
const litTex = canvasTex(512, 512, (g) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512);
  for (let fx = 0; fx < 4; fx++) for (let fy = 0; fy < 4; fy++) if (Math.random() < 0.38) { g.fillStyle = pick(['#ffcf7a', '#ffe2a8', '#bfe0ff']); g.fillRect(fx * 128 + 32, fy * 128 + 32, 64, 60); }
});
const glowTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,200,120,.9)'); r.addColorStop(1, 'rgba(255,170,80,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }, false);

// photo-scanned PBR sets (textures/<name>_diff|nor|rough.jpg), assigned to materials as they load
const texLoader = new THREE.TextureLoader();
function pbr(mat, name, { normal = 1, rough = true, diff = true, tint, repeat = 1 } = {}) {
  const ld = (suf, srgb, cb) => texLoader.load(`textures/${name}_${suf}.jpg`, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.setScalar(repeat); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (srgb) t.colorSpace = THREE.SRGBColorSpace; cb(t); mat.needsUpdate = true; }, undefined, () => {});
  if (diff) ld('diff', true, (t) => { mat.map = t; if (tint) mat.color.set(tint); });
  ld('nor', false, (t) => { mat.normalMap = t; mat.normalScale.set(normal, normal); });
  if (rough) ld('rough', false, (t) => { mat.roughnessMap = t; mat.roughness = 1; });
}
const nightMats = [];
const parkedMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.3 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.15, metalness: 0.5 });
const stallMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1 });
const parasolMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
const sandPileMat = new THREE.MeshStandardMaterial({ color: 0xc7a473, roughness: 1, flatShading: true });
const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
const sideMat = new THREE.MeshStandardMaterial({ map: asphaltTex, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
// the scanned asphalt is a dark fresh tarmac; Dakar roads are sun-bleached and dusty, so the albedo is lifted (linear > 1)
pbr(roadMat, 'worn_asphalt', { tint: new THREE.Color(4.2, 4.0, 3.9) }); pbr(sideMat, 'interlocking_concrete_pavers', { tint: new THREE.Color(2.2, 2.1, 2.0), repeat: 3 });
pbr(shopMat, 'painted_metal_shutter', { diff: false, rough: false, normal: 0.4 });
// sand drift texture: u = across (0 at the curb, 1 toward the lane), v = along the road; ragged inner edge
const sandEdgeTex = canvasTex(128, 256, (g, w, h) => {
  const im = g.createImageData(w, h);
  for (let y = 0; y < h; y++) { const wob = 0.55 + 0.25 * Math.sin(y * 0.11) + 0.12 * Math.sin(y * 0.37 + 1) + 0.08 * Math.sin(y * 1.3);
    for (let x = 0; x < w; x++) { const u = x / w, a = clamp((wob - u) * 3.2 + 0.25, 0, 1) * (0.75 + Math.random() * 0.25), p = (y * w + x) * 4, v = 200 + Math.random() * 30;
      im.data[p] = v; im.data[p + 1] = v * 0.84; im.data[p + 2] = v * 0.6; im.data[p + 3] = a * 255; } }
  g.putImageData(im, 0, 0);
});
sandEdgeTex.colorSpace = THREE.SRGBColorSpace;
const sandEdgeMat = new THREE.MeshStandardMaterial({ map: sandEdgeTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const markMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const bldMat = new THREE.MeshStandardMaterial({ map: facadeTex, vertexColors: true, roughness: 0.85, emissiveMap: litTex, emissive: 0xffffff, emissiveIntensity: 0 });
pbr(bldMat, 'worn_plaster_wall', { diff: false, normal: 0.7 });
// le sable remonte sur le pied des murs, la pluie et la poussiere laissent des coulures, les toits-terrasses sont en beton brut
bldMat.onBeforeCompile = (sh) => {
  sh.vertexShader = 'varying vec3 vWP; varying float vUp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
    vWP = (modelMatrix * vec4(transformed, 1.)).xyz; vUp = normal.y;`);
  sh.fragmentShader = `varying vec3 vWP; varying float vUp;
float bh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
float bn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(bh(i),bh(i+vec2(1,0)),f.x),mix(bh(i+vec2(0,1)),bh(i+vec2(1,1)),f.x),f.y);}
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    float along = vWP.x + vWP.z;
    if (vUp > .5) { // toit : beton gris-beige taches
      float n = bn(vWP.xz * .35) * .6 + bn(vWP.xz * 2.1) * .4;
      diffuseColor.rgb = mix(vec3(.62,.58,.52), vec3(.78,.74,.66), n) * mix(.85, 1.05, bn(vWP.xz * 9.));
    } else {
      float streak = bn(vec2(along * 1.3, vWP.y * .06)) * bn(vec2(along * 4.1, vWP.y * .25));
      diffuseColor.rgb *= 1. - streak * .28;
      float foot = 1. - smoothstep(.0, 1.1 + bn(vec2(along * .7, 0.)) * .9, vWP.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62,.5,.36), foot * .55);
    }`);
};
bldMat.userData.nightI = 1.6; nightMats.push(bldMat);
const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0 }); lampMat.userData.nightI = 6; nightMats.push(lampMat);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.5, metalness: 0.6 });
const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x7d6446, roughness: 1 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f7d34, roughness: 0.9, side: THREE.DoubleSide });
const woodPoleMat = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 });
const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85 });
const tankMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
const dishMat = new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
const rebarMat = new THREE.LineBasicMaterial({ color: 0x6b3d22 });
const clothMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
// wind: vertex sway above a base height, phase from the instance position so neighbours don't move in lockstep
const windT = { value: 0 };
function windy(mat, base, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWT = windT;
    sh.vertexShader = 'uniform float uWT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 ip = vec2(0.);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xz;
      #endif
      float wh = max(transformed.y - ${base.toFixed(2)}, 0.) * ${amp.toFixed(4)}, gust = .6 + .4 * sin(uWT * .35 + ip.x * .004);
      transformed.x += wh * gust * (sin(uWT * 1.7 + ip.x * .13) + .35 * sin(uWT * 4.3 + ip.y * .31 + transformed.y));
      transformed.z += wh * gust * .6 * cos(uWT * 1.3 + ip.y * .11);`);
  };
}
const pitchTex = canvasTex(256, 384, (g, w, h) => { noise(g, w, h, '#cdb083', 0.18, 9000); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; const m = 20; g.strokeRect(m, m, w - 2 * m, h - 2 * m); g.beginPath(); g.moveTo(m, h / 2); g.lineTo(w - m, h / 2); g.stroke(); g.beginPath(); g.arc(w / 2, h / 2, 34, 0, 7); g.stroke(); g.strokeRect(w / 2 - 50, m, 100, 46); g.strokeRect(w / 2 - 50, h - m - 46, 100, 46); }, false);
const pitchMat = new THREE.MeshStandardMaterial({ map: pitchTex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
const players = [];
const bushMat = new THREE.MeshStandardMaterial({ color: 0x4d6b2c, roughness: 1, flatShading: true });
const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
const neemMat = new THREE.MeshStandardMaterial({ color: 0x56783a, roughness: 1, flatShading: true });
windy(leafMat, 7.5, 0.06); windy(palmTrunkMat, 3, 0.012); windy(neemMat, -3, 0.035); windy(grassMat, 0, 0.12); windy(bushMat, 0, 0.05);

// ground
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
ground.geometry.attributes.uv.array.forEach((v, i, a) => a[i] = v * 600);
pbr(ground.material, 'sand_02', { normal: 0.8 });
{ const gm = ground.material, gravel = { value: null };
  texLoader.load('textures/gravelly_sand_diff.jpg', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); gravel.value = t; gm.defines = { GRAVEL: 1 }; gm.needsUpdate = true; });
  gm.onBeforeCompile = (sh) => {
    sh.uniforms.tGravel = gravel;
    sh.fragmentShader = `uniform sampler2D tGravel;
float gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.5),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.5),c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.5),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.5);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
`
      + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef GRAVEL
        vec2 wp = vMapUv * 0.06;
        float m = smoothstep(.45, .7, gn(wp) * .7 + gn(wp * 3.7) * .3);
        vec3 gv = texture2D(tGravel, vMapUv * 0.8).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, gv * vec3(1.05, .92, .8), m);
        diffuseColor.rgb *= mix(.9, 1.06, gn(wp * 9.));
      #endif`);
  }; }
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
// sea
if (waterPoly) {
  const shape = new THREE.Shape(waterPoly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const wg = new THREE.ShapeGeometry(shape); wg.rotateX(-Math.PI / 2);
  const wn = new THREE.TextureLoader().load('models/waternormals.jpg'); wn.wrapS = wn.wrapT = THREE.RepeatWrapping; wn.repeat.set(1, 1);
  const uvs = []; const p = wg.attributes.position; for (let i = 0; i < p.count; i++) uvs.push(p.getX(i) / 40, p.getZ(i) / 40);
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  var waterMat = new THREE.MeshStandardMaterial({ color: 0x0f4f78, roughness: 0.08, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.6, 0.6) });
  const water = new THREE.Mesh(wg, waterMat); water.position.y = 0.12; scene.add(water);
}

// ---------------- Chunks ----------------
const chunks = new Map();
const colliders = new Map(); // ckey -> [{pts,minx,maxx,minz,maxz}]
const FACADE = [0xe8d4b0, 0xdba56c, 0xf3efe6, 0xeedc9a, 0xe0a386, 0xc9d3d6, 0xc3764f, 0xd8c2a0, 0xf0e2c8, 0xb9cfb0];
const isPlateau = (x, z) => x > -400 && x < 2600 && z > -1800 && z < 1600;
const outsideDakar = x => x > 40000;

// sand blown onto the carriageway edge: strip from `o1` (inner, fades out) to `o0` (curb side), both sides
function sandEdge(E, pts, cum, i, o0, o1, y) {
  const n = pts.length, norm = k => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
  const [ax, az] = pts[i], [bx, bz] = pts[i + 1], na = norm(i), nb = norm(i + 1), va = cum[i] / 5, vb = cum[i + 1] / 5;
  for (const s of [1, -1]) {
    const q = [[ax + na[0] * o0 * s, az + na[1] * o0 * s, 0, va], [ax + na[0] * o1 * s, az + na[1] * o1 * s, 1, va], [bx + nb[0] * o1 * s, bz + nb[1] * o1 * s, 1, vb], [bx + nb[0] * o0 * s, bz + nb[1] * o0 * s, 0, vb]];
    for (const k of (s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2])) E.push([...q[k], y]);
  }
}
function ribbon(pos, col, uv, pts, i0, i1, half, y, color) {
  // emits quads for segments i0..i1-1 of polyline pts with mitered normals
  const n = pts.length;
  const norm = i => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
  for (let i = i0; i < i1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], na = norm(i), nb = norm(i + 1);
    const v = [[ax + na[0] * half, az + na[1] * half], [ax - na[0] * half, az - na[1] * half], [bx - nb[0] * half, bz - nb[1] * half], [bx + nb[0] * half, bz + nb[1] * half]];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(v[k][0], y, v[k][1]); uv.push(v[k][0] / 6, v[k][1] / 6); col.push(color.r, color.g, color.b); }
  }
}
function addBuilding(B, pts, h, colHex, roofHex, shops = false) {
  let area = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; area += x1 * z2 - x2 * z1; }
  const c = new THREE.Color(colHex), rc = new THREE.Color(roofHex);
  let per = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.01) continue;
    let nx = -dz / L, nz = dx / L; if (area > 0) { nx = -nx; nz = -nz; }
    const u0 = per / 14, u1 = (per + L) / 14, v1 = h / 12.4; per += L;
    const hp = h + 0.9, shopRow = shops && B.shop && L > 3.5 && h >= 3, y0 = shopRow ? 3.1 : 0;
    const A = [ax, y0, az, u0, y0 / 12.4], Bv = [bx, y0, bz, u1, y0 / 12.4], C = [bx, hp, bz, u1, hp / 12.4], Dv = [ax, hp, az, u0, hp / 12.4];
    const tri = area > 0 ? [A, C, Bv, A, Dv, C] : [A, Bv, C, A, C, Dv];
    for (const q of tri) { B.pos.push(q[0], q[1], q[2]); B.nor.push(nx, 0, nz); B.uv.push(q[3], q[4]); B.col.push(c.r, c.g, c.b); }
    if (shopRow) { // ground floor = shopfronts (u spans ~4 m per shop)
      const S = B.shop, su0 = per / 32 + Math.random(), su1 = su0 + L / 32;
      const a = [ax, 0, az, su0, 0], b = [bx, 0, bz, su1, 0], cc = [bx, 3.1, bz, su1, 1], d = [ax, 3.1, az, su0, 1];
      for (const q of (area > 0 ? [a, cc, b, a, d, cc] : [a, b, cc, a, cc, d])) { S.pos.push(q[0], q[1], q[2]); S.nor.push(nx, 0, nz); S.uv.push(q[3], q[4]); S.col.push(1, 1, 1); }
    }
  }
  try {
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) {
      const o = area > 0 ? [t[0], t[2], t[1]] : t; // keep roof facing up
      for (const k of o) { B.pos.push(pts[k][0], h, pts[k][1]); B.nor.push(0, 1, 0); B.uv.push(0.01, 0.01); B.col.push(rc.r, rc.g, rc.b); }
    }
  } catch (e) { }
}
// axis box written into a building buffer (rotated by `rot`), used for roof structures and unfinished pillars
function addBox(B, cx, y0, cz, w, h, d, rot, colHex) {
  const c = new THREE.Color(colHex), cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (a, y, b) => [cx + a * cs + b * sn, y, cz - a * sn + b * cs];
  const hw = w / 2, hd = d / 2, y1 = y0 + h;
  const faces = [ // [corners], normal in local space
    [[[-hw, y0, hd], [hw, y0, hd], [hw, y1, hd], [-hw, y1, hd]], [0, 0, 1]], [[[hw, y0, -hd], [-hw, y0, -hd], [-hw, y1, -hd], [hw, y1, -hd]], [0, 0, -1]],
    [[[hw, y0, hd], [hw, y0, -hd], [hw, y1, -hd], [hw, y1, hd]], [1, 0, 0]], [[[-hw, y0, -hd], [-hw, y0, hd], [-hw, y1, hd], [-hw, y1, -hd]], [-1, 0, 0]],
    [[[-hw, y1, hd], [hw, y1, hd], [hw, y1, -hd], [-hw, y1, -hd]], [0, 1, 0]]];
  for (const [q, [nx, ny, nz]] of faces) {
    const v = q.map(([a, y, b]) => P(a, y, b)), wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs;
    for (const k of [0, 1, 2, 0, 2, 3]) { B.pos.push(...v[k]); B.nor.push(wx, ny, wz); B.uv.push(0.01, 0.01); B.col.push(c.r, c.g, c.b); }
  }
}
// Dakar roofs are terraces people live on: a stair hut, black water tanks, dishes, and on houses still being
// built floor by floor, concrete pillar stubs with rebar left sticking out for the next storey ("fers d'attente").
function roofExtras(B, R, pts, h, tall) {
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]), cx = xs.reduce((a, b) => a + b) / xs.length, cz = zs.reduce((a, b) => a + b) / zs.length;
  const span = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  if (span < 5 || !inPoly(cx, cz, pts)) return;
  const [ax, az] = pts[0], [bx, bz] = pts[1], rot = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
  const inside = (x, z) => inPoly(x, z, pts);
  if (Math.random() < (tall ? 0.5 : 0.65)) { // edicule d'escalier
    const t = rand(0.25, 0.55), x = cx + (ax - cx) * t, z = cz + (az - cz) * t;
    if (inside(x, z)) { addBox(B, x, h, z, 2.6, 2.5, 2.8, rot, pick([0xe9e1d0, 0xd8cdb6, 0xf0ebe0])); }
  }
  for (let n = Math.random() < 0.6 ? (Math.random() < 0.3 ? 2 : 1) : 0; n > 0; n--) { const x = cx + rand(-span, span) * 0.25, z = cz + rand(-span, span) * 0.25; if (inside(x, z)) R.tanks.push([x, h, z, Math.random() < 0.8]); }
  if (Math.random() < 0.3) { const p = pick(pts), x = p[0] + (cx - p[0]) * 0.15, z = p[1] + (cz - p[1]) * 0.15; if (inside(x, z)) R.dishes.push([x, h, z, rand(0, 6)]); }
  if (!tall && Math.random() < 0.35) for (const [px, pz] of pts) { // poteaux d'attente
    const L = Math.hypot(cx - px, cz - pz) || 1, x = px + (cx - px) / L * 0.3, z = pz + (cz - pz) / L * 0.3, ph = Math.random() < 0.5 ? rand(0.3, 0.9) : rand(1.2, 2.6);
    addBox(B, x, h, z, 0.26, ph, 0.26, rot, 0xbdb6a8);
    for (const [ox, oz] of [[-0.08, -0.08], [0.08, -0.08], [0.08, 0.08], [-0.08, 0.08]]) R.rebar.push(x + ox, h + ph, z + oz, x + ox + rand(-.12, .12), h + ph + rand(0.5, 1.1), z + oz + rand(-.12, .12));
  }
  if (Math.random() < 0.2) R.lines.push([cx, cz, rot, span, h]); // linge qui seche
}
const TSTEP = 5, TN = CELL / TSTEP + 1;
function vnoise(x, z) { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return (h(ix, iz) * (1 - ux) + h(ix + 1, iz) * ux) * (1 - uz) + (h(ix, iz + 1) * (1 - ux) + h(ix + 1, iz + 1) * ux) * uz; }
function rawHeight(x, z) { // dune field: broad swells + ridges, taller outside the city
  const amp = outsideDakar(x) ? 14 : 6;
  const n = vnoise(x / 260, z / 260) * 0.6 + vnoise(x / 90 + 7, z / 90 - 3) * 0.3 + vnoise(x / 30, z / 30) * 0.1;
  return Math.max(0, n - 0.35) * amp / 0.65;
}
function buildTerrain(group, gx, gz, cols, flats) {
  const H = new Float32Array(TN * TN), x0 = gx * CELL, z0 = gz * CELL;
  const segs = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const sg = segGrid.get(ckey(gx + a, gz + b)); if (sg) for (let j = 0; j < sg.length; j += 2) segs.push(roads[sg[j]], sg[j + 1]); }
  // distance fields stamped only around each road / building (cheap), then relief is faded by them
  const DR = new Float32Array(TN * TN).fill(1e9), DB = new Float32Array(TN * TN).fill(1e9);
  const stamp = (D, minx, maxx, minz, maxz, reach, dist) => {
    const i0 = Math.max(0, Math.floor((minx - reach - x0) / TSTEP)), i1 = Math.min(TN - 1, Math.ceil((maxx + reach - x0) / TSTEP)), j0 = Math.max(0, Math.floor((minz - reach - z0) / TSTEP)), j1 = Math.min(TN - 1, Math.ceil((maxz + reach - z0) / TSTEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = dist(x0 + i * TSTEP, z0 + j * TSTEP), q = j * TN + i; if (d < D[q]) D[q] = d; }
  };
  for (let q = 0; q < segs.length; q += 2) { const r = segs[q], n = segs[q + 1], [ax, az] = r.pts[n], [bx, bz] = r.pts[n + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, hw = r.w / 2;
    stamp(DR, Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz), 70 + hw, (x, z) => { const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1); return Math.hypot(x - ax - dx * t, z - az - dz * t) - hw; }); }
  for (const c of cols) stamp(DB, c.minx, c.maxx, c.minz, c.maxz, 30, (x, z) => Math.hypot(Math.max(c.minx - x, 0, x - c.maxx), Math.max(c.minz - z, 0, z - c.maxz)));
  for (const [fx, fz, fr] of flats) stamp(DB, fx, fx, fz, fz, fr + 30, (x, z) => Math.hypot(x - fx, z - fz) - fr);
  const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  let any = false;
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
    const q = j * TN + i; if (DR[q] < 12 || DB[q] < 4) continue;
    const x = x0 + i * TSTEP, z = z0 + j * TSTEP; let h = rawHeight(x, z); if (h <= 0.01 || isWater(x, z)) continue;
    h *= sm(12, 70, DR[q]) * sm(4, 30, DB[q]); if (h > 0.01) { H[q] = h; any = true; }
  }
  if (!any) return null;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) { const x = x0 + i * TSTEP, z = z0 + j * TSTEP; pos.push(x, H[j * TN + i] + 0.03, z); uv.push(x * 0.075, -z * 0.075); }
  for (let j = 0; j < TN - 1; j++) for (let i = 0; i < TN - 1; i++) { const a = j * TN + i, b = a + 1, c = a + TN, d = c + 1; if (H[a] + H[b] + H[c] + H[d] > 0) idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, ground.material); m.receiveShadow = true; m.castShadow = Q.bshadow; group.add(m);
  return H;
}
// terrain height under any point (0 on roads, in town and wherever no relief was built)
function groundY(x, z) {
  const gx = cellOf(x), gz = cellOf(z), ch = chunks.get(ckey(gx, gz)); if (!ch || !ch.hgrid) return 0;
  const fx = (x - gx * CELL) / TSTEP, fz = (z - gz * CELL) / TSTEP, i = Math.min(TN - 2, Math.floor(fx)), j = Math.min(TN - 2, Math.floor(fz)), u = fx - i, v = fz - j, H = ch.hgrid;
  return (H[j * TN + i] * (1 - u) + H[j * TN + i + 1] * u) * (1 - v) + (H[(j + 1) * TN + i] * (1 - u) + H[(j + 1) * TN + i + 1] * u) * v;
}
function buildChunk(gx, gz) {
  const k = ckey(gx, gz), group = new THREE.Group(), cols = [];
  const R = { pos: [], col: [], uv: [] }, S = { pos: [], col: [], uv: [] }, M = { pos: [], col: [], uv: [] }, SE = [];
  const segs = segGrid.get(k) || [];
  const lamps = [], palms = [], neems = [];
  const sandy = new THREE.Color(0xcfae80), aspA = new THREE.Color(0xd4d2ce), aspB = new THREE.Color(0xe0dbd2), aspC = new THREE.Color(0xc4c4c8), side = new THREE.Color(0xc4b8a2), white = new THREE.Color(1, 1, 1);
  // group consecutive segs of same road
  const byRoad = new Map();
  for (let j = 0; j < segs.length; j += 2) { let a = byRoad.get(segs[j]); if (!a) byRoad.set(segs[j], a = []); a.push(segs[j + 1]); }
  for (const [ri, list] of byRoad) {
    const r = roads[ri]; list.sort((a, b) => a - b);
    const y = 0.16 + (10 - (r.t === 10 ? 2 : r.t)) * 0.012;
    const dirt = (r.t >= 5 && r.t <= 9 && outsideDakar(r.pts[0][0])) || r.t === 9;
    const color = dirt ? sandy : r.t <= 1 ? aspC : r.t <= 4 ? aspA : aspB;
    for (const i of list) {
      ribbon(R.pos, R.col, R.uv, r.pts, i, i + 1, r.w / 2, y, color);
      if (!dirt && r.t >= 1 && r.t <= 8) { const sw = r.t <= 2 ? 0.7 : r.t <= 4 ? 1.3 : rand(1.4, 2.4); sandEdge(SE, r.pts, r.cum, i, r.w / 2 + 0.05, Math.max(0.6, r.w / 2 - sw), y + 0.01); }
      if (r.side > 0.5 && !dirt) ribbon(S.pos, S.col, S.uv, r.pts, i, i + 1, r.w / 2 + r.side, 0.1, side);
      // markings
      if (r.t <= 4 && !dirt) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
        const start = r.cum[i];
        for (let d = Math.ceil(start / 10) * 10 - start; d < L; d += 10) {
          const e = Math.min(d + 4, L), p0 = [ax + ux * d, az + uz * d], p1 = [ax + ux * e, az + uz * e];
          if (!r.ow) ribbon(M.pos, M.col, M.uv, [p0, p1], 0, 1, 0.08, y + 0.02, white);
          else if (r.w > 7) ribbon(M.pos, M.col, M.uv, [[p0[0] - uz * 0.1, p0[1] + ux * 0.1], [p1[0] - uz * 0.1, p1[1] + ux * 0.1]], 0, 1, 0.07, y + 0.02, white);
        }
        if (r.t <= 1) for (const s of [1, -1]) { const o = r.w / 2 - 0.4; ribbon(M.pos, M.col, M.uv, [[ax - uz * o * s, az + ux * o * s], [bx - uz * o * s, bz + ux * o * s]], 0, 1, 0.09, y + 0.02, white); }
      }
      // props along segment
      if (r.t <= 3 && Math.random() < 0.55) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], f = Math.random(), x = ax + (bx - ax) * f, z = az + (bz - az) * f, h = Math.atan2(bx - ax, bz - az), s = Math.random() < 0.5 ? 1 : -1, off = r.w / 2 + Math.max(0.6, r.side - 0.5);
        const px = x - Math.cos(h) * off * s, pz = z + Math.sin(h) * off * s;
        if (!isWater(px, pz)) lamps.push([px, pz, h + (s > 0 ? Math.PI / 2 : -Math.PI / 2)]);
        if (!outsideDakar(x) && Math.random() < 0.5) { const qx = x + Math.cos(h) * (off + 1.5) * s, qz = z - Math.sin(h) * (off + 1.5) * s; const q = clearOfRoads(qx, qz, -1.2); if (q && !isWater(q[0], q[1])) palms.push(q); }
      }
      if (r.t >= 3 && r.t <= 7 && Math.random() < (outsideDakar(r.pts[i][0]) ? 0.3 : 0.22)) {
        const [ax, az] = r.pts[i], s = Math.random() < 0.5 ? 1 : -1; const q = clearOfRoads(ax + s * (r.w / 2 + 4), az + rand(-5, 5), 2); if (q) neems.push(q);
      }
    }
  }
  const mk = (G, mat, idx) => { if (!G.pos.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m); };
  mk(S, sideMat); mk(R, roadMat); mk(M, markMat);
  if (SE.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(SE.flatMap(q => [q[0], q[4], q[1]]), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(SE.flatMap(q => [q[2], q[3]]), 2)); g.computeVertexNormals(); const m = new THREE.Mesh(g, sandEdgeMat); m.receiveShadow = true; m.renderOrder = 1; group.add(m); }

  // buildings: OSM
  const B = { pos: [], nor: [], uv: [], col: [], shop: { pos: [], nor: [], uv: [], col: [] } }, RF = { tanks: [], dishes: [], rebar: [], lines: [] };
  const ids = bGrid.get(k) || [];
  for (const bi of ids) {
    const [lv, kind, flat] = D.buildings[bi]; const pts = []; let x = 0, z = 0;
    for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; pts.push([x, z]); }
    if (kind !== 1) { // OSM footprints and road widths disagree: pull walls back behind the sidewalk
      let moved = 0;
      for (const q of pts) for (let it = 0; it < 3; it++) { const ov = roadOverlap(q[0], q[1]); if (!ov) break; if (ov.o > 6) { moved = -1e9; break; } q[0] += ov.px * ov.o; q[1] += ov.pz * ov.o; moved++; }
      if (moved < 0) continue;
      let ar = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; ar += x1 * z2 - x2 * z1; } if (Math.abs(ar) < 12) continue;
    }
    let h;
    if (kind === 1) h = 11; else if (lv) h = lv * 3.1; else h = isPlateau(x, z) ? 3.1 * ((rand(2, 9)) | 0) : outsideDakar(x) ? 3.1 * (Math.random() < 0.7 ? 1 : 2) : 3.1 * ((rand(1, 4)) | 0);
    addBuilding(B, pts, h, kind === 1 ? 0xf4f1ea : pick(FACADE), 0xb9b0a0, kind !== 1 && Math.random() < (isPlateau(x, z) ? 0.8 : 0.45));
    if (kind !== 1 && !isPlateau(x, z)) roofExtras(B, RF, pts, h, h > 13);
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    cols.push({ pts, minx: Math.min(...xs), maxx: Math.max(...xs), minz: Math.min(...zs), maxz: Math.max(...zs) });
    if (kind === 1) { // minaret on mosques, height from footprint size
      let area = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; area += x1 * z2 - x2 * z1; } area = Math.abs(area / 2);
      if (area > 300) addMinaret(group, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2, clamp(Math.sqrt(area) * 0.9, 18, 87), area);
    }
  }
  // procedural houses where OSM has no buildings
  if (ids.length < 12) {
    const occ = new Set();
    for (const [ri, list] of byRoad) {
      const r = roads[ri]; if (r.t < 2 || r.t > 7) continue;
      for (const i of list) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
        const dense = !outsideDakar(ax) || nearTown(ax, az);
        if (!dense && Math.random() < 0.85) continue;
        for (let d = rand(2, 6); d < L - 4; d += rand(9, 14)) for (const s of [1, -1]) {
          if (Math.random() < 0.18) continue;
          const real = Math.random() < 0.22 ? (Math.random() < 0.8 ? 'maison' : 'maisonbasket') : null;
          const wAlong = real ? PROP_CFG[real].len : rand(7, 12), depth = real ? PROP_CFG[real].len * 0.8 : rand(8, 13), off = r.w / 2 + r.side + 0.8 + depth / 2;
          const cx = ax + ux * d - uz * off * s, cz = az + uz * d + ux * off * s;
          const ok = (() => { const okey = Math.round(cx / 6) + ',' + Math.round(cz / 6); if (occ.has(okey)) return false;
            if (isWater(cx, cz) || roadOverlap(cx, cz)) return false;
            for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1]]) { const hx = a * wAlong / 2, hz = b * depth / 2; if (roadOverlap(cx + ux * hx - uz * hz, cz + uz * hx + ux * hz)) return false; }
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) occ.add((Math.round(cx / 6) + a) + ',' + (Math.round(cz / 6) + b)); return true; })();
          if (!ok) continue;
          const hw = wAlong / 2, hd = depth / 2, pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [cx + ux * a - uz * b, cz + uz * a + ux * b]);
          const fl = outsideDakar(cx) ? (Math.random() < 0.75 ? 1 : 2) : ((rand(1, 4.5)) | 0);
          const faceRoad = Math.atan2(uz * s, -ux * s); // model front (+z) toward the road
          if (real && PROPS[real]) placeProp(group, real, cx, cz, faceRoad);
          else { addBuilding(B, pts, fl * 3.1, pick(FACADE), 0xb5ab9a, Math.random() < 0.5); roofExtras(B, RF, pts, fl * 3.1, false); }
          const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
          cols.push({ pts, minx: Math.min(...xs), maxx: Math.max(...xs), minz: Math.min(...zs), maxz: Math.max(...zs) });
          // street life: kiosks, coffee carts, fruit carts on the sidewalk
          if (Math.random() < 0.1) { const pn = pick(['kiosque_om', 'kiosque_om', 'cafe', 'fruitcart']); if (PROPS[pn]) placeProp(group, pn, ax + ux * d - uz * (r.w / 2 + r.side * 0.6) * s, az + uz * d + ux * (r.w / 2 + r.side * 0.6) * s, faceRoad); }
        }
      }
    }
  }
  if (B.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    const m = new THREE.Mesh(g, bldMat); m.castShadow = Q.bshadow; m.receiveShadow = Q.shadow > 0; group.add(m);
  }
  if (B.shop.pos.length) {
    const g = new THREE.BufferGeometry(), S = B.shop;
    g.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(S.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(S.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(S.col, 3));
    group.add(new THREE.Mesh(g, shopMat));
  }
  // instanced props
  const inst = (geo, mat, list, fn, shadow = true) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); const o = new THREE.Object3D(); list.forEach((p, i) => { fn(o, p); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.castShadow = shadow; group.add(im); return im; };
  { // toits : citernes, paraboles, fers d'attente, linge
    const tk = inst(G.tank, tankMat, RF.tanks, (o, [x, y, z]) => { o.position.set(x, y, z); o.rotation.set(0, rand(0, 6), 0); const k = rand(0.85, 1.15); o.scale.set(k, k, k); }, Q.bshadow);
    if (tk) { const c = new THREE.Color(); RF.tanks.forEach((t, i) => tk.setColorAt(i, c.set(t[3] ? 0x1c1c1e : pick([0xe8e8e2, 0x3d6fb0, 0xd9c48a])))); }
    inst(G.dish, dishMat, RF.dishes, (o, [x, y, z, r]) => { o.position.set(x, y, z); o.rotation.set(0, r, 0); o.scale.set(1, 1, 1); }, false);
    if (RF.rebar.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(RF.rebar, 3)); group.add(new THREE.LineSegments(g, rebarMat)); }
    const cloth = [], rope = [];
    for (const [cx, cz, rot, span, h] of RF.lines) { const L = Math.min(span * 0.7, 7), ux = Math.sin(rot + Math.PI / 2), uz = Math.cos(rot + Math.PI / 2), y = h + 1.7;
      rope.push(cx - ux * L / 2, y, cz - uz * L / 2, cx + ux * L / 2, y, cz + uz * L / 2);
      for (let d = -L / 2 + 0.5; d < L / 2 - 0.4; d += rand(0.7, 1.2)) cloth.push([cx + ux * d, y, cz + uz * d, rot]); }
    if (rope.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3)); group.add(new THREE.LineSegments(g, wireMat)); }
    const cl = inst(G.cloth, clothMat, cloth, (o, [x, y, z, r]) => { o.position.set(x, y, z); o.rotation.set(0, r + Math.PI / 2, 0); o.scale.set(rand(0.7, 1.3), rand(0.7, 1.5), 1); }, false);
    if (cl) { const c = new THREE.Color(); cloth.forEach((_, i) => cl.setColorAt(i, c.set(pick(BOUBOU)))); }
  }
  inst(G.pole, poleMat, lamps, (o, [x, z, h]) => { o.position.set(x, 0, z); o.rotation.set(0, h, 0); o.scale.set(1, 1, 1); });
  inst(G.lamp, lampMat, lamps, (o, [x, z, h]) => { o.position.set(x, 0, z); o.rotation.set(0, h, 0); }, false);
  inst(G.glow, glowMat, lamps, (o, [x, z, h]) => { o.position.set(x + Math.sin(h) * 2.2, 0.35, z + Math.cos(h) * 2.2); o.rotation.set(-Math.PI / 2, 0, 0); }, false);
  { // wooden power poles (Senelec) with 3 sagging cables, one side of residential streets
    const poles = [], wire = [];
    for (const [ri, list] of byRoad) {
      const r = roads[ri]; if (r.t < 3 || r.t > 7 || r.w > 14) continue;
      const side = (ri & 1) ? 1 : -1, off = r.w / 2 + Math.max(0.6, r.side - 0.4); let prev = null;
      for (const i of list) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue; const ux = (bx - ax) / L, uz = (bz - az) / L;
        for (let d = (32 - (r.cum[i] % 32)) % 32; d < L; d += 32) {
          const x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
          if (isWater(x, z) || roadOverlap(x, z, -0.6)) { prev = null; continue; }
          const h = Math.atan2(ux, uz), cur = { x, z, h, ux: -uz, uz: ux }; poles.push(cur);
          if (prev && Math.hypot(x - prev.x, z - prev.z) < 45) for (const k of [-0.75, 0, 0.75]) {
            const kk = k === 0 ? 0 : k, y = k === 0 ? 9.15 : 8.6, sag = 0.9;
            const p0 = [prev.x + prev.ux * kk, prev.z + prev.uz * kk], p1 = [x + cur.ux * kk, z + cur.uz * kk];
            for (let n = 0; n < 8; n++) for (const t of [n / 8, (n + 1) / 8]) wire.push(p0[0] + (p1[0] - p0[0]) * t, y - sag * 4 * t * (1 - t), p0[1] + (p1[1] - p0[1]) * t);
          }
          prev = cur;
        }
      }
    }
    inst(G.upole, woodPoleMat, poles, (o, p) => { o.position.set(p.x, 0, p.z); o.rotation.set(rand(-.02, .02), p.h, rand(-.03, .03)); o.scale.set(1, 1, 1); });
    if (wire.length) { const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3)); group.add(new THREE.LineSegments(wg, wireMat)); }
  }
  { const bushes = []; for (let t = 0; t < 70; t++) { const x = (gx + Math.random()) * CELL, z = (gz + Math.random()) * CELL;
      if (!isWater(x, z) && !roadOverlap(x, z, 1.5) && !cols.some(c => x > c.minx - 1 && x < c.maxx + 1 && z > c.minz - 1 && z < c.maxz + 1)) bushes.push([x, z]); }
    inst(G.bush, bushMat, bushes, (o, [x, z]) => { o.position.set(x, 0.3, z); o.rotation.set(0, rand(0, 6), 0); const k = rand(0.5, 1.4); o.scale.set(k, k * rand(.5, .8), k); }); }
  { const tufts = [], n = outsideDakar(gx * CELL) ? 420 : 260;
    for (const [ri, list] of byRoad) { const r = roads[ri]; for (const i of list) { if (tufts.length > n) break; const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      for (let k = 0; k < 4; k++) { const f = Math.random(), sd = Math.random() < .5 ? 1 : -1, L = Math.hypot(bx - ax, bz - az) || 1, off = r.w / 2 + rand(2.5, 9);
        const x = ax + (bx - ax) * f - (bz - az) / L * off * sd, z = az + (bz - az) * f + (bx - ax) / L * off * sd;
        if (!isWater(x, z) && !roadOverlap(x, z, 0.3) && !cols.some(c => x > c.minx && x < c.maxx && z > c.minz && z < c.maxz)) tufts.push([x, z]); } } }
    const gm = inst(G.grass, grassMat, tufts, (o, [x, z]) => { o.position.set(x, 0.05, z); o.rotation.set(0, rand(0, 6), 0); const s = rand(0.7, 1.6); o.scale.set(s, s * rand(.8, 1.3), s); }, false); if (gm) gm.receiveShadow = true; }
  const flats = [];
  if (Math.random() < (outsideDakar(gx * CELL) ? 0.15 : 0.35)) for (let tries = 0; tries < 12; tries++) {
    const cx = (gx + Math.random()) * CELL, cz = (gz + Math.random()) * CELL, rot = Math.random() * Math.PI, W = 22, Lp = 38, c = Math.cos(rot), sn = Math.sin(rot);
    const corners = [[-W / 2 - 3, -Lp / 2 - 3], [W / 2 + 3, -Lp / 2 - 3], [W / 2 + 3, Lp / 2 + 3], [-W / 2 - 3, Lp / 2 + 3], [0, 0]].map(([a, b]) => [cx + a * c + b * sn, cz - a * sn + b * c]);
    if (corners.some(([x, z]) => isWater(x, z) || roadOverlap(x, z, 1) || cols.some(q => x > q.minx - 2 && x < q.maxx + 2 && z > q.minz - 2 && z < q.maxz + 2))) continue;
    flats.push([cx, cz, 30]);
    const pg = new THREE.Group(); pg.position.set(cx, 0, cz); pg.rotation.y = rot; group.add(pg);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(W + 4, Lp + 4), pitchMat); f.rotation.x = -Math.PI / 2; f.position.y = 0.07; f.receiveShadow = true; pg.add(f);
    for (const sz of [-1, 1]) { const gl = new THREE.Mesh(G.goal, poleMat); gl.position.z = sz * Lp / 2; pg.add(gl); }
    const kit = [pick([0x1e8f4a, 0xd62828, 0x1d4ed8]), pick([0xf2c200, 0xffffff, 0x111111])];
    for (let i = 0; i < 10; i++) { const pl = new THREE.Mesh(G.player, new THREE.MeshStandardMaterial({ color: kit[i & 1], roughness: .8 })); pl.position.set(rand(-W / 2 + 1, W / 2 - 1), 0, rand(-Lp / 2 + 2, Lp / 2 - 2)); pl.castShadow = true; pl.userData.ph = Math.random() * 6; pl.userData.ck = k; pg.add(pl); players.push(pl); }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff })); ball.position.set(0, 0.22, 0); pg.add(ball); players.push(ball); ball.userData.ball = 1; ball.userData.ck = k; ball.userData.ph = Math.random() * 6;
    break;
  }
  { // trees: never inside a building, on a lamp post or on top of each other; trunks are solid
    const placed = [], fit = (list, crown, gap) => list.filter(([x, z]) => {
      if (cols.some(c => x > c.minx - crown && x < c.maxx + crown && z > c.minz - crown && z < c.maxz + crown)) return false;
      if (lamps.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < 2.5) || placed.some(([px, pz, pr]) => Math.hypot(px - x, pz - z) < pr + gap)) return false;
      placed.push([x, z, gap]); return true; });
    palms.splice(0, palms.length, ...fit(palms, 1.2, 3)); neems.splice(0, neems.length, ...fit(neems, 2.5, 4.5));
    for (const [x, z] of [...palms, ...neems]) { const r = 0.35, pts = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]]; cols.push({ pts, minx: x - r, maxx: x + r, minz: z - r, maxz: z + r }); }
  }
  inst(G.trunk, palmTrunkMat, palms, (o, [x, z]) => { o.position.set(x, 0, z); o.rotation.set(rand(-.08, .08), rand(0, 6), rand(-.08, .08)); const s = rand(0.8, 1.25); o.scale.set(s, s, s); });
  inst(G.crown, leafMat, palms, (o, [x, z]) => { o.position.set(x, 0, z); o.rotation.set(0, rand(0, 6), 0); const s = rand(0.85, 1.2); o.scale.set(s, s, s); });
  inst(G.neemT, palmTrunkMat, neems, (o, [x, z]) => { o.position.set(x, 0, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); });
  inst(G.neem, neemMat, neems, (o, [x, z]) => { o.position.set(x, 4.2, z); o.rotation.set(rand(0, 3), rand(0, 3), 0); const s = rand(0.8, 1.4); o.scale.set(s, s * 0.8, s); });
  {
    const parked = [], stalls = [], piles = [];
    for (const [ri, list] of byRoad) {
      const r = roads[ri]; if (r.t < 2 || r.t > 7) continue;
      const city = !outsideDakar(r.pts[0][0]) || nearTown(r.pts[0][0], r.pts[0][1]);
      for (const i of list) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), h = Math.atan2(bx - ax, bz - az), cs = Math.cos(h), sn = Math.sin(h);
        for (let d = rand(3, 9); d < L - 3; d += rand(7, 16)) {
          const sd = Math.random() < 0.5 ? 1 : -1, x = ax + (bx - ax) * d / L, z = az + (bz - az) * d / L;
          if (r.t >= 4 && city && Math.random() < 0.35) { const o = r.w / 2 - 1.1; parked.push([x - cs * o * sd, z + sn * o * sd, h + (Math.random() < 0.5 ? 0 : Math.PI)]); }
          else if (r.t <= 4 && city && Math.random() < 0.12) { const o = r.w / 2 + Math.max(1.5, r.side * 0.75); stalls.push([x - cs * o * sd, z + sn * o * sd, h]); }
          else if (Math.random() < 0.05) { const o = r.w / 2 + 0.8; piles.push([x - cs * o * sd, z + sn * o * sd]); }
        }
      }
    }
    const ok = l => l.filter(p => !isWater(p[0], p[1]));
    const pk = ok(parked); for (const [x, z, h] of pk) { const c = Math.cos(h), n = Math.sin(h), pts = [[-0.9, -2.1], [0.9, -2.1], [0.9, 2.1], [-0.9, 2.1]].map(([u, v]) => [x + u * c + v * n, z - u * n + v * c]); const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]); cols.push({ pts, minx: Math.min(...xs), maxx: Math.max(...xs), minz: Math.min(...zs), maxz: Math.max(...zs) }); } const cb = inst(G.carBody, parkedMat, pk, (o, [x, z, h]) => { o.position.set(x, 0, z); o.rotation.set(0, h, 0); o.scale.set(1, 1, 1); });
    if (cb) { const PC = [0xf2c200, 0xf2c200, 0xeeeeee, 0x9aa0a6, 0x1d1f22, 0x7a1b1b, 0x1f3d6b, 0xd9d2c2], c = new THREE.Color(); pk.forEach((_, i) => cb.setColorAt(i, c.set(pick(PC)))); }
    inst(G.carTop, glassMat, pk, (o, [x, z, h]) => { o.position.set(x, 0, z); o.rotation.set(0, h, 0); });
    inst(G.stall, stallMat, ok(stalls), (o, [x, z, h]) => { o.position.set(x, 0, z); o.rotation.set(0, h, 0); o.scale.set(1, 1, 1); });
    const st = ok(stalls); const pa = inst(G.parasol, parasolMat, st, (o, [x, z, h]) => { o.position.set(x, 0, z); o.rotation.set(0, h + rand(0, 1), 0); const k = rand(0.9, 1.2); o.scale.set(k, 1, k); });
    if (pa) { const c = new THREE.Color(); st.forEach((_, i) => pa.setColorAt(i, c.set(pick([0xd8432f, 0x2a7fd4, 0xf2b01e, 0x2f9e54, 0xffffff])))); }
    inst(G.pile, sandPileMat, ok(piles), (o, [x, z]) => { o.position.set(x, 0, z); o.rotation.set(0, rand(0, 6), 0); const k = rand(0.6, 1.4); o.scale.set(k, k * 0.7, k); }, false);
  }
  // traffic lights
  const sl = sigGrid.get(k) || [];
  const tlObjs = [];
  for (const si of sl) { const s = signals[si]; tlObjs.push(makeTrafficLight(group, s)); }
  const hgrid = buildTerrain(group, gx, gz, cols, flats);
  scene.add(group);
  colliders.set(k, cols);
  return { k, group, tl: tlObjs, hgrid };
}
function nearTown(x, z) { for (const p of places) if (Math.abs(p.x - x) < 1500 && Math.abs(p.z - z) < 1500) return true; return false; }
const G = (() => {
  const pole = mergeGeometries([new THREE.CylinderGeometry(0.09, 0.13, 8, 6).translate(0, 4, 0), new THREE.BoxGeometry(0.08, 0.08, 2.4).translate(0, 7.9, 1.1)]);
  const lamp = new THREE.BoxGeometry(0.35, 0.12, 0.8).translate(0, 7.82, 2.2);
  const grass = (() => { const pos = [], col = []; for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, r = Math.random() * 0.35, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.35 + Math.random() * 0.55, lx = Math.cos(a + 1.57) * 0.04, lz = Math.sin(a + 1.57) * 0.04, tx = x + Math.cos(a) * h * 0.35, tz = z + Math.sin(a) * h * 0.35;
      pos.push(x - lx, 0, z - lz, x + lx, 0, z + lz, tx, h, tz); col.push(.2, .28, .1, .2, .28, .1, .62, .58, .3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g; })();
  const upole = mergeGeometries([new THREE.CylinderGeometry(0.11, 0.16, 9.4, 6).translate(0, 4.7, 0), new THREE.BoxGeometry(1.8, 0.12, 0.12).translate(0, 8.55, 0),
    ...[-0.75, 0.75].map(k => new THREE.CylinderGeometry(0.05, 0.05, 0.16, 5).translate(k, 8.69, 0)), new THREE.CylinderGeometry(0.05, 0.05, 0.16, 5).translate(0, 9.45, 0)]);
  const glow = new THREE.PlaneGeometry(9, 9);
  const trunk = new THREE.CylinderGeometry(0.2, 0.32, 9, 7).translate(0, 4.5, 0);
  const leaves = []; for (let i = 0; i < 9; i++) { const l = new THREE.PlaneGeometry(0.9, 4.2, 1, 3); const p = l.attributes.position; for (let j = 0; j < p.count; j++) { const yy = p.getY(j) + 2.1; p.setZ(j, -0.09 * yy * yy); p.setY(j, yy); } l.rotateX(-Math.PI / 2.6); l.rotateY(i / 9 * Math.PI * 2); l.translate(0, 9, 0); leaves.push(l); }
  const crown = mergeGeometries(leaves);
  const neemT = new THREE.CylinderGeometry(0.25, 0.4, 4.5, 6).translate(0, 2.25, 0);
  const neem = new THREE.IcosahedronGeometry(3, 1);
  // parked cars: a sedan side profile (Peugeot 405 / Corolla shape) extruded across, glass and wheels apart
  const profile = (pts, depth, bevel) => { const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 }); g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0); return g; };
  const carBody = profile([[-2.12, 0.34], [2.1, 0.34], [2.14, 0.7], [1.98, 0.84], [0.95, 0.97], [0.32, 1.4], [-0.95, 1.42], [-1.62, 1.0], [-2.1, 0.96]], 1.66, 0.05);
  const carTop = mergeGeometries([profile([[0.9, 0.99], [0.32, 1.38], [-0.93, 1.4], [-1.57, 1.02]], 1.74, 0).translate(0, 0.005, 0),
    ...[[-0.8, 1.32], [0.8, 1.32], [-0.8, -1.38], [0.8, -1.38]].map(([x, z]) => new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12).rotateZ(Math.PI / 2).translate(x, 0.33, z).toNonIndexed())]);
  const stall = mergeGeometries([new THREE.BoxGeometry(2.2, 0.9, 1.2).translate(0, 0.45, 0), new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5).translate(0, 1.2, 0)]);
  const parasol = new THREE.ConeGeometry(1.6, 0.6, 8, 1, true).translate(0, 2.5, 0);
  const pile = new THREE.ConeGeometry(1, 0.8, 7).translate(0, 0.4, 0);
  const goal = mergeGeometries([new THREE.CylinderGeometry(0.06, 0.06, 2, 6).translate(-2.5, 1, 0), new THREE.CylinderGeometry(0.06, 0.06, 2, 6).translate(2.5, 1, 0), new THREE.CylinderGeometry(0.06, 0.06, 5, 6).rotateZ(Math.PI / 2).translate(0, 2, 0)]);
  const player = mergeGeometries([new THREE.CapsuleGeometry(0.22, 0.8, 3, 8).translate(0, 0.85, 0), new THREE.SphereGeometry(0.15, 8, 6).translate(0, 1.55, 0)]);
  const bush = new THREE.IcosahedronGeometry(1.1, 1);
  // citerne polyethylene noire (forme "Polytank" : cylindre nervure + couvercle)
  const tank = mergeGeometries([new THREE.CylinderGeometry(0.55, 0.5, 1.25, 12).translate(0, 0.78, 0), new THREE.CylinderGeometry(0.22, 0.3, 0.16, 10).translate(0, 1.48, 0), new THREE.BoxGeometry(0.9, 0.15, 0.9).translate(0, 0.08, 0)]);
  const dish = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5).translate(0, 0.45, 0), new THREE.SphereGeometry(0.42, 10, 5, 0, Math.PI * 2, 0, 0.9).rotateX(-1.2).translate(0, 0.95, 0.12)]);
  const cloth = new THREE.PlaneGeometry(0.55, 0.75).translate(0, -0.38, 0);
  return { tank, dish, cloth, pole, upole, grass, bush, goal, player, lamp, glow, trunk, crown, neemT, neem, carBody, carTop, stall, parasol, pile };
})();
function addMinaret(group, x, z, h, area) {
  const white = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.7 }), green = new THREE.MeshStandardMaterial({ color: 0x2f8f5a, roughness: 0.4, metalness: 0.2 });
  const m = new THREE.Group(); m.position.set(x, 0, z);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.045, h, 10), white); shaft.position.y = h / 2; shaft.castShadow = true; m.add(shaft);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.06, h * 0.06, h * 0.02, 12), white); ring.position.y = h * 0.82; m.add(ring);
  const top = new THREE.Mesh(new THREE.ConeGeometry(h * 0.04, h * 0.08, 10), green); top.position.y = h + h * 0.04; m.add(top);
  if (area > 3000) { const dome = new THREE.Mesh(new THREE.SphereGeometry(Math.sqrt(area) * 0.12, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), green); dome.position.set(Math.sqrt(area) * 0.25, 11, 0); m.add(dome); }
  group.add(m);
}
const tlMats = {}; // shared lamp materials by state
for (const c of ['r', 'y', 'g']) { tlMats[c + '1'] = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: { r: 0xff2a1a, y: 0xffb000, g: 0x22ff66 }[c], emissiveIntensity: 4 }); tlMats[c + '0'] = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }); }
function makeTrafficLight(group, s) {
  const objs = [];
  for (const [dx, dz, axisRot] of [[1, 1, 0], [-1, -1, Math.PI], [1, -1, Math.PI / 2], [-1, 1, -Math.PI / 2]]) {
    const o = 7, h = s.ref + axisRot;
    const q = clearOfRoads(s.x + (Math.cos(s.ref) * dx + Math.sin(s.ref) * dz) * o, s.z + (-Math.sin(s.ref) * dx + Math.cos(s.ref) * dz) * o, -1.4);
    if (!q || isWater(q[0], q[1])) continue; const [x, z] = q;
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = h + Math.PI;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), poleMat); pole.position.y = 2.1; g.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.25, 0.32), new THREE.MeshStandardMaterial({ color: 0x151515 })); head.position.y = 4.6; g.add(head);
    const lamps = {}; ['r', 'y', 'g'].forEach((c, i) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), tlMats[c + '0']); l.position.set(0, 5.0 - i * 0.38, 0.17); g.add(l); lamps[c] = l; });
    group.add(g); objs.push({ s, lamps, heading: h });
  }
  return objs;
}
function updateTrafficLightVisuals() {
  for (const ch of chunks.values()) for (const list of ch.tl) for (const o of list) {
    const st = o.s.hacked > time ? (Math.floor(time * 4) % 2 ? 'r' : 'y') : signalState(o.s, o.heading);
    for (const c of ['r', 'y', 'g']) o.lamps[c].material = tlMats[c + (c === st ? '1' : '0')];
  }
}
let buildQueue = [];
function updateChunks(px, pz) {
  const R = Q.radius, gx = cellOf(px), gz = cellOf(pz), want = new Set();
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) if (a * a + b * b <= R * R + 1) want.add(ckey(gx + a, gz + b));
  for (const [k, ch] of chunks) if (!want.has(k)) { scene.remove(ch.group); ch.group.traverse(o => { if (o.geometry && !Object.values(G).includes(o.geometry)) o.geometry.dispose(); }); chunks.delete(k); colliders.delete(k); for (let i = players.length - 1; i >= 0; i--) if (players[i].userData.ck === k) players.splice(i, 1); }
  buildQueue = [];
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) { const k = ckey(gx + a, gz + b); if (want.has(k) && !chunks.has(k)) buildQueue.push([gx + a, gz + b, a * a + b * b]); }
  buildQueue.sort((p, q) => p[2] - q[2]);
}
function processQueue(n = 2) { for (let i = 0; i < n && buildQueue.length; i++) { const [gx, gz] = buildQueue.shift(); const k = ckey(gx, gz); if (!chunks.has(k)) chunks.set(k, buildChunk(gx, gz)); } }

// landmarks
function landmarks() {
  // Monument de la Renaissance africaine (Mamelles)
  const [mx, mz] = ll(14.7221, -17.4950);
  const g = new THREE.Group(); g.position.set(mx, 0, mz); scene.add(g);
  const hill = new THREE.Mesh(new THREE.ConeGeometry(160, 55, 24), new THREE.MeshStandardMaterial({ color: 0xa88f63, roughness: 1, flatShading: true })); hill.position.y = 27; g.add(hill);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5a3c22, metalness: 0.85, roughness: 0.35 });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 6, 8), new THREE.MeshStandardMaterial({ color: 0xd8cfbf })); ped.position.y = 57; g.add(ped);
  const fig = (r, h, x, y, z, rx, rz) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 6, 10), bronze); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); return m; };
  fig(3.2, 22, 0, 75, 0, 0.05, 0.12); fig(2.2, 6, -1.5, 92, 0, 0, 0.2); fig(2.8, 18, 5, 72, 3, -0.15, -0.35);
  fig(1.1, 12, -6, 94, 0, 0, 0.6); fig(1.6, 5, -9, 100, 0, 0, 0.3);
  const [lx, lz] = ll(14.7253, -17.5019); // phare des Mamelles
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 18, 10), new THREE.MeshStandardMaterial({ color: 0xffffff })); tower.position.set(lx, 58, lz); scene.add(tower);
  const hill2 = hill.clone(); hill2.position.set(lx, 25, lz); hill2.scale.setScalar(0.7); scene.add(hill2);
}

// ---------------- Models ----------------
const loader = new GLTFLoader(); const draco = new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/'); loader.setDRACOLoader(draco);
const CAR_CFG = {
  ferrari:    { len: 4.5, w: 1.95, flip: true,  body: /Body_Color|body/i, label: 'Ferrari 458', vmax: 88 },
  audis4:     { len: 4.5, w: 1.85, body: /^body$/i, label: 'Audi S4', vmax: 72 },
  etron:      { len: 4.99, w: 1.97, body: /CarPaint/i, label: 'Audi e-tron GT', vmax: 75 },
  peugeot405: { len: 4.4, w: 1.72, body: /405_Body/i, hide: /Collision|Shadow/i, label: 'Peugeot 405', vmax: 52 },
  corolla:    { len: 4.3, w: 1.78, label: 'Toyota Corolla', vmax: 50 },
  pickup404:  { len: 4.5, w: 1.75, label: 'Peugeot 404 pick-up', vmax: 40 },
  carrapide:  { len: 5.8, w: 2.25, label: 'Car rapide', vmax: 32 },
  carrapide2: { len: 5.8, w: 2.25, flip: true, label: 'Car rapide', vmax: 32 },
  police:     { len: 4.9, w: 1.9, flip: true, body: /Bodymat/i, label: 'Police', vmax: 60 },
  busddd:     { len: 11, w: 2.55, flip: true, label: 'Bus DDD', vmax: 24 },
  bustata:    { len: 9, w: 2.5, label: 'Bus Tata', vmax: 24 },
  ndiaga:     { len: 7, w: 2.35, flip: true, label: 'Ndiaga Ndiaye', vmax: 26 },
  taxisn:     { len: 4.3, w: 1.75, flip: true, label: 'Taxi', vmax: 50 },
  clando:     { len: 4.4, w: 1.8, label: 'Clando', vmax: 45 },
  tricycle:   { len: 3.0, w: 1.3, label: 'Tricycle', vmax: 18 },
  mercedes:   { len: 4.5, w: 1.72, label: 'Mercedes 190E', vmax: 55 },
  civic:      { len: 4.1, w: 1.8, label: 'Honda Civic', vmax: 55 },
};
const PROP_CFG = { kiosque_om: { len: 2.6 }, cafe: { len: 2.4 }, fruitcart: { len: 2.4 }, maison: { len: 13 }, maisonbasket: { len: 18 } };
const MODELS = {}, PROPS = {};
function normalize(root, cfg) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3());
  const rot = (size.x > size.z ? Math.PI / 2 : 0) + (cfg.flip ? Math.PI : 0);
  const R = new THREE.Matrix4().makeRotationY(rot);
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (cfg.hide && cfg.hide.test(mat.name || '')) return;
    let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(R);
    if (g.index) g = g.toNonIndexed();
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let e = byMat.get(mat); if (!e) byMat.set(mat, e = []); e.push(g);
  });
  const out = new THREE.Group(); const b2 = new THREE.Box3();
  const meshes = [];
  for (const [mat, list] of byMat) { const g = mergeGeometries(list); if (!g) continue; g.computeBoundingBox(); b2.union(g.boundingBox); const m = new THREE.Mesh(g, mat); m.castShadow = true; meshes.push(m); }
  const s2 = b2.getSize(new THREE.Vector3()), c = b2.getCenter(new THREE.Vector3()), sc = cfg.len / Math.max(s2.x, s2.z);
  // some models are far too wide for their length (open doors, mirrors, bad export): squeeze width to the real vehicle
  const sx = cfg.w && s2.x * sc > cfg.w ? cfg.w / s2.x : sc;
  for (const m of meshes) { m.geometry.translate(-c.x, -b2.min.y, -c.z); m.geometry.scale(sx, sc, sc); out.add(m); if (cfg.body && cfg.body.test(m.material.name || '')) m.userData.body = true; }
  out.userData.size = new THREE.Vector3(s2.x * sx, s2.y * sc, s2.z * sc);
  return out;
}
function makeCar(name, color) {
  const tpl = MODELS[name] || MODELS.peugeot405; const g = tpl.clone();
  if (color != null) g.traverse(o => { if (o.isMesh && o.userData.body) { o.material = o.material.clone(); o.material.color.set(color); if (o.material.map && name !== 'police') o.material.map = null; o.material.roughness = 0.35; o.material.metalness = 0.4; } });
  g.userData.cfg = CAR_CFG[name] || CAR_CFG.peugeot405; g.userData.model = name; scene.add(g); return g;
}
function placeProp(group, name, x, z, h) { const m = PROPS[name].clone(); m.position.set(x, 0, z); m.rotation.y = h; group.add(m); }
let soldier = null;
async function loadAll(progress) {
  const names = Object.keys(CAR_CFG), props = Object.keys(PROP_CFG); let done = 0; const total = names.length + props.length + 1;
  const tick = () => progress(++done / total);
  await Promise.all([
    ...names.map(n => loader.loadAsync(`models/${n}.glb`).then(g => { MODELS[n] = normalize(g.scene, CAR_CFG[n]); }).catch(e => console.warn('model', n, e)).finally(tick)),
    ...props.map(n => loader.loadAsync(`models/${n}.glb`).then(g => { PROPS[n] = normalize(g.scene, PROP_CFG[n]); }).catch(e => console.warn('prop', n, e)).finally(tick)),
    loader.loadAsync('models/Soldier.glb').then(g => { soldier = g; }).catch(e => console.warn(e)).finally(tick),
  ]);
}

// ---------------- Player ----------------
const PLAYER_CARS = ['ferrari', 'etron', 'audis4', 'peugeot405', 'carrapide'];
const player = { mesh: null, model: 'ferrari', x: 0, z: 0, h: 0, vx: 0, vz: 0, steer: 0, hp: 100, cfg: null };
const headL = new THREE.SpotLight(0xfff2d0, 60, 70, 0.45, 0.5, 1.2), headR = headL.clone();
scene.add(headL, headR, headL.target, headR.target);
// ---- car damage: dents the player car mesh near the impact point, smoke/fire when badly hit
const smokeTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,.9)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, false);
const smoke = []; for (let i = 0; i < 40; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; scene.add(sp); smoke.push({ sp, life: 0 }); }
let smokeT = 0;
function emitSmoke(dt) {
  if (player.hp > 45) return; smokeT -= dt; if (smokeT > 0) return; smokeT = player.hp < 20 ? 0.04 : 0.1;
  const p = smoke.find(q => q.life <= 0); if (!p) return;
  const fx = Math.sin(player.h), fz = Math.cos(player.h), L = player.cfg.len * 0.4;
  p.sp.position.set(player.x + fx * L + rand(-.3, .3), 0.9, player.z + fz * L + rand(-.3, .3)); p.life = 1.6; p.sp.visible = true;
  p.fire = player.hp < 20 && Math.random() < 0.5; p.sp.material.color.set(p.fire ? 0xff7a20 : (player.hp < 25 ? 0x222222 : 0x9a9a9a));
}
function updateSmoke(dt) { emitSmoke(dt); for (const p of smoke) { if (p.life <= 0) continue; p.life -= dt; p.sp.position.y += dt * (p.fire ? 2.5 : 1.6); const k = 1 - p.life / 1.6; p.sp.scale.setScalar((p.fire ? 0.8 : 1) + k * (p.fire ? 1.2 : 3.5)); p.sp.material.opacity = Math.max(0, p.life / 1.6) * (p.fire ? 0.9 : 0.55); if (p.life <= 0) p.sp.visible = false; } }
function damageCar(wx, wz, strength) {
  if (!player.mesh) return; const local = player.mesh.worldToLocal(new THREE.Vector3(wx, 0.7, wz));
  const R = 1.3, amt = Math.min(0.35, strength * 0.012);
  player.mesh.traverse(o => {
    if (!o.isMesh) return; const p = o.geometry.attributes.position, n = o.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - local.x, dy = p.getY(i) - local.y, dz = p.getZ(i) - local.z, d = Math.hypot(dx, dy * 0.6, dz);
      if (d > R) continue; const f = (1 - d / R) * amt;
      p.setXYZ(i, p.getX(i) - Math.sign(local.x) * f * (Math.abs(local.x) > Math.abs(local.z) * 0.5 ? 1 : 0) + rand(-0.02, 0.02) * f * 10, p.getY(i) - f * 0.3, p.getZ(i) - Math.sign(local.z) * f * (Math.abs(local.z) > Math.abs(local.x) ? 1 : 0.2));
    }
    p.needsUpdate = true; if (n) o.geometry.computeVertexNormals();
  });
  if (player.hp < 50) player.mesh.traverse(o => { if (o.isMesh && o.userData.body && o.material.color) o.material.color.multiplyScalar(0.97); });
}
let nitro = 1, boosting = false;
const flameTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.35, "rgba(90,170,255,.9)"); r.addColorStop(1, "rgba(40,80,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }, false);
const flames = [0, 1].map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.visible = false; scene.add(sp); return sp; });
const nitroLight = new THREE.PointLight(0x4f8cff, 0, 12); scene.add(nitroLight);
function updateNitroFx() {
  const fx = Math.sin(player.h), fz = Math.cos(player.h), L = player.cfg.len / 2 + 0.25;
  flames.forEach((f, i) => { f.visible = boosting; if (!boosting) return; const s = i ? 0.45 : -0.45; f.position.set(player.x - fx * L - fz * s, 0.45, player.z - fz * L + fx * s); f.scale.setScalar(rand(0.6, 1.1)); });
  nitroLight.intensity = boosting ? 6 : 0; nitroLight.position.set(player.x - fx * L, 0.6, player.z - fz * L);
  document.getElementById("nitro").firstElementChild.style.width = (nitro * 100) + "%";
  if (boosting && eng) eng.f.frequency.value += 600;
}
function setPlayerCar(name) {
  if (player.mesh) scene.remove(player.mesh);
  player.model = name; player.mesh = makeCar(name, name === 'ferrari' ? 0xc8141c : name === 'etron' ? 0x2a2f36 : null);
  player.mesh.traverse(o => { if (o.isMesh) { o.geometry = o.geometry.clone(); if (o.userData.body) o.material = o.material.clone(); } }); // own copy so dents stay on this car
  player.cfg = CAR_CFG[name]; $('carname').textContent = player.cfg.label;
}
function spawnAt(x, z) {
  const nr = nearestRoad(x, z, 3, r => r.t <= 6) || nearestRoad(x, z, 6);
  if (nr) { x = nr.x; z = nr.z; player.h = nr.h; }
  player.x = x; player.z = z; player.vx = player.vz = 0; player.hp = 100;
  camPos.set(x - Math.sin(player.h) * 10, 5, z - Math.cos(player.h) * 10);
  updateChunks(x, z); processQueue(30);
  for (const c of traffic) removeCar(c); traffic.length = 0;
  for (const p of peds) p.g.visible = false;
}

// ---------------- Input ----------------
const keys = {};
addEventListener('keydown', e => {
  if (e.repeat) return; keys[e.code] = true; initAudio();
  if (fullOpen && (e.code === 'KeyM' || e.code === 'Escape')) return toggleFullMap(false);
  switch (e.code) {
    case 'KeyM': toggleFullMap(true); break;
    case 'KeyC': camMode = (camMode + 1) % 3; break;
    case 'KeyN': modeIdx = (modeIdx + 1) % MODES.length; applyMode(); break;
    case 'KeyV': { const i = (PLAYER_CARS.indexOf(player.model) + 1) % PLAYER_CARS.length; setPlayerCar(PLAYER_CARS[i]); toast(player.cfg.label); break; }
    case 'KeyR': setPlayerCar(player.model); spawnAt(player.x, player.z); busted = false; showBig(''); break;
    case 'KeyE': hackLight(); break;
    case 'KeyF': hackCar(); break;
    case 'KeyG': blackout(); break;
    case 'KeyH': horn(); break;
    case 'KeyT': onDuty = !onDuty; if (!onDuty) { mission = null; waypoint = null; } toast(onDuty ? 'En service' : 'Hors service'); break;
    case 'KeyJ': skipTravel(); break;
    case 'KeyY': nextStation(); break;
    case 'KeyP': qIdx = (qIdx + 1) % QUALITY.length; try { localStorage.setItem('dow-quality', qIdx); } catch (e) { } toast(`Qualité : ${QUALITY[qIdx].name} — rechargement…`); setTimeout(() => location.reload(), 700); break;
    case 'Digit1': case 'Digit2': case 'Digit3': { const c = CITIES[e.code.slice(-1)]; clearWanted(); spawnAt(c.p[0], c.p[1]); toast(`Bienvenue à ${c.name}`); break; }
  }
});
addEventListener('keyup', e => keys[e.code] = false);
let camMode = 0;

// ---------------- Collisions ----------------
function collide(x, z, r) { // returns push vector or null
  const gx = cellOf(x), gz = cellOf(z); let px = 0, pz = 0, hit = false;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const cols = colliders.get(ckey(gx + a, gz + b)); if (!cols) continue;
    for (const c of cols) {
      if (x + r < c.minx || x - r > c.maxx || z + r < c.minz || z - r > c.maxz) continue;
      const pts = c.pts; let bd = 1e9, bx = 0, bz = 0;
      for (let i = 0; i < pts.length; i++) { const [ax, az] = pts[i], [cx, cz] = pts[(i + 1) % pts.length], dx = cx - ax, dz = cz - az, L2 = dx * dx + dz * dz || 1; const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz); if (d < bd) { bd = d; bx = qx; bz = qz; } }
      const inside = inPoly(x, z, pts);
      if (inside || bd < r) { hit = true; let nx = x - bx, nz = z - bz; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L; if (inside) { nx = -nx; nz = -nz; } const depth = inside ? r + bd : r - bd; px += nx * depth; pz += nz * depth; }
    }
  }
  return hit ? [px, pz] : null;
}

// ---------------- Traffic ----------------
const traffic = []; const pools = {};
const TRAFFIC_MIX_DAKAR = [['taxisn', 18], ['peugeot405', 10], ['corolla', 8], ['mercedes', 6], ['civic', 6], ['clando', 9], ['carrapide', 8], ['carrapide2', 5], ['ndiaga', 8], ['bustata', 5], ['busddd', 4], ['pickup404', 5], ['audis4', 3], ['tricycle', 4], ['police', 2]];
const TRAFFIC_MIX_TOWN = [['pickup404', 12], ['clando', 14], ['ndiaga', 12], ['taxisn', 6], ['tricycle', 14], ['peugeot405', 10], ['corolla', 8], ['bustata', 4], ['police', 1]];
const weighted = mix => { let s = 0; for (const [, w] of mix) s += w; let r = Math.random() * s; for (const [n, w] of mix) if ((r -= w) <= 0) return n; return mix[0][0]; };
const CIVIL_COLORS = [0xf2f2f2, 0x9aa0a6, 0x1d1f22, 0x7a1b1b, 0x1f3d6b, 0xd9d2c2, 0x3b5d3a];
function takeCar(name) { const p = pools[name]; if (p && p.length) { const m = p.pop(); m.visible = true; return m; } let col = null; if (name === 'peugeot405' || name === 'corolla') col = pick(CIVIL_COLORS); if (name === 'police') col = 0x5d7fd6; return makeCar(name, col); }
const proxyGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
function setLOD(mesh, far) {
  if (mesh.userData.far === far) return; mesh.userData.far = far;
  if (!mesh.userData.proxy) { const sz = mesh.userData.size || MODELS[mesh.userData.model]?.userData.size || new THREE.Vector3(1.8, 1.4, 4.4); let col = 0x9aa0a6; mesh.traverse(o => { if (o.isMesh && o.userData.body && o.material.color) col = o.material.color.getHex(); }); const px = new THREE.Mesh(proxyGeo, new THREE.MeshLambertMaterial({ color: col })); px.scale.set(sz.x * 0.95, sz.y * 0.85, sz.z * 0.95); mesh.add(px); mesh.userData.proxy = px; }
  for (const ch of mesh.children) ch.visible = ch === mesh.userData.proxy ? far : (!far || !!ch.userData.isBar);
}
function removeCar(c) { c.mesh.visible = false; (pools[c.mesh.userData.model] ||= []).push(c.mesh); }
function spawnTraffic() {
  const target = Math.round(Q.traffic * (rushHour() ? 1.8 : 1)); if (traffic.length >= target) return;
  for (let tries = 0; tries < 6 && traffic.length < target; tries++) {
    const ang = Math.random() * Math.PI * 2, dist = rand(90, 330), x = player.x + Math.sin(ang) * dist, z = player.z + Math.cos(ang) * dist;
    const nr = nearestRoad(x, z, 1, r => r.t <= 8 || r.t === 10); if (!nr || nr.d > 40) continue;
    if (traffic.some(c => Math.hypot(c.x - nr.x, c.z - nr.z) < 20)) continue;
    const r = nr.r, dir = r.ow ? 1 : (Math.random() < 0.5 ? 1 : -1);
    const name = weighted(outsideDakar(x) ? TRAFFIC_MIX_TOWN : TRAFFIC_MIX_DAKAR);
    const mesh = takeCar(name);
    const s = r.cum[nr.i] + nr.t * (r.cum[nr.i + 1] - r.cum[nr.i]);
    const c = { mesh, r, s, dir, speed: 0, x: nr.x, z: nr.z, h: 0, stun: 0, lane: r.ow ? (r.w > 8 ? rand(-1.5, 1.5) : 0) : r.w / 4, police: name === 'police', honk: 0 };
    traffic.push(c);
  }
}
function roadPoint(r, s) {
  let i = 1; while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const a = r.pts[i - 1], b = r.pts[i], L = (r.cum[i] - r.cum[i - 1]) || 1, t = clamp((s - r.cum[i - 1]) / L, 0, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[0] - a[0], b[1] - a[1])];
}
function nextRoad(c) {
  const p = c.dir > 0 ? c.r.pts[c.r.pts.length - 1] : c.r.pts[0];
  const cand = (ends.get(endKey(p[0], p[1])) || []).filter(([ri, e]) => roads[ri] !== c.r && roads[ri].t <= 8 && !(roads[ri].ow && e === 1));
  if (!cand.length) { if (c.r.ow) return false; c.dir = -c.dir; return true; }
  const [ri, e] = pick(cand); c.r = roads[ri]; c.dir = e === 0 ? 1 : -1; c.s = e === 0 ? 0 : c.r.len;
  c.lane = c.r.ow ? 0 : c.r.w / 4; return true;
}
function updateTraffic(dt) {
  for (let ci = traffic.length - 1; ci >= 0; ci--) {
    const c = traffic[ci];
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    if (d > 430) { removeCar(c); traffic.splice(ci, 1); continue; }
    if (c.stun > 0) { c.stun -= dt; c.x += c.kx * dt; c.z += c.kz * dt; c.kx *= 0.94; c.kz *= 0.94; c.h += c.spin * dt; c.spin *= 0.95; c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = c.h; continue; }
    let want = SPEED[c.r.t] * (c.mesh.userData.cfg.vmax < 30 ? 0.75 : 1) * (rushHour() ? 0.55 : 1);
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    const ahead = (ox, oz, lat = 2.4, rng = 26) => { const dx = ox - c.x, dz = oz - c.z, along = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx); return along > 0 && along < rng && side < lat ? along : null; };
    const len = c.mesh.userData.cfg.len;
    // only queue behind cars going our way; a car stuck for long squeezes past (prevents head-on / crossing deadlocks)
    if (c.stuck > 6) { c.ghost = 3; c.stuck = 0; } if (c.ghost > 0) c.ghost -= dt;
    let redLight = false;
    for (const o of traffic) { if (o === c || c.ghost > 0 || Math.cos(o.h - c.h) < 0.4) continue; const a = ahead(o.x, o.z); if (a !== null) want = Math.min(want, Math.max(0, (a - len / 2 - (o.mesh.userData.cfg.len / 2) - 2.5) * 0.9)); }
    const ap = ahead(player.x, player.z); if (ap !== null) { want = Math.min(want, Math.max(0, (ap - len / 2 - 4) * 0.9)); if (ap < 12) { c.honk += dt; if (c.honk > 2.5 && d < 60) { c.honk = -4; beep(380, 0.25, 0.05); } } }
    for (const p of peds) if (p.g.visible && p.alive) { const a = ahead(p.x, p.z, 2.6, 14); if (a !== null) want = Math.min(want, Math.max(0, (a - len / 2 - 2) * 1.2)); }
    if (!c.police || !wanted) {
      const gx = cellOf(c.x), gz = cellOf(c.z);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const si of sigGrid.get(ckey(gx + a, gz + b)) || []) {
        const s = signals[si], al = ahead(s.x, s.z, c.r.w / 2 + 8, 34);
        if (al !== null && al > 6) { const st = signalState(s, c.h); if (st !== 'g') { want = Math.min(want, Math.max(0, (al - 9) * 0.8)); redLight = true; } }
      }
    }
    c.stuck = c.speed < 0.5 && !redLight && ap === null ? (c.stuck || 0) + dt : 0;
    c.speed += clamp(want - c.speed, -9 * dt, 4 * dt);
    c.s += c.dir * c.speed * dt;
    if (c.s > c.r.len || c.s < 0) { if (!nextRoad(c)) { removeCar(c); traffic.splice(ci, 1); continue; } }
    const [x, z, hh] = roadPoint(c.r, c.s), h = c.dir > 0 ? hh : hh + Math.PI;
    c.h += angDiff(c.h, h) * Math.min(1, dt * 6);
    c.x = x + Math.cos(h) * -c.lane * -1 * (c.r.ow ? 1 : 1) * 0 + (-Math.cos(h)) * c.lane; c.z = z + Math.sin(h) * c.lane;
    c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = c.h;
    setLOD(c.mesh, d > (qIdx ? 110 : 60));
  }
}

// ---------------- Pedestrians ----------------
const peds = []; const BOUBOU = [0x2a7fd4, 0xf2b01e, 0x2f9e54, 0xd8432f, 0x9b4fc4, 0xffffff, 0x18a39a, 0xf07f2f];
function initPeds() {
  if (!soldier) return;
  const clipW = soldier.animations.find(a => a.name === 'Walk'), clipR = soldier.animations.find(a => a.name === 'Run'), clipI = soldier.animations.find(a => a.name === 'Idle');
  for (let i = 0; i < 34; i++) {
    if (i >= Q.peds) break;
    const g = SkeletonUtils.clone(soldier.scene); const col = pick(BOUBOU);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material = o.material.clone(); o.material.color.set(col).lerp(new THREE.Color(1, 1, 1), 0.25); } });
    const mixer = new THREE.AnimationMixer(g);
    const aw = mixer.clipAction(clipW), ar = mixer.clipAction(clipR), ai = mixer.clipAction(clipI);
    aw.play(); g.visible = false; scene.add(g);
    peds.push({ g, mixer, aw, ar, ai, x: 0, z: 0, alive: true, state: 'walk', r: null, s: 0, dir: 1, side: 1, cross: 0, vy: 0, t: 0 });
  }
}
function spawnPed(p) {
  for (let tries = 0; tries < 5; tries++) {
    const ang = Math.random() * Math.PI * 2, dist = rand(25, 150), x = player.x + Math.sin(ang) * dist, z = player.z + Math.cos(ang) * dist;
    const nr = nearestRoad(x, z, 1, r => r.t >= 2 && r.t <= 7); if (!nr || nr.d > 40) continue;
    Object.assign(p, { r: nr.r, s: nr.r.cum[nr.i] + nr.t * (nr.r.cum[nr.i + 1] - nr.r.cum[nr.i]), dir: Math.random() < .5 ? 1 : -1, side: Math.random() < .5 ? 1 : -1, alive: true, state: 'walk', cross: 0, speed: rand(1.1, 1.6), wait: rand(10, 40) });
    p.g.visible = true; p.g.rotation.set(0, 0, 0); p.aw.reset().play(); p.ar.stop(); p.ai.stop(); return;
  }
}
function updatePeds(dt) {
  for (const p of peds) {
    if (!p.g.visible) { spawnPed(p); continue; }
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d > 190) { p.g.visible = false; continue; }
    if (!p.alive) { p.vy -= 22 * dt; p.y = Math.max(0, p.y + p.vy * dt); p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.98; p.vz *= 0.98; p.g.rotation.x = Math.min(Math.PI / 2, p.g.rotation.x + dt * 5); p.g.position.set(p.x, p.y, p.z); p.dead += dt; if (p.dead > 25) p.g.visible = false; continue; }
    const r = p.r; const [x, z, h] = roadPoint(r, clamp(p.s, 0, r.len)); const hd = p.dir > 0 ? h : h + Math.PI;
    const off = (r.w / 2 + Math.max(1, r.side * 0.6)) * p.side * (p.state === 'cross' ? 1 - 2 * p.cross : 1);
    // flee from fast player car
    const pv = Math.hypot(player.vx, player.vz);
    if (d < 14 && pv > 8 && p.state !== 'flee') { p.state = 'flee'; p.ar.reset().play(); p.aw.stop(); p.fleeT = 2; }
    if (p.state === 'walk') {
      p.s += p.dir * p.speed * dt; p.wait -= dt;
      if (p.s < 0 || p.s > r.len) p.dir = -p.dir;
      if (p.wait < 0) { // try crossing
        let ok = r.t >= 5; const gx = cellOf(x), gz = cellOf(z);
        for (const si of sigGrid.get(ckey(gx, gz)) || []) { const s = signals[si]; if (Math.hypot(s.x - x, s.z - z) < 30) ok = signalState(s, h) === 'r'; }
        if (ok && !traffic.some(c => Math.hypot(c.x - x, c.z - z) < 25)) { p.state = 'cross'; p.cross = 0; } else p.wait = rand(5, 15);
      }
    } else if (p.state === 'cross') {
      p.cross += dt * (p.speed * 1.2) / (r.w + 2.4);
      if (p.cross >= 1) { p.side = -p.side; p.state = 'walk'; p.cross = 0; p.wait = rand(15, 45); }
    } else if (p.state === 'flee') {
      p.fleeT -= dt; p.side = Math.sign(p.side) * 1; p.s += p.dir * 4 * dt;
      if (p.fleeT < 0) { p.state = 'walk'; p.aw.reset().play(); p.ar.stop(); }
    }
    p.x = x - Math.cos(h) * off; p.z = z + Math.sin(h) * off;
    p.g.position.set(p.x, 0, p.z);
    p.g.rotation.y = p.state === 'cross' ? (h + (p.side > 0 ? -Math.PI / 2 : Math.PI / 2)) + Math.PI : hd + Math.PI;
    if (d < (qIdx ? 90 : 50)) p.mixer.update(dt * (p.state === 'flee' ? 1 : p.speed / 1.3));
    // hit by player
    if (d < 2.2 && pv > 3) {
      p.alive = false; p.dead = 0; p.y = 0; p.vy = 4 + pv * 0.15; p.vx = player.vx * 0.6; p.vz = player.vz * 0.6; p.mixer.stopAllAction();
      thud(); addWanted(1, 'Piéton percuté — la police arrive !');
    }
  }
}

// ---------------- Police / wanted ----------------
let wanted = 0, evade = 0, busted = false, bustT = 0; const cops = [];
function addWanted(n, msg) { const before = wanted; wanted = Math.min(5, wanted + n); evade = 0; if (msg && wanted > before) toast(msg); }
function clearWanted() { wanted = 0; for (const c of cops) removeCar(c); cops.length = 0; }
function spawnCop() {
  for (let tries = 0; tries < 8; tries++) {
    const back = player.h + Math.PI + rand(-1.2, 1.2), dist = rand(150, 260), x = player.x + Math.sin(back) * dist, z = player.z + Math.cos(back) * dist;
    const nr = nearestRoad(x, z, 2); if (!nr) continue;
    const mesh = takeCar('police'); const bar = mesh.userData.bar || addLightBar(mesh);
    cops.push({ mesh, x: nr.x, z: nr.z, h: Math.atan2(player.x - nr.x, player.z - nr.z), v: 0, stuck: 0, stun: 0, bar });
    return;
  }
}
function addLightBar(mesh) {
  const g = new THREE.Group(); const red = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 0 }), blue = new THREE.MeshStandardMaterial({ color: 0x000830, emissive: 0x1040ff, emissiveIntensity: 0 });
  const sz = mesh.userData.size || new THREE.Vector3(1.9, 1.5, 4.9);
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), red); a.position.set(-0.35, sz.y + 0.08, 0);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), blue); b.position.set(0.35, sz.y + 0.08, 0);
  const lr = new THREE.PointLight(0xff2020, 0, 30), lb = new THREE.PointLight(0x2040ff, 0, 30); lr.position.copy(a.position); lb.position.copy(b.position);
  g.add(a, b, lr, lb); g.userData.isBar = true; mesh.add(g); mesh.userData.bar = { red, blue, lr, lb }; return mesh.userData.bar;
}
function updateCops(dt) {
  const wantCops = wanted ? Math.min(1 + wanted, 6) : 0;
  while (cops.length < wantCops) spawnCop();
  while (cops.length > wantCops) removeCar(cops.pop());
  let near = false;
  for (const c of cops) {
    const dx = player.x - c.x, dz = player.z - c.z, dist = Math.hypot(dx, dz);
    if (dist < 140) near = true;
    const flash = Math.floor(time * 7) % 2;
    c.bar.red.emissiveIntensity = flash ? 8 : 0; c.bar.blue.emissiveIntensity = flash ? 0 : 8;
    c.bar.lr.intensity = night && flash ? 30 : 0; c.bar.lb.intensity = night && !flash ? 30 : 0;
    if (c.stun > 0) { c.stun -= dt; c.v *= 0.95; c.h += dt * 3 * Math.min(1, c.stun); }
    else {
      const lead = Math.min(dist / 40, 1.4), tx = player.x + player.vx * lead, tz = player.z + player.vz * lead;
      const target = Math.atan2(tx - c.x, tz - c.z), diff = angDiff(c.h, target);
      c.h += clamp(diff * 2.5, -2.4, 2.4) * dt;
      const vmax = 46 + wanted * 4;
      c.v += (Math.abs(diff) > 1.2 && c.v > 15 ? -20 : 14) * dt; c.v = clamp(c.v, -6, vmax);
    }
    c.x += Math.sin(c.h) * c.v * dt; c.z += Math.cos(c.h) * c.v * dt;
    const push = collide(c.x, c.z, 1.4); if (push) { c.x += push[0]; c.z += push[1]; c.v *= 0.6; c.stuck += dt; } else c.stuck = Math.max(0, c.stuck - dt);
    if ((c.stuck > 2.5 || dist > 450) && dist > 60) { const i = cops.indexOf(c); removeCar(c); cops.splice(i, 1); spawnCop(); break; }
    // collision with player
    if (dist < 4) { const n = [dx / (dist || 1), dz / (dist || 1)]; player.vx += n[0] * 3; player.vz += n[1] * 3; c.v *= 0.5; player.hp -= 2 * dt * 10; }
    c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = c.h; setLOD(c.mesh, dist > (qIdx ? 110 : 60));
    if (dist < 7 && Math.hypot(player.vx, player.vz) < 2.5) bustT += dt;
  }
  if (!cops.some(c => Math.hypot(player.x - c.x, player.z - c.z) < 8)) bustT = Math.max(0, bustT - dt);
  if (bustT > 2.5 && !busted) { busted = true; showBig('ARRÊTÉ<small>La police t\'a eu. R pour réapparaître</small>'); clearWanted(); }
  if (wanted) {
    if (!near) { evade += dt * (blackoutT > time ? 3 : 1); if (evade > 14) { toast('Tu as semé la police'); clearWanted(); } }
    else evade = Math.max(0, evade - dt * 2);
  }
}

// ---------------- Watch Dogs hacking ----------------
let battery = 3, blackoutT = 0, glitchT = 0;
const hackCanvas = $('hackline'), hctx = hackCanvas.getContext('2d');
function project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera); return v.z < 1 ? [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] : null; }
function nearestHackable(kind) {
  let best = null, bd = kind === 'light' ? 90 : 110; const fx = Math.sin(player.h), fz = Math.cos(player.h);
  const list = kind === 'light' ? (() => { const out = []; const gx = cellOf(player.x), gz = cellOf(player.z); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const si of sigGrid.get(ckey(gx + a, gz + b)) || []) out.push(signals[si]); return out; })() : cops.concat(traffic);
  for (const o of list) { const dx = o.x - player.x, dz = o.z - player.z, d = Math.hypot(dx, dz); if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.3) { bd = d; best = o; } }
  return best;
}
function useBattery() { if (battery < 1) { toast('Batterie vide — attends la recharge'); return false; } battery -= 1; glitchT = 0.45; beep(1200, 0.08, 0.04); setTimeout(() => beep(1600, 0.08, 0.04), 90); return true; }
function hackLight() {
  const s = nearestHackable('light'); if (!s) return toast('Aucun feu à portée');
  if (!useBattery()) return; s.hacked = time + 12;
  for (const c of cops) if (Math.hypot(c.x - s.x, c.z - s.z) < 60) { c.stun = 4; c.v *= 0.3; }
  for (const c of traffic) if (Math.hypot(c.x - s.x, c.z - s.z) < 40) { c.speed = 0; }
  toast('Feu piraté — carrefour bloqué'); evade += 4; flashLine(s.x, 4.6, s.z);
}
function hackCar() {
  const c = nearestHackable('car'); if (!c) return toast('Aucun véhicule à portée');
  if (!useBattery()) return;
  if (cops.includes(c)) { c.stun = 6; c.v *= 0.2; toast('Moteur de la police coupé'); }
  else { c.stun = 5; c.kx = 0; c.kz = 0; c.spin = rand(-2, 2); toast('Véhicule piraté'); }
  flashLine(c.x, 1.2, c.z);
}
function blackout() {
  if (battery < 3) return toast('Blackout : il faut 3 charges de batterie');
  battery = 0; blackoutT = time + 15; glitchT = 0.9; toast('BLACKOUT — la police perd ta trace plus vite');
  for (const s of signals) if (Math.hypot(s.x - player.x, s.z - player.z) < 400) s.hacked = time + 15;
}
let lineT = 0, lineTarget = null;
function flashLine(x, y, z) { lineT = 0.6; lineTarget = [x, y, z]; }
function updateHackUI(dt) {
  battery = Math.min(3, battery + dt / 8);
  hackCanvas.width = innerWidth; hackCanvas.height = innerHeight; hctx.clearRect(0, 0, innerWidth, innerHeight);
  const ui = $('hackui'); const s = nearestHackable('light'), c = nearestHackable('car');
  const target = s ? { o: s, y: 5, label: 'Pirater le feu', k: 'E' } : c ? { o: c, y: 2, label: 'Pirater le véhicule', k: 'F' } : null;
  const sp = target && project(target.o.x, target.y, target.o.z);
  if (sp) { ui.style.display = 'block'; ui.style.left = sp[0] + 'px'; ui.style.top = sp[1] + 'px'; ui.innerHTML = `<span class="k">${target.k}</span>${target.label}`; } else ui.style.display = 'none';
  if (lineT > 0 && lineTarget) {
    lineT -= dt; const a = project(player.x, 1.2, player.z), b = project(...lineTarget);
    if (a && b) { hctx.strokeStyle = `rgba(200,247,255,${lineT / 0.6})`; hctx.lineWidth = 2; hctx.setLineDash([10, 6]); hctx.beginPath(); hctx.moveTo(...a); hctx.lineTo(...b); hctx.stroke(); }
  }
  // speed effect: white streaks rushing from the screen edges (2D overlay, cheap on any GPU)
  const spd = Math.hypot(player.vx, player.vz), k = clamp((spd - 22) / 40, 0, 1) + (boosting ? 0.6 : 0);
  if (k > 0 && camMode !== 2 || boosting) {
    const W = innerWidth, H = innerHeight, cx = W / 2, cy = H * 0.45, n = Math.floor(18 + k * 50);
    hctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r0 = Math.max(W, H) * rand(0.32, 0.55), len = rand(60, 220) * (0.4 + k);
      const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0 * 0.75;
      hctx.strokeStyle = boosting && Math.random() < 0.4 ? `rgba(140,200,255,${0.25 + 0.3 * Math.random()})` : `rgba(255,255,255,${(0.08 + 0.22 * Math.random()) * Math.min(1, k)})`;
      hctx.lineWidth = rand(1, 2.5); hctx.beginPath(); hctx.moveTo(x0, y0); hctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len * 0.75); hctx.stroke();
    }
    if (boosting) { const g = hctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75); g.addColorStop(0, "rgba(40,90,255,0)"); g.addColorStop(1, "rgba(40,90,255,.28)"); hctx.fillStyle = g; hctx.fillRect(0, 0, W, H); }
  }
  if (spd > 45) shake = Math.max(shake, (spd - 45) / 200 + (boosting ? 0.06 : 0));
  glitchT = Math.max(0, glitchT - dt); grade.uniforms.glitch.value = glitchT * 2;
  $('bat').firstElementChild.style.width = (battery / 3 * 100) + '%';
}

// ---------------- Player physics ----------------
function updatePlayer(dt) {
  const up = keys.ArrowUp || keys.KeyW || keys.KeyZ, down = keys.ArrowDown || keys.KeyS;
  const left = keys.ArrowLeft || keys.KeyA || keys.KeyQ, right = keys.ArrowRight || keys.KeyD, hb = keys.Space;
  const fx = Math.sin(player.h), fz = Math.cos(player.h), rx = -fz, rz = fx;
  let vf = player.vx * fx + player.vz * fz, vr = player.vx * rx + player.vz * rz;
  // nitro: Shift held, drains the gauge, recharges when released
  const nitroOn = (keys.ShiftLeft || keys.ShiftRight) && nitro > 0.02 && !busted && vf > 2;
  nitro = clamp(nitro + (nitroOn ? -dt / 4 : dt / 18), 0, 1); boosting = nitroOn;
  const vmax = player.cfg.vmax * (nitroOn ? 1.35 : 1), ctrl = busted ? 0 : 1;
  if (up && ctrl) vf += 14 * (1 - Math.max(0, vf) / vmax) * dt * (vmax / 60 + 0.5);
  if (nitroOn) vf += 16 * dt;
  if (down && ctrl) vf -= (vf > 1 ? 26 : 8) * dt;
  if (hb) vf *= Math.pow(0.4, dt);
  vf *= Math.pow(0.985, dt * 60 * 0.12); vf -= Math.sign(vf) * Math.min(Math.abs(vf), 0.6 * dt);
  vf = clamp(vf, -14, Math.max(vmax, vf - 8 * dt)); // bleed off extra speed smoothly after nitro
  const grip = hb ? 1.4 : 7; vr *= Math.exp(-grip * dt);
  const steerIn = ((left ? 1 : 0) - (right ? 1 : 0)) * ctrl;
  player.steer += (steerIn - player.steer) * Math.min(1, dt * 8);
  const speedF = Math.min(1, Math.abs(vf) / 5) * (1 - Math.min(0.6, Math.abs(vf) / 160));
  player.h += player.steer * speedF * Math.sign(vf) * dt * (hb ? 2.9 : 2.1);
  if (hb && Math.abs(vf) > 10) vr += -player.steer * Math.abs(vf) * 0.5 * dt;
  const nfx = Math.sin(player.h), nfz = Math.cos(player.h);
  player.vx = nfx * vf + (-nfz) * vr; player.vz = nfz * vf + nfx * vr;
  player.x += player.vx * dt; player.z += player.vz * dt;
  // buildings
  for (const off of [1.5, -1.5]) {
    const push = collide(player.x + nfx * off, player.z + nfz * off, 1.05);
    if (push) { player.x += push[0]; player.z += push[1]; const L = Math.hypot(push[0], push[1]) || 1, nx = push[0] / L, nz = push[1] / L, dot = player.vx * nx + player.vz * nz; if (dot < 0) { const impact = -dot; player.vx -= 1.4 * dot * nx; player.vz -= 1.4 * dot * nz; player.vx *= 0.7; player.vz *= 0.7; if (impact > 6) { player.hp -= impact * 0.6; shake = Math.min(1, impact / 30); crash(impact); damageCar(player.x - nx * 2, player.z - nz * 2, impact); } } }
  }
  // cars
  for (const c of traffic.concat(cops)) {
    const dx = player.x - c.x, dz = player.z - c.z, d = Math.hypot(dx, dz), rr = (c.mesh.userData.cfg.len > 6 ? 3.6 : 2.4);
    if (d < rr) {
      const nx = dx / (d || 1), nz = dz / (d || 1), pv = Math.hypot(player.vx, player.vz);
      player.x += nx * (rr - d); player.z += nz * (rr - d);
      const dot = player.vx * nx + player.vz * nz; if (dot < 0) { player.vx -= 1.3 * dot * nx; player.vz -= 1.3 * dot * nz; }
      if (!cops.includes(c) && pv > 6) { c.stun = 3; c.kx = -nx * pv * 0.5; c.kz = -nz * pv * 0.5; c.spin = rand(-2, 2); c.speed = 0; if (pv > 14) { crash(pv); player.hp -= pv * 0.3; damageCar(player.x - nx * 2, player.z - nz * 2, pv * 0.7); } if (c.police) addWanted(2, 'Tu as percuté la police !'); }
      if (cops.includes(c) && pv > 10) { addWanted(1); crash(pv); }
    }
  }
  if (player.hp <= 0 && !busted) { busted = true; showBig('VÉHICULE DÉTRUIT<small>R pour réapparaître</small>'); clearWanted(); }
  const gy = groundY(player.x, player.z); player.y = player.y === undefined ? gy : player.y + (gy - player.y) * Math.min(1, dt * 12);
  player.mesh.position.set(player.x, player.y, player.z); player.mesh.rotation.y = player.h;
  { const fx = Math.sin(player.h), fz = Math.cos(player.h), pitch = Math.atan2(groundY(player.x + fx * 2, player.z + fz * 2) - groundY(player.x - fx * 2, player.z - fz * 2), 4); player.mesh.rotation.order = "YXZ"; player.mesh.rotation.x = -pitch; }
  player.mesh.rotation.z = clamp(-vr * 0.012, -0.05, 0.05);
  // headlights
  for (const [L, s] of [[headL, 0.7], [headR, -0.7]]) { L.position.set(player.x + nfx * 2.2 - nfz * s, 0.8, player.z + nfz * 2.2 + nfx * s); L.target.position.set(player.x + nfx * 30 - nfz * s * 3, 0, player.z + nfz * 30 + nfx * s * 3); }
  return vf;
}

// ---------------- Camera ----------------
const camPos = new THREE.Vector3(); let shake = 0;
function updateCamera(dt, vf) {
  const sp = Math.abs(vf), len = player.cfg.len;
  const back = [len * 1.6 + 3, len * 2.5 + 5, -0.4][camMode], height = [2.4 + len * 0.25, 5 + len * 0.4, 1.25][camMode];
  const fx = Math.sin(player.h), fz = Math.cos(player.h);
  const tgt = new THREE.Vector3(player.x - fx * back, height, player.z - fz * back);
  if (camMode === 2) camPos.copy(tgt); else camPos.lerp(tgt, Math.min(1, dt * 4.5));
  camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.4; camera.position.y += rand(-1, 1) * shake * 0.3; shake = Math.max(0, shake - dt * 2); }
  camera.fov += ((62 + Math.min(18, sp * 0.25) + (boosting ? 12 : 0)) - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  camera.lookAt(player.x + fx * (camMode === 2 ? 30 : 6), camMode === 2 ? 1.1 : 1.4, player.z + fz * (camMode === 2 ? 30 : 6));
  sun.position.set(player.x + sunDir.x * 300, Math.max(30, sunDir.y * 300), player.z + sunDir.z * 300); sun.target.position.set(player.x, 0, player.z);
  ground.position.set(Math.round(player.x / 10) * 10, 0, Math.round(player.z / 10) * 10);
}

// ---------------- Minimap & full map ----------------
const mm = $('minimap'), mctx = mm.getContext('2d');
const ROADCOL = ['#f6b93b', '#f6b93b', '#e9eef2', '#cfd6db', '#b8c0c6', '#8d969d', '#8d969d', '#7a838a', '#6d757b', '#8a7a5c', '#d8dee2'];
let waypoint = null;
function drawRoads(ctx, cx, cz, scale, rot, W, H, radiusM, typeMax = 10) {
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.scale(scale, scale); ctx.translate(-cx, -cz);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (waterPoly) { ctx.fillStyle = '#2b5f8a'; ctx.beginPath(); waterPoly.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)); ctx.fill(); }
  const gr = Math.ceil(radiusM / CELL), gx = cellOf(cx), gz = cellOf(cz);
  const byType = Array.from({ length: 11 }, () => []);
  for (let a = -gr; a <= gr; a++) for (let b = -gr; b <= gr; b++) { const s = segGrid.get(ckey(gx + a, gz + b)); if (!s) continue; for (let j = 0; j < s.length; j += 2) { const r = roads[s[j]]; if (r.t <= typeMax || r.t === 10) byType[r.t].push(r, s[j + 1]); } }
  for (let t = 10; t >= 0; t--) {
    const list = byType[t]; if (!list.length) continue;
    ctx.strokeStyle = ROADCOL[t]; ctx.lineWidth = Math.max(roads[0] ? WIDTH[t] * 0.9 : 6, 2.2 / scale); ctx.beginPath();
    for (let j = 0; j < list.length; j += 2) { const r = list[j], i = list[j + 1]; ctx.moveTo(r.pts[i][0], r.pts[i][1]); ctx.lineTo(r.pts[i + 1][0], r.pts[i + 1][1]); }
    ctx.stroke();
  }
  strokeRoute(ctx, Math.max(8, 4 / scale));
  ctx.restore();
}
let mmTimer = 0;
function drawMinimap(dt, vf) {
  mmTimer -= dt; if (mmTimer > 0) return; mmTimer = qIdx ? 0.08 : 0.15;
  const W = mm.width, H = mm.height, radius = 260 + Math.min(500, Math.abs(vf) * 9), scale = (H / 2) / radius;
  mctx.fillStyle = '#3a4048'; mctx.fillRect(0, 0, W, H);
  drawRoads(mctx, player.x, player.z, scale, Math.PI + player.h, W, H, radius * 1.5);
  const toScreen = (x, z) => { const dx = x - player.x, dz = z - player.z, c = Math.cos(Math.PI + player.h), s = Math.sin(Math.PI + player.h); return [W / 2 + (dx * c - dz * s) * scale, H / 2 + (dx * s + dz * c) * scale]; };
  for (const c of cops) { const [x, y] = toScreen(c.x, c.z); mctx.fillStyle = Math.floor(time * 6) % 2 ? '#ff3030' : '#3060ff'; mctx.beginPath(); mctx.arc(clamp(x, 8, W - 8), clamp(y, 8, H - 8), 7, 0, 7); mctx.fill(); }
  drawPois(mctx, (x, z) => { const [a, b] = toScreen(x, z); return [clamp(a, 9, W - 9), clamp(b, 9, H - 9)]; }, 8);
  if (waypoint) { const [x, y] = toScreen(waypoint[0], waypoint[1]); mctx.fillStyle = '#c86bff'; mctx.beginPath(); mctx.arc(clamp(x, 10, W - 10), clamp(y, 10, H - 10), 9, 0, 7); mctx.fill(); }
  if (wanted) { mctx.strokeStyle = Math.floor(time * 3) % 2 ? 'rgba(255,40,40,.6)' : 'rgba(40,80,255,.6)'; mctx.lineWidth = 8; mctx.strokeRect(4, 4, W - 8, H - 8); }
  // player arrow
  mctx.save(); mctx.translate(W / 2, H / 2); mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 2; mctx.beginPath(); mctx.moveTo(0, -14); mctx.lineTo(10, 12); mctx.lineTo(0, 6); mctx.lineTo(-10, 12); mctx.closePath(); mctx.fill(); mctx.stroke(); mctx.restore();
  // north
  const [nx, ny] = toScreen(player.x, player.z - 10000); const ang = Math.atan2(ny - H / 2, nx - W / 2);
  mctx.fillStyle = '#fff'; mctx.font = 'bold 22px Oswald'; mctx.fillText('N', W / 2 + Math.cos(ang) * (H / 2 - 18) - 7, H / 2 + Math.sin(ang) * (H / 2 - 18) + 8);
}
const fullCanvas = $('fullcanvas'), fctx = fullCanvas.getContext('2d');
let fullOpen = false, fview = { x: 0, z: 0, s: 0.02 };
function toggleFullMap(open) {
  fullOpen = open; $('fullmap').style.display = open ? 'block' : 'none';
  if (open) { fview.x = player.x; fview.z = player.z; fview.s = 0.05; drawFull(); }
}
function drawFull() {
  const W = fullCanvas.width = innerWidth * devicePixelRatio, H = fullCanvas.height = innerHeight * devicePixelRatio;
  fctx.fillStyle = '#1e252d'; fctx.fillRect(0, 0, W, H);
  const radius = Math.max(W, H) / 2 / fview.s;
  const typeMax = fview.s < 0.01 ? 2 : fview.s < 0.04 ? 4 : 10;
  if (radius < 60000) drawRoads(fctx, fview.x, fview.z, fview.s, 0, W, H, radius, typeMax);
  else { // overview: draw major roads only, all
    fctx.save(); fctx.translate(W / 2, H / 2); fctx.scale(fview.s, fview.s); fctx.translate(-fview.x, -fview.z);
    if (waterPoly) { fctx.fillStyle = '#2b5f8a'; fctx.beginPath(); waterPoly.forEach(([x, z], i) => i ? fctx.lineTo(x, z) : fctx.moveTo(x, z)); fctx.fill(); }
    fctx.lineWidth = 2.5 / fview.s; for (const r of roads) { if (r.t > 2) continue; fctx.strokeStyle = ROADCOL[r.t]; fctx.beginPath(); r.pts.forEach(([x, z], i) => i ? fctx.lineTo(x, z) : fctx.moveTo(x, z)); fctx.stroke(); }
    fctx.restore();
  }
  const ts = (x, z) => [W / 2 + (x - fview.x) * fview.s, H / 2 + (z - fview.z) * fview.s];
  fctx.font = `${14 * devicePixelRatio}px Inter`; fctx.textAlign = 'center';
  const lbl = fview.s < 0.004 ? cityPlaces.filter(p => p.type === 'city') : fview.s < 0.03 ? cityPlaces : places.filter(p => p.type !== 'village');
  for (const p of lbl) { const [x, y] = ts(p.x, p.z); if (x < 0 || y < 0 || x > W || y > H) continue; fctx.fillStyle = 'rgba(0,0,0,.6)'; fctx.fillText(p.name, x + 1, y + 1); fctx.fillStyle = p.type === 'city' || p.type === 'town' ? '#fff' : '#c9d2d9'; fctx.fillText(p.name, x, y); }
  drawPois(fctx, ts, 9 * devicePixelRatio);
  if (waypoint) { const [x, y] = ts(...waypoint); fctx.fillStyle = '#c86bff'; fctx.beginPath(); fctx.arc(x, y, 9 * devicePixelRatio, 0, 7); fctx.fill(); }
  const [px, py] = ts(player.x, player.z); fctx.save(); fctx.translate(px, py); fctx.rotate(Math.PI - player.h); const k = devicePixelRatio * 1.4;
  fctx.fillStyle = '#fff'; fctx.strokeStyle = '#000'; fctx.lineWidth = 2; fctx.beginPath(); fctx.moveTo(0, -12 * k); fctx.lineTo(8 * k, 10 * k); fctx.lineTo(0, 5 * k); fctx.lineTo(-8 * k, 10 * k); fctx.closePath(); fctx.fill(); fctx.stroke(); fctx.restore();
}
{
  let drag = null, moved = false;
  fullCanvas.addEventListener('mousedown', e => { drag = [e.clientX, e.clientY]; moved = false; });
  addEventListener('mouseup', e => {
    if (drag && !moved && fullOpen) { const W = innerWidth, H = innerHeight; waypoint = [fview.x + (e.clientX - W / 2) * devicePixelRatio / fview.s, fview.z + (e.clientY - H / 2) * devicePixelRatio / fview.s]; routeT = 0; updateRoute(0); toast(route ? `Itinéraire : ${(route.len / 1000).toFixed(1)} km` : 'Repère GPS placé'); drawFull(); }
    drag = null;
  });
  addEventListener('mousemove', e => { if (!drag || !fullOpen) return; const dx = e.clientX - drag[0], dy = e.clientY - drag[1]; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; fview.x -= dx * devicePixelRatio / fview.s; fview.z -= dy * devicePixelRatio / fview.s; drag = [e.clientX, e.clientY]; drawFull(); });
  fullCanvas.addEventListener('wheel', e => { e.preventDefault(); fview.s = clamp(fview.s * (e.deltaY < 0 ? 1.25 : 0.8), 0.0015, 1.5); drawFull(); }, { passive: false });
  fullCanvas.addEventListener('dblclick', e => { const W = innerWidth, H = innerHeight; const x = fview.x + (e.clientX - W / 2) * devicePixelRatio / fview.s, z = fview.z + (e.clientY - H / 2) * devicePixelRatio / fview.s; clearWanted(); spawnAt(x, z); toggleFullMap(false); toast('Téléportation'); });
}

// ---------------- HUD ----------------
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; toastT = 3; }
function showBig(html) { $('big').innerHTML = html; $('big').style.opacity = html ? 1 : 0; }
let hudT = 0;
function updateHUD(dt, vf) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  $('kmh').textContent = Math.round(Math.abs(vf) * 3.6);
  const st = $('stars'); st.innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="${i < wanted ? 'on' : 'off'}">★</span>`).join('');
  st.classList.toggle('flash', wanted > 0 && evade > 1);
  $('hp').firstElementChild.style.width = clamp(player.hp, 0, 100) + '%';
  $('siren').style.boxShadow = wanted ? `inset 0 0 120px 20px ${Math.floor(time * 4) % 2 ? 'rgba(255,0,0,.25)' : 'rgba(0,60,255,.25)'}` : 'none';
  hudT -= dt; if (hudT > 0) return; hudT = 0.5;
  const nr = nearestRoad(player.x, player.z, 1);
  $('street').textContent = nr && nr.d < 30 ? (nr.r.name || ['Autoroute', 'Route nationale', 'Avenue', 'Boulevard', 'Rue', 'Rue', 'Rue', 'Ruelle', 'Voie de service', 'Piste', 'Bretelle'][nr.r.t]) : 'Hors route';
  let q = null, qd = 1e9, c = null, cd = 1e9;
  for (const p of quartPlaces) { const d = Math.hypot(p.x - player.x, p.z - player.z); if (d < qd) { qd = d; q = p; } }
  for (const p of cityPlaces) { const d = Math.hypot(p.x - player.x, p.z - player.z); if (d < cd) { cd = d; c = p; } }
  $('district').textContent = [q && qd < 2500 ? q.name : null, c ? c.name : null].filter(Boolean).join(' — ');
  $('topinfo').textContent = waypoint ? route ? `Itinéraire GPS : ${(route.len / 1000).toFixed(1)} km` : `Repère GPS : ${(Math.hypot(waypoint[0] - player.x, waypoint[1] - player.z) / 1000).toFixed(1)} km` : '';
}

// ---------------- Audio ----------------
let actx = null, eng = null, siren = null;
function initAudio() {
  if (actx) return; actx = new AudioContext();
  const o1 = actx.createOscillator(), o2 = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0.03;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(actx.destination); o1.start(); o2.start(); eng = { o1, o2, f, g };
  const so = actx.createOscillator(), sg = actx.createGain(); so.type = 'triangle'; sg.gain.value = 0; so.connect(sg); sg.connect(actx.destination); so.start(); siren = { so, sg };
}
function beep(freq, dur, vol = 0.06) { if (!actx) return; const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(actx.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur); o.stop(actx.currentTime + dur); }
function noiseBurst(dur, vol, freq) { if (!actx) return; const b = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(); f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol; s.buffer = b; s.connect(f); f.connect(g); g.connect(actx.destination); s.start(); }
let crashCd = 0;
function crash(i) { if (crashCd > 0) return; crashCd = 0.4; noiseBurst(0.35, Math.min(0.5, i / 40), 1800); }
function thud() { noiseBurst(0.2, 0.4, 500); }
function horn() { beep(420, 0.35, 0.07); beep(530, 0.35, 0.05); }
function updateAudio(dt, vf) {
  crashCd -= dt; if (!eng) return;
  const sp = Math.abs(vf), gear = Math.min(5, Math.floor(sp / 14)), rpm = (sp - gear * 14) / 14;
  const f = 45 + rpm * 90 + gear * 8; eng.o1.frequency.value = f; eng.o2.frequency.value = f * 0.5; eng.f.frequency.value = 400 + rpm * 900;
  eng.g.gain.value = 0.02 + (keys.ArrowUp || keys.KeyW || keys.KeyZ ? 0.025 : 0);
  siren.sg.gain.value = cops.length ? 0.025 : 0; siren.so.frequency.value = 700 + Math.sin(time * 4) * 250;
}

// ---------------- Main loop ----------------
const clock = new THREE.Clock(); let chunkT = 0, started = false;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  if (!started) return;
  const vf = updatePlayer(dt);
  chunkT -= dt; if (chunkT < 0) { chunkT = 0.5; updateChunks(player.x, player.z); }
  processQueue(1);
  updateSmoke(dt); updateNitroFx(); updateStory(dt); updateClock(dt); updateGares(); updateRadio(dt); updateDiscover(dt); updateRoute(dt); spawnTraffic(); updateTraffic(dt); updatePeds(dt); updateCops(dt);
  updateTrafficLightVisuals(); updateCamera(dt, vf); updateHackUI(dt);
  drawMinimap(dt, vf); updateHUD(dt, vf); updateAudio(dt, vf);
  if (waterMat) waterMat.normalMap.offset.set(time * 0.01, time * 0.006);
  glowMat.opacity = night ? 0.8 : 0;
  grade.uniforms.t.value = time; windT.value = time;
  for (const pl of players) { const ph = pl.userData.ph; if (pl.userData.ball) { pl.position.x = Math.sin(time * .9 + ph) * 7; pl.position.z = Math.sin(time * .53 + ph) * 13; pl.position.y = 0.15 + Math.abs(Math.sin(time * 4 + ph)) * 0.6; } else { pl.position.x += Math.sin(time * .7 + ph) * 0.03; pl.position.z += Math.cos(time * .45 + ph * 2) * 0.05; pl.position.y = Math.abs(Math.sin(time * 9 + ph)) * 0.08; } }
  if (qIdx === 0 && glitchT <= 0) renderer.render(scene, camera); else composer.render();
}

// ---------------- Horloge du jeu & heures de pointe ----------------
let gameMin = 7 * 60 + 30; // starts 7:30 — 1 real second = 1 game minute
const rushHour = () => { const h = (gameMin / 60) % 24; return (h >= 7 && h < 9.5) || (h >= 17 && h < 20); };
function updateClock(dt) {
  gameMin += dt; const h = Math.floor(gameMin / 60) % 24, m = Math.floor(gameMin % 60);
  $('clock').innerHTML = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${rushHour() ? ' <span>HEURE DE POINTE</span>' : ''}`;
}

// ---------------- Gares routières ----------------
const GARES = [
  { name: 'Gare Petersen', ll: [14.6697, -17.4378] },
  { name: 'Gare de Colobane', ll: [14.6875, -17.4460] },
  { name: 'Gare des Baux Maraîchers', ll: [14.7469, -17.4155] },
  { name: 'Gare routière de Diourbel', ll: [14.6575, -16.2290] },
  { name: 'Gare routière de Touba', ll: [14.8560, -15.8820] },
].map(g => { const [x, z] = ll(...g.ll); const nr = nearestRoad(x, z, 3, r => r.t <= 6); return { ...g, x: nr ? nr.x : x, z: nr ? nr.z : z, h: nr ? nr.h : 0, built: false }; });
places.push(...GARES.map(g => ({ name: g.name, type: 'town', x: g.x, z: g.z }))); cityPlaces.push(...GARES.map(g => ({ name: g.name, type: 'town', x: g.x, z: g.z })));
function updateGares() { // dress the station with parked buses/minibuses and a canopy when the player gets close
  for (const g of GARES) {
    const near = Math.hypot(g.x - player.x, g.z - player.z) < 700;
    if (near && !g.built) {
      g.group = new THREE.Group(); g.group.position.set(g.x, 0, g.z); g.group.rotation.y = g.h; scene.add(g.group);
      const names = ['ndiaga', 'carrapide', 'carrapide2', 'ndiaga', 'bustata', 'clando', 'taxisn', 'ndiaga'];
      names.forEach((n, i) => { if (!MODELS[n]) return; const m = MODELS[n].clone(); m.position.set((i % 2 ? 1 : -1) * (14 + (i % 3) * 3.5), 0, (Math.floor(i / 2) - 2) * 9); m.rotation.y = Math.PI / 2 * (i % 2 ? 1 : -1); g.group.add(m); });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.5, roughness: 0.5 })); roof.position.set(-24, 4.2, 0); g.group.add(roof);
      for (let k = -2; k <= 2; k++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4.2, 6), poleMat); p.position.set(-24, 2.1, k * 9); g.group.add(p); }
      for (let k = 0; k < 6; k++) { const pn = pick(['fruitcart', 'cafe', 'kiosque_om']); if (PROPS[pn]) { const pr = PROPS[pn].clone(); pr.position.set(-30 + rand(-2, 2), 0, -18 + k * 7); pr.rotation.y = Math.PI / 2; g.group.add(pr); } }
      g.built = true;
    } else if (!near && g.built) { scene.remove(g.group); g.built = false; }
  }
}

// ---------------- Radio ----------------
// Original procedural music (sabar-style drums + bass + balafon-like melody) and spoken news flashes.
const STATIONS = ['Radio coupée', 'Sabar FM — rythmes de Dakar', 'Dakar Info — flashs trafic'];
let station = 0, beatT = 0, step = 0, newsT = 5;
const NEWS = [
  "Flash trafic : ça bouchonne sur la VDN et à la sortie de Colobane. Prudence.",
  "Le Magal de Touba approche, des milliers de pèlerins sont attendus. Les cars partent des Baux Maraîchers.",
  "Météo : grand soleil sur Dakar, 31 degrés, un peu d'harmattan en fin de journée.",
  "Autoroute à péage : circulation fluide entre Dakar et Diamniadio.",
  "Les chauffeurs de cars rapides rappellent : pas de surcharge, la sécurité d'abord.",
  "Lutte : grand combat ce week-end à l'Arène nationale de Pikine.",
  "Corniche Ouest : attention aux contrôles de police ce soir.",
];
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // pentatonic
function drum(t, freq, decay, vol, noise = false) {
  if (noise) { const b = actx.createBuffer(1, actx.sampleRate * decay, actx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); const src = actx.createBufferSource(), g = actx.createGain(), fl = actx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = freq; src.buffer = b; g.gain.value = vol; src.connect(fl); fl.connect(g); g.connect(actx.destination); src.start(t); return; }
  const o = actx.createOscillator(), g = actx.createGain(); o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + decay);
}
function note(t, semi, dur, vol, type = 'triangle', base = 392) {
  const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = base * Math.pow(2, semi / 12);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur);
}
const sabar = '1.1.1..11.1.1.1.', tama = '..1...1..1.11...', bassP = [0, -1, -1, 3, -1, -1, 4, -1, 0, -1, -1, 3, -1, 2, -1, -1];
let melody = Array.from({ length: 16 }, () => Math.random() < 0.45 ? pick(SCALE) : -1);
function updateRadio(dt) {
  if (!actx || !started) return;
  if (station === 1) {
    beatT -= dt;
    while (beatT <= 0) {
      const t = actx.currentTime + 0.05, i = step % 16;
      if (sabar[i] === '1') drum(t, i % 4 === 0 ? 90 : 160, 0.18, 0.12);
      if (tama[i] === '1') drum(t, 1800, 0.08, 0.08, true);
      if (i % 2 === 0) drum(t, 6000, 0.03, 0.025, true);
      if (bassP[i] >= 0) note(t, bassP[i], 0.22, 0.07, 'sine', 98);
      if (melody[i] >= 0) note(t, melody[i], 0.25, 0.05, 'triangle', 392);
      step++; if (step % 64 === 0) melody = Array.from({ length: 16 }, () => Math.random() < 0.45 ? pick(SCALE) : -1);
      beatT += 60 / 118 / 4;
    }
  } else if (station === 2) {
    newsT -= dt;
    if (newsT <= 0 && 'speechSynthesis' in window) {
      newsT = 35; const txt = rushHour() ? 'Heure de pointe : ' + NEWS[0] : pick(NEWS);
      const u = new SpeechSynthesisUtterance(txt); u.lang = 'fr-FR'; u.rate = 1.05; u.volume = 0.8; speechSynthesis.speak(u);
      subtitle('Dakar Info :', txt, 7);
    }
  }
}
// real Senegalese stations streamed live, listed by the community radio-browser.info directory (only working https streams)
const LIVE = [], liveAudio = new Audio(); liveAudio.volume = 0.7;
fetch('https://de2.api.radio-browser.info/json/stations/bycountrycodeexact/SN?hidebroken=true&order=clickcount&reverse=true&limit=40')
  .then(r => r.json()).then(list => {
    const seen = new Set();
    for (const st of list) { const url = st.url_resolved || st.url, name = (st.name || '').trim(); if (!url.startsWith('https://') || !name || seen.has(name.toLowerCase()) || LIVE.length >= 12) continue; seen.add(name.toLowerCase()); LIVE.push({ name, url }); STATIONS.push('📡 ' + name + ' (en direct)'); }
  }).catch(() => {});
function nextStation() {
  station = (station + 1) % STATIONS.length; initAudio(); if ('speechSynthesis' in window) speechSynthesis.cancel(); newsT = 1;
  liveAudio.pause(); const live = LIVE[station - 3];
  if (live) { liveAudio.src = live.url; liveAudio.play().catch(() => { toast('📻 ' + live.name + ' : flux indisponible'); }); }
  else liveAudio.removeAttribute('src');
  toast('📻 ' + STATIONS[station]);
}

// ---------------- Découverte du Sénégal ----------------
// Real places: drive near one to unlock a short culture card + a Wolof word.
const POIS = [
  { n: "Place de l'Indépendance", ll: [14.6683, -17.4318], t: "Le cœur du Plateau, centre administratif de Dakar. Le Sénégal est devenu indépendant le 4 avril 1960 ; c'est la fête nationale.", w: ["Dalal ak jàmm", "Bienvenue (en paix)"] },
  { n: "Palais présidentiel", ll: [14.6640, -17.4370], t: "Résidence du président de la République, face à l'océan. Sa garde rouge, à cheval ou à pied, est célèbre.", w: ["Njiit", "Chef, dirigeant"] },
  { n: "Marché Kermel", ll: [14.6683, -17.4290], t: "Marché couvert à l'architecture coloniale : fruits, poissons, fleurs et artisanat.", w: ["Ñaata la ?", "C'est combien ?"] },
  { n: "Marché Sandaga", ll: [14.6730, -17.4380], t: "Le grand marché populaire du centre-ville : tissus, électronique, tout s'y vend. Le marchandage fait partie de la culture.", w: ["Wàññi ko tuuti", "Baisse un peu le prix"] },
  { n: "Grande Mosquée de Dakar", ll: [14.6837, -17.4466], t: "Inaugurée en 1964, avec un minaret de 67 m. Plus de 90 % des Sénégalais sont musulmans, souvent membres d'une confrérie soufie.", w: ["Jërëjëf", "Merci"] },
  { n: "Musée des Civilisations noires", ll: [14.6812, -17.4400], t: "Ouvert en 2018, il célèbre l'histoire et les arts de l'Afrique et de sa diaspora. Son bâtiment rond s'inspire des cases traditionnelles.", w: ["Cosaan", "Les origines, la tradition"] },
  { n: "Université Cheikh Anta Diop", ll: [14.6905, -17.4620], t: "La plus grande université du pays, nommée d'après l'historien Cheikh Anta Diop, grand penseur de l'histoire africaine.", w: ["Jàng", "Étudier, apprendre"] },
  { n: "Plage de Soumbédioune", ll: [14.6790, -17.4605], t: "Le soir, les pirogues colorées des pêcheurs rentrent ici. Le poisson est la base du plat national, le thiéboudienne.", w: ["Ceebu jën", "Riz au poisson, le plat national"] },
  { n: "Monument de la Renaissance africaine", ll: [14.7221, -17.4950], t: "Statue de bronze de 52 m sur une colline des Mamelles, inaugurée en 2010 : plus haute que la statue de la Liberté.", w: ["Kanam", "L'avenir, devant"] },
  { n: "Phare des Mamelles", ll: [14.7253, -17.5019], t: "Construit en 1864 sur l'une des deux collines des Mamelles, il domine la presqu'île du Cap-Vert.", w: ["Leer", "La lumière"] },
  { n: "Pointe des Almadies", ll: [14.7440, -17.5290], t: "Le point le plus à l'ouest de toute l'Afrique continentale. Spot de surf et restaurants de fruits de mer.", w: ["Géej", "La mer"] },
  { n: "Embarcadère pour Gorée", ll: [14.6740, -17.4250], t: "La chaloupe part d'ici vers l'île de Gorée, classée au patrimoine mondial, lieu de mémoire de la traite négrière.", w: ["Fàttaliku", "Se souvenir"] },
  { n: "Stade Léopold Sédar Senghor", ll: [14.7470, -17.4520], t: "Nommé d'après le premier président, poète de la Négritude. Le football est une passion : les Lions ont gagné la CAN 2021.", w: ["Gaynde yi", "Les Lions"] },
  { n: "Lac Rose (Retba)", ll: [14.8380, -17.2340], t: "Un lac si salé qu'il devient rose sous le soleil, grâce à une micro-algue. Les récolteurs de sel y travaillent à la main.", w: ["Xorom", "Le sel"] },
  { n: "Vieille ville de Rufisque", ll: [14.7160, -17.2730], t: "Ancien port de l'arachide, l'une des quatre communes historiques du Sénégal colonial, avec ses maisons à balcons.", w: ["Gerte", "L'arachide"] },
  { n: "Diourbel", ll: [14.6555, -16.2316], t: "Capitale du Baol, au cœur du bassin arachidier. Cheikh Ahmadou Bamba, fondateur du mouridisme, y a vécu en résidence surveillée.", w: ["Baol-baol", "Habitant du Baol, commerçant débrouillard"] },
  { n: "Grande Mosquée de Touba", ll: [14.8611, -15.8757], t: "Ville sainte des mourides. Son minaret Lamp Fall mesure 87 m. Chaque année, le Magal y rassemble des millions de pèlerins.", w: ["Màggal", "Le grand pèlerinage"] },
].map(p => { const [x, z] = ll(...p.ll); return { ...p, x, z }; });
const found = new Set((() => { try { return JSON.parse(localStorage.getItem('dow-found')) || []; } catch (e) { return []; } })());
let poiT = 0;
function updateDiscover(dt) {
  poiT -= dt; if (poiT > 0) return; poiT = 0.5;
  for (const p of POIS) {
    if (found.has(p.n) || Math.hypot(p.x - player.x, p.z - player.z) > 260) continue;
    found.add(p.n); try { localStorage.setItem('dow-found', JSON.stringify([...found])); } catch (e) { }
    if (typeof story !== 'undefined') { story.money += 1000; saveStory(); }
    const el = $('poicard');
    el.innerHTML = `<small>DÉCOUVERTE ${found.size}/${POIS.length} · +1 000 FCFA</small><h3>${p.n}</h3><p>${p.t}</p><div class="w">Mot de wolof : <b>${p.w[0]}</b> — ${p.w[1]}</div>`;
    el.style.opacity = 1; el.style.transform = 'translateX(0)'; beep(880, 0.15, 0.05); setTimeout(() => beep(1320, 0.2, 0.05), 150);
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = 0; el.style.transform = 'translateX(30px)'; }, 11000);
    break;
  }
}
function drawPois(ctx, toScreen, r) { for (const p of POIS) { const [x, y] = toScreen(p.x, p.z); ctx.fillStyle = found.has(p.n) ? '#7fe08a' : '#4fb3ff'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.fillStyle = '#000'; ctx.font = `bold ${r * 1.4}px Inter`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('i', x, y + 1); } }

// ---------------- Mode histoire : chauffeur à Dakar ----------------
const CHAPTERS = [
  { title: 'Chapitre 1 — Le clando', car: 'clando', goal: 5, kind: 'city', minD: 700, maxD: 3200, perKm: 400,
    text: "Tu t'appelles Modou. Tu arrives de Diourbel avec un rêve : avoir ta propre affaire de transport. Ton cousin Pape te prête son vieux clando. Fais 5 courses dans Dakar pour gagner ta place." },
  { title: 'Chapitre 2 — Le car rapide', car: 'carrapide', goal: 3, kind: 'line', stops: 3, minD: 600, maxD: 2000, perKm: 250,
    text: "Le patron de la ligne Colobane–Petersen t'a remarqué. Prends le car rapide : ton apprenti appelle les clients, tu les charges à chaque arrêt et tu les déposes. Surtout, ne cabosse pas le car !" },
  { title: 'Chapitre 3 — La route des régions', car: 'ndiaga', goal: 1, kind: 'region', dest: 2, perKm: 60,
    text: "Tu montes en grade : un Ndiaga Ndiaye pour la ligne Dakar–Diourbel. Prends tes passagers et emmène-les au pays. Sur la route, appuie sur J pour avancer le voyage." },
  { title: 'Chapitre 4 — Le Magal de Touba', car: 'bustata', goal: 1, kind: 'region', dest: 3, perKm: 70,
    text: "C'est le Magal ! Des milliers de pèlerins partent pour Touba. On te confie un bus Tata plein. Arrive à Touba sans accident, inch'Allah." },
  { title: 'Mode libre — Patron du transport', car: null, goal: 1e9, kind: 'city', minD: 800, maxD: 6000, perKm: 450,
    text: "Tu as réussi : tu as ta propre compagnie de transport. Roule où tu veux, fais des courses quand tu veux (T pour être en service ou non) et profite de Dakar." },
];
const DLG = {
  pickup: ["Salamaleikoum chauffeur ! Je vais à {d}.", "Asalaa maalekum. {d}, bu la neexee.", "Chauffeur, {d} c'est combien ? … Bon, waaw, on y va.", "Na nga def ? Yobbu ma ci {d}, gaawal !", "Bonjour tonton, {d} s'il te plaît, je suis en retard."],
  ride: ["Ndank ndank chauffeur, doucement !", "Ce bouchon de Dakar, dafa metti…", "Monte la radio, c'est Youssou Ndour !", "Tu connais la route ? Prends à droite après le rond-point.", "Il fait chaud hein… Dakar dafa tàng tey.", "Mon cousin aussi fait le clando, à Pikine."],
  crash: ["Waaw ! Tu veux nous tuer ?", "Chauffeur, dama tiit ! Fais attention !", "Astaghfirullah… doucement !"],
  fast: ["Eh ! Tu conduis comme un pilote du Dakar !", "Gaaw nga ! Mais ne nous tue pas."],
  arrive: ["Jërëjëf ! Voilà ton argent.", "Merci chauffeur, Yàlla na la Yàlla barkeel.", "Ba beneen yoon ! À la prochaine."],
  apprenti: ["Colobane ! Colobane ! Petersen !", "Yoff, Ngor, Ouakam ! Am na palaas !", "Pikine ! Thiaroye ! Rufisque !", "Gare Petersen ! Sandaga ! Kaay, kaay !"],
  police: ["Chauffeur, la police ! Je descends ici moi !"],
};
const fill = (t, d) => t.replace('{d}', d);
const story = (() => { try { return JSON.parse(localStorage.getItem('dow-story')) || null; } catch (e) { return null; } })() || { ch: 0, done: 0, money: 2000, rides: 0 };
const saveStory = () => { try { localStorage.setItem('dow-story', JSON.stringify(story)); } catch (e) { } };
let mission = null, onDuty = true, subT = 0, rideTalkT = 0;
const fmt = n => Math.round(n).toLocaleString('fr-FR') + ' FCFA';
function subtitle(who, txt, dur = 4.5) { const el = $('subs'); el.innerHTML = `<b>${who}</b> ${txt}`; el.style.opacity = 1; subT = dur; }
function chapterCard() {
  const c = CHAPTERS[Math.min(story.ch, CHAPTERS.length - 1)];
  $('storycard').innerHTML = `<div><h2>${c.title}</h2><p>${c.text}</p><p class="m">Argent : ${fmt(story.money)}</p><button id="storygo">Commencer</button></div>`;
  $('storycard').style.display = 'flex'; started = false;
  $('storygo').onclick = () => { $('storycard').style.display = 'none'; started = true; if (c.car) setPlayerCar(c.car); mission = null; };
}
// mission marker: glowing yellow column like in GTA
const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const marker = new THREE.Group(); marker.add(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 40, 24, 1, true).translate(0, 20, 0), markerMat));
const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 5, 32), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.5; marker.add(ring);
marker.visible = false; scene.add(marker);
function roadSpot(minD, maxD, fromX = player.x, fromZ = player.z) {
  for (let t = 0; t < 40; t++) {
    let x, z, name = null;
    const cand = quartPlaces.filter(p => { const d = Math.hypot(p.x - fromX, p.z - fromZ); return d > minD && d < maxD; });
    if (cand.length && Math.random() < 0.8) { const p = pick(cand); x = p.x + rand(-150, 150); z = p.z + rand(-150, 150); name = p.name; }
    else { const a = rand(0, 6.28), d = rand(minD, maxD); x = fromX + Math.sin(a) * d; z = fromZ + Math.cos(a) * d; }
    const nr = nearestRoad(x, z, 2, r => r.t >= 2 && r.t <= 7); if (!nr || isWater(nr.x, nr.z)) continue;
    if (!name) { let best = 1e9; for (const p of quartPlaces) { const d = Math.hypot(p.x - nr.x, p.z - nr.z); if (d < best) { best = d; name = p.name; } } }
    return { x: nr.x, z: nr.z, name: name || 'le quartier' };
  }
  return null;
}
function setTarget(p) { waypoint = [p.x, p.z]; routeT = 0; marker.position.set(p.x, 0, p.z); marker.visible = true; }
function newMission() {
  const c = CHAPTERS[Math.min(story.ch, CHAPTERS.length - 1)];
  if (c.kind === 'region') {
    const gare = GARES[2]; const src = { x: gare.x, z: gare.z, name: gare.name }; const dst = CITIES[c.dest];
    const dn = nearestRoad(dst.p[0], dst.p[1], 3, r => r.t <= 6) || { x: dst.p[0], z: dst.p[1] };
    mission = { kind: 'region', stage: 'pickup', pick: src, drop: { x: dn.x, z: dn.z, name: dst.name }, pax: c.car === 'bustata' ? 45 : 18 };
  } else if (c.kind === 'line') {
    const stops = []; let fx = player.x, fz = player.z;
    const g0 = pick(GARES.slice(0, 2)); stops.push({ x: g0.x, z: g0.z, name: g0.name }); fx = g0.x; fz = g0.z;
    for (let i = 1; i <= c.stops; i++) { const s = roadSpot(c.minD, c.maxD, fx, fz); if (!s) return; stops.push(s); fx = s.x; fz = s.z; }
    mission = { kind: 'line', stage: 'pickup', stops, idx: 0, pax: 0, pick: stops[0] };
  } else {
    const src = roadSpot(200, 900); if (!src) return; const dst = roadSpot(c.minD, c.maxD, src.x, src.z); if (!dst) return;
    mission = { kind: 'city', stage: 'pickup', pick: src, drop: dst };
  }
  mission.hp0 = mission.lastHp = player.hp; setTarget(mission.pick);
  toast(`Client à ${mission.pick.name} — suis le GPS violet`);
}
function pay(base) {
  const dmg = Math.max(0, mission.hp0 - player.hp), late = Math.max(0, (time - mission.t0) - mission.t1);
  const tip = Math.max(0, Math.round((base * 0.3 - dmg * 40 - late * 15) / 25) * 25);
  story.money += base + tip; story.rides++; saveStory(); mission.hp0 = player.hp;
  showBig(`+ ${fmt(base + tip)}<small>Course ${fmt(base)} · pourboire ${fmt(tip)}${dmg > 10 ? ' (dégâts pendant la course)' : ''}</small>`); setTimeout(() => showBig(''), 2800);
}
function completeGoal() {
  story.done++; saveStory();
  const c = CHAPTERS[story.ch];
  if (story.done >= c.goal && story.ch < CHAPTERS.length - 1) { story.ch++; story.done = 0; saveStory(); setTimeout(chapterCard, 3000); }
}
function startLeg() { // car rapide: drive to the next stop
  mission.idx++; mission.drop = mission.stops[mission.idx]; mission.stage = 'carry';
  mission.t0 = time; mission.t1 = Math.hypot(mission.drop.x - player.x, mission.drop.z - player.z) / 9 + 20; setTarget(mission.drop);
}
function updateStory(dt) {
  if (subT > 0) { subT -= dt; if (subT <= 0) $('subs').style.opacity = 0; }
  const c = CHAPTERS[Math.min(story.ch, CHAPTERS.length - 1)];
  $('money').textContent = fmt(story.money);
  const sp = Math.hypot(player.vx, player.vz);
  if (!mission) { marker.visible = false; $('mission').innerHTML = onDuty ? `<b>${c.title}</b><br>Recherche d'un client…` : `<b>${c.title}</b><br>Hors service — T pour reprendre`; if (onDuty && !busted) newMission(); return; }
  ring.material.opacity = 0.6 + Math.sin(time * 5) * 0.3;
  const tgt = mission.stage === 'pickup' ? mission.pick : mission.drop;
  const d = Math.hypot(tgt.x - player.x, tgt.z - player.z);
  const prog = c.goal < 1e8 ? ` · ${story.done}/${c.goal}` : '';
  if (mission.stage === 'carry' && wanted > 0) { subtitle('Passager :', pick(DLG.police)); toast('Course perdue : la police te poursuit'); mission = null; waypoint = null; return; }
  if (mission.stage === 'pickup') {
    $('mission').innerHTML = `<b>${c.title}</b>${prog}<br>Va chercher ${mission.kind === 'city' ? 'ton client' : 'les passagers'} à <b>${tgt.name}</b> — ${(d / 1000).toFixed(1)} km<br><small>Arrête-toi dans le cercle jaune</small>`;
    if (d < 14 && sp < 3) {
      if (mission.kind === 'line') { mission.pax = 6 + (Math.random() * 8 | 0); subtitle('Apprenti :', pick(DLG.apprenti)); startLeg(); }
      else {
        mission.stage = 'carry'; mission.t0 = time; mission.hp0 = player.hp;
        mission.dist = Math.hypot(mission.drop.x - tgt.x, mission.drop.z - tgt.z); mission.t1 = mission.dist / 10 + 30;
        subtitle(mission.kind === 'region' ? 'Coxeur :' : 'Client :', mission.kind === 'region' ? `${mission.pax} passagers pour ${mission.drop.name} ! On part, bismillah !` : fill(pick(DLG.pickup), mission.drop.name));
        setTarget(mission.drop); rideTalkT = rand(12, 20);
      }
    }
    return;
  }
  const left = mission.t1 - (time - mission.t0);
  $('mission').innerHTML = `<b>${c.title}</b>${prog}<br>Dépose ${mission.kind === 'city' ? 'ton client' : `${mission.pax} passagers`} à <b>${tgt.name}</b> — ${(d / 1000).toFixed(1)} km${left > 0 ? ` · ${Math.ceil(left)} s` : ' · en retard'}`
    + (mission.kind === 'region' && d > 8000 ? '<br><small>Sur la route : J pour avancer le voyage</small>' : '');
  rideTalkT -= dt; if (rideTalkT < 0) { rideTalkT = rand(15, 28); subtitle('Passager :', pick(sp > 30 ? DLG.fast : DLG.ride)); }
  if (player.hp < mission.lastHp - 5) subtitle('Passager :', pick(DLG.crash)); mission.lastHp = player.hp;
  if (d < 16 && sp < 3) {
    if (mission.kind === 'line') {
      const prev = mission.stops[mission.idx - 1], km = Math.hypot(mission.drop.x - prev.x, mission.drop.z - prev.z) / 1000;
      const out = Math.min(mission.pax, 3 + (Math.random() * 5 | 0)); mission.pax -= out;
      pay(Math.round(Math.max(150, km * c.perKm) * out / 25) * 25);
      if (mission.idx >= mission.stops.length - 1) { subtitle('Apprenti :', 'Terminus ! Tout le monde descend.'); mission = null; waypoint = null; completeGoal(); }
      else { mission.pax += 3 + (Math.random() * 5 | 0); subtitle('Apprenti :', `${out} clients descendent… ${pick(DLG.apprenti)}`); startLeg(); }
    } else {
      const km = mission.dist / 1000, base = Math.max(500, km * c.perKm) * (mission.kind === 'region' ? mission.pax : 1);
      subtitle('Client :', pick(DLG.arrive)); pay(Math.round(base / 50) * 50);
      mission = null; waypoint = null; completeGoal();
    }
  }
}
function skipTravel() { // fast-forward a long regional trip
  if (!mission || mission.kind !== 'region' || mission.stage !== 'carry') return toast('Voyage rapide : seulement pendant une course vers les régions');
  const tgt = mission.drop; if (Math.hypot(tgt.x - player.x, tgt.z - player.z) < 8000) return toast('Tu es presque arrivé, continue !');
  const nr = nearestRoad(tgt.x - 2500, tgt.z, 4, r => r.t <= 3) || nearestRoad(tgt.x, tgt.z, 4);
  showBig('…<small>Quelques heures de route plus tard</small>'); setTimeout(() => showBig(''), 2200);
  const keep = mission; spawnAt(nr.x, nr.z); mission = keep; mission.t0 = time; mission.t1 = 240; setTarget(mission.drop);
}

// ---------------- Boot ----------------
(async () => {
  const bar = $('prog').firstElementChild;
  $('loadtxt').textContent = `${roads.length.toLocaleString('fr')} routes réelles · ${D.buildings.length.toLocaleString('fr')} bâtiments · chargement des véhicules…`;
  await loadAll(p => bar.style.width = (p * 100) + '%');
  landmarks(); initPeds();
  setPlayerCar('ferrari');
  // ?lieu=lat,lon&cap=deg&ambiance=n : partager un endroit precis de Dakar par un simple lien
  const url = new URLSearchParams(location.search), lieu = (url.get('lieu') || '').split(',').map(Number);
  if (url.has('ambiance')) modeIdx = clamp(+url.get('ambiance') | 0, 0, MODES.length - 1);
  applyMode();
  if (lieu.length === 2 && lieu.every(Number.isFinite)) spawnAt(...ll(lieu[0], lieu[1]));
  else spawnAt(CITIES[1].p[0], CITIES[1].p[1]);
  if (url.has('cap')) player.h = THREE.MathUtils.degToRad(+url.get('cap'));
  window.DOW = { player, spawnAt, ll, MODELS, PROPS, scene, camera, keys, get chunks() { return chunks; } };
  $('loadtxt').textContent = 'Prêt. Bienvenue à Dakar.';
  const btn = $('start'); btn.style.display = 'block';
  const go = () => { $('loading').style.display = 'none'; initAudio(); chapterCard(); };
  btn.onclick = go; addEventListener('keydown', e => { if (!started && e.code === 'Enter') go(); });
  loop();
})();

// ---------------- Mobile touch controls ----------------
// Touch buttons feed the same `keys` map as the keyboard; one-shot actions replay their key as a keydown.
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
  const pad = document.createElement('div'); pad.id = 'touchpad';
  const hold = [['tl', '◀', 'ArrowLeft'], ['tr', '▶', 'ArrowRight'], ['tb', 'FREIN', 'ArrowDown'], ['tg', 'GAZ', 'ArrowUp'], ['tn', 'NITRO', 'ShiftLeft'], ['th', 'FREIN À MAIN', 'Space']];
  const taps = [['KeyH', '📯'], ['KeyC', '🎥'], ['KeyY', '📻'], ['KeyV', '🚗'], ['KeyM', '🗺️'], ['KeyN', '🌗'], ['KeyJ', '⏩'], ['KeyR', '↺']];
  pad.innerHTML = hold.map(([id, t]) => `<button id="${id}" class="tbtn">${t}</button>`).join('') + `<div id="tact">${taps.map(([c, t]) => `<button class="tbtn" data-k="${c}">${t}</button>`).join('')}</div>`;
  document.body.appendChild(pad);
  for (const [id, , code] of hold) {
    const b = document.getElementById(id), on = (v) => (e) => { e.preventDefault(); keys[code] = v; b.classList.toggle('on', v); if (v) initAudio(); };
    b.addEventListener('pointerdown', on(true)); for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, on(false));
  }
  for (const b of pad.querySelectorAll('[data-k]')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); dispatchEvent(new KeyboardEvent('keydown', { code: b.dataset.k })); setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: b.dataset.k })), 80); });
  let savedQ = null; try { savedQ = localStorage.getItem('dow-quality'); } catch (e) { }
  if (savedQ === null) { qIdx = 0; Q = QUALITY[0]; renderer.setPixelRatio(Q.pr); }
}
