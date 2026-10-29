// Converts raw Overpass JSON into a compact game data file (data.js)
import fs from 'fs';
const dir = process.argv[2], out = process.argv[3];
const LAT0 = 14.67, LON0 = -17.44;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [Math.round((lon - LON0) * KX), Math.round(-(lat - LAT0) * KZ)];

const load = f => { try { const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')); return j.elements || []; } catch (e) { console.warn('skip', f, e.message); return []; } };

const TYPES = ['motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','service','track','link'];
const typeOf = h => h.endsWith('_link') ? 10 : Math.max(0, TYPES.indexOf(h));
const TOL = [4,3,2.5,2,1.5,1.2,1.2,1.2,1.5,2,1.5];

function dp(pts, tol, must) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  if (must) { const idx = [0]; must.forEach((m, i) => { if (m && i > 0 && i < pts.length - 1) { keep[i] = 1; idx.push(i); } }); idx.push(pts.length - 1);
    const out = []; for (let k = 0; k < idx.length - 1; k++) { const part = dp(pts.slice(idx[k], idx[k + 1] + 1), tol); out.push(...(k ? part.slice(1) : part)); } return out; }
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const names = [], nameIdx = new Map();
const nid = n => { if (!n) return -1; if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };

const seen = new Set(), roads = [];
const allUse = new Map();
{ const s2 = new Set(); for (const f of ["dakar_roads.json", "corridor.json", "diourbel.json", "touba.json"]) for (const w of load(f)) { if (w.type !== "way" || !w.nodes || s2.has(w.id)) continue; s2.add(w.id); for (const n of new Set(w.nodes)) allUse.set(n, (allUse.get(n) || 0) + 1); } }
const nodeUse = new Map(), nodePos = new Map();
for (const f of ['dakar_roads.json', 'corridor.json', 'diourbel.json', 'touba.json']) {
  for (const w of load(f)) {
    if (w.type !== 'way' || !w.geometry || seen.has(w.id)) continue;
    seen.add(w.id);
    const t = typeOf(w.tags.highway);
    if (t >= 1 && t <= 4 && w.nodes) w.nodes.forEach((n, i) => { const s = nodeUse.get(n) || new Set(); s.add(w.id); nodeUse.set(n, s); if (!nodePos.has(n)) nodePos.set(n, px(w.geometry[i].lat, w.geometry[i].lon)); });
    const pts = dp(w.geometry.map(g => px(g.lat, g.lon)), TOL[t], w.nodes ? w.nodes.map(n => allUse.get(n) > 1) : null);
    const flat = [];
    let px0 = 0, pz0 = 0;
    pts.forEach(([x, z], i) => { flat.push(x - px0, z - pz0); px0 = x; pz0 = z; }); // delta encoded
    const oneway = w.tags.oneway === 'yes' || w.tags.highway === 'motorway' ? 1 : 0;
    const lanes = +w.tags.lanes || 0;
    roads.push([t, nid(w.tags.name || w.tags.ref), oneway, lanes, flat]);
  }
}

const signals = [], places = [];
for (const n of load('extras.json').concat(load('touba_extras.json'))) {
  if (n.type !== 'node') continue;
  const [x, z] = px(n.lat, n.lon);
  if (n.tags.highway === 'traffic_signals') signals.push(x, z);
  else if (n.tags.place && n.tags.name) places.push([n.tags.name, n.tags.place, x, z]);
}

// synthetic signals at major junctions, thinned to >=140 m apart
{
  const cand = []; for (const [n, s] of nodeUse) if (s.size >= 2) cand.push(nodePos.get(n));
  const grid = new Map(), key = (x, z) => Math.floor(x / 140) + "," + Math.floor(z / 140);
  for (let i = 0; i < signals.length; i += 2) grid.set(key(signals[i], signals[i + 1]), 1);
  for (const [x, z] of cand) { const gx = Math.floor(x / 140), gz = Math.floor(z / 140); let ok = true;
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (grid.has((gx + a) + "," + (gz + b))) { ok = false; break; }
    if (ok) { grid.set(gx + "," + gz, 1); signals.push(x, z); } }
}
const bseen = new Set(), buildings = [];
for (const f of ['buildings.json', 'touba_buildings.json', 'diourbel_buildings.json', 'b_medina.json', 'b_grandyoff.json', 'b_parcelles.json', 'b_pikine.json', 'b_ouakam.json', 'b_yoff.json', 'b_guediawaye.json', 'b_rufisque.json']) {
  for (const w of load(f)) {
    if (w.type !== 'way' || !w.geometry || bseen.has(w.id)) continue;
    bseen.add(w.id);
    let raw = w.geometry.map(g => px(g.lat, g.lon));
    if (raw.length > 2 && raw[0][0] === raw.at(-1)[0] && raw[0][1] === raw.at(-1)[1]) raw.pop();
    let pts = raw.length > 6 ? dp(raw, 0.6) : raw;
    if (pts.length < 3) continue;
    let lv = +w.tags['building:levels'] || 0;
    if (!lv && w.tags.height) lv = Math.round(parseFloat(w.tags.height) / 3);
    const kind = w.tags.building === 'mosque' || w.tags.amenity === 'place_of_worship' ? 1 : 0;
    const flat = []; let a = 0, b = 0;
    for (const [x, z] of pts) { flat.push(x - a, z - b); a = x; b = z; }
    buildings.push([lv, kind, flat]);
  }
}

// Coastline: chain OSM coastline ways (land on the left) into one polyline, keep the part near Dakar
let coast = [];
{
  const ways = load('coast.json').filter(w => w.type === 'way' && w.nodes && w.geometry);
  const byStart = new Map(); ways.forEach(w => byStart.set(w.nodes[0], w));
  const hasPrev = new Set(ways.map(w => w.nodes.at(-1)));
  const used = new Set(); const chains = [];
  for (const w of ways) {
    if (used.has(w.id) || (hasPrev.has(w.nodes[0]) && byStart.get(w.nodes[0]) !== w && false)) continue;
  }
  // build chains starting from ways whose start isn't another way's end
  const starts = ways.filter(w => !hasPrev.has(w.nodes[0]));
  for (const s of (starts.length ? starts : ways)) {
    if (used.has(s.id)) continue;
    let w = s, pts = [];
    while (w && !used.has(w.id)) { used.add(w.id); pts.push(...w.geometry.map(g => [g.lat, g.lon])); w = byStart.get(w.nodes.at(-1)); }
    chains.push(pts);
  }
  // islands (closed small chains) are ignored; take the longest chain = mainland
  chains.sort((a, b) => b.length - a.length);
  const main = chains[0] || [];
  // keep the longest contiguous run inside the Dakar window
  const inside = p => p[0] > 14.45 && p[0] < 15.0 && p[1] < -17.02;
  let best = [], cur = [];
  for (const p of main) { if (inside(p)) cur.push(p); else { if (cur.length > best.length) best = cur; cur = []; } }
  if (cur.length > best.length) best = cur;
  coast = dp(best.map(p => px(p[0], p[1])), 6).flat();
  islands = chains.slice(1).filter(c => c.length > 8 && c.every(inside)).map(c => dp(c.map(p => px(p[0], p[1])), 4).flat());
}
var islands;
const data = { origin: [LAT0, LON0], types: TYPES, names, roads, signals, places, buildings, coast, islands };
fs.writeFileSync(out, 'window.MAP_DATA=' + JSON.stringify(data) + ';');
console.log({ roads: roads.length, names: names.length, signals: signals.length / 2, places: places.length, buildings: buildings.length, bytes: fs.statSync(out).size });
