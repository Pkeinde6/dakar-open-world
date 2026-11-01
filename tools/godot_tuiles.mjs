// Tout Dakar pour la version Godot, decoupe en tuiles de 400 m -> godot/data/tuiles/<tx>_<tz>.json + godot/data/monde.json
// Le jeu ne construit que les tuiles autour du joueur et en ajoute au fur et a mesure qu'il roule.
// Chaque route est coupee en morceaux par tuile (un segment va a la tuile de son milieu) ; les morceaux voisins partagent
// leur point de jonction, et endA / endB disent si un bout est un vrai bout de rue (carrefour) ou une simple coupure.
// usage: OSM_CACHE=<dossier cache overpass> node tools/godot_tuiles.mjs
import fs from 'fs';
const read = f => { const s = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'); return JSON.parse(s.slice(s.indexOf('=') + 1).replace(/;\s*$/, '')); };
const D = read('data.js'), L = read('lieux.js'), BR = read('bridges.js');
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const TILE = 400, XMAX = 30000; // la region de Dakar (Diourbel et Touba plus tard)
const WIDTH = [11, 11, 10, 9.5, 9, 8, 7.5, 5.5, 5, 4, 7], SIDEW = [0, 2.5, 3, 3, 2.5, 2, 2, 1, 1, 0, 0];
const cache = process.env.OSM_CACHE || '.';
const unflat = f => { const p = []; let x = 0, z = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; p.push([x, z]); } return p; };
const r1 = v => Math.round(v * 10) / 10, rp = p => p.map(([x, z]) => [r1(x), r1(z)]);
const tileOf = (x, z) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
const tiles = new Map(), T = k => tiles.get(k) || tiles.set(k, { roads: [], buildings: [], parks: [], places: [], mosques: [], schools: [], markets: [], fuel: [], signals: [] }).get(k);
const centre = p => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

// style de quartier (meme table que game.js)
const ZONES = [['Dakar-Plateau', 'plateau', 1500], ['Rebeuss', 'medina', 700], ['Medina', 'medina', 1100], ['Gueule Tapée', 'medina', 700], ['Fass Delorme', 'medina', 600],
  ['Colobane', 'medina', 700], ['HLM Fass', 'sicap', 500], ['Point E', 'villa', 650], ['Fann Résidence', 'villa', 700], ['Fann', 'villa', 500], ['Fann Mermoz', 'villa', 500],
  ['Mermoz', 'villa', 900], ['Sacré Coeur', 'villa', 800], ['Almadies', 'villa', 1600], ['Ngor', 'villa', 900], ['Mamelles', 'villa', 900], ['Ouakam', 'banlieue', 900],
  ['Amitié', 'sicap', 700], ['Liberté', 'sicap', 1100], ['HLM', 'sicap', 800], ['Biscuiterie', 'sicap', 600], ['Castor', 'sicap', 600], ['Derklé', 'sicap', 600],
  ['Hann Bel-Air', 'banlieue', 1200], ['Grand Yoff', 'banlieue', 1100], ['Arafat', 'banlieue', 600], ['Cité Millionnaire', 'banlieue', 500], ['Yoff', 'medina', 1300],
  ["Patte d'Oie", 'sicap', 700], ['Parcelles Assainies', 'banlieue', 2200], ['Pikine', 'banlieue', 3500], ['Guédiawaye', 'banlieue', 3000], ['Thiaroye', 'banlieue', 2500],
  ['Yeumbeul', 'banlieue', 2500], ['Keur Massar', 'banlieue', 3000], ['Malika', 'banlieue', 2000], ['Rufisque', 'medina', 2500], ['Bargny', 'banlieue', 2000]]
  .map(([n, st, r]) => { const p = D.places.find(q => q[0] === n); return p && { x: p[2], z: p[3], st, r }; }).filter(Boolean);
const styleAt = (x, z) => { let best = 'banlieue', bd = 1; for (const a of ZONES) { const d = Math.hypot(a.x - x, a.z - z) / a.r; if (d < bd) { bd = d; best = a.st; } } return best; };

// routes, puis hauteur des ponts descendue en rampes a 8 % (comme game.js, avec un vrai tas)
const roads = D.roads.map(([t, ni, ow, lanes, flat, mw, ms]) => {
  const pts = []; for (const q of unflat(flat)) { const last = pts.at(-1); if (last) { const L = Math.hypot(q[0] - last[0], q[1] - last[1]), n = Math.ceil(L / 20); for (let k = 1; k < n; k++) pts.push([last[0] + (q[0] - last[0]) * k / n, last[1] + (q[1] - last[1]) * k / n]); } pts.push(q); }
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { t, ow, name: ni >= 0 ? D.names[ni] : '', w: mw ? mw / 10 : lanes ? Math.min(18, Math.max(5, lanes * 3.3 + 1)) : WIDTH[t], side: ms ? Math.min(3.5, ms / 10) : SIDEW[t], pts, cum, y: null };
}).filter(r => r.pts.length > 1 && r.pts[0][0] < XMAX);
{
  const DECK = 6.8, SLOPE = 0.08, vkey = (x, z) => Math.round(x) * 1e6 + Math.round(z), atV = new Map(), byEnds = new Map(), heap = [];
  const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] >= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] > heap[m][0]) m = l; if (r < heap.length && heap[r][0] > heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  roads.forEach((r, ri) => { r.pts.forEach(([x, z], i) => { if (Number.isInteger(x) && Number.isInteger(z)) { const k = vkey(x, z); (atV.get(k) || atV.set(k, []).get(k)).push(ri, i); } });
    const a = vkey(...r.pts[0]), b = vkey(...r.pts.at(-1)); byEnds.set(a + ':' + b, ri); byEnds.set(b + ':' + a, ri); });
  const raise = (ri, i, h) => { const r = roads[ri]; r.y ||= new Array(r.pts.length).fill(0); if (h > r.y[i] + 0.01) { r.y[i] = h; push([h, ri, i]); } };
  for (const [layer, over, x0, z0, x1, z1] of BR) { if (!over) continue; const ri = byEnds.get(vkey(x0, z0) + ':' + vkey(x1, z1)); if (ri === undefined) continue; roads[ri].pts.forEach((_, i) => raise(ri, i, DECK * Math.min(layer, 2))); }
  while (heap.length) {
    const [h, ri, i] = pop(), r = roads[ri]; if (h < r.y[i] - 0.01) continue;
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < r.pts.length) raise(ri, j, h - SLOPE * Math.abs(r.cum[j] - r.cum[i]));
    const [x, z] = r.pts[i]; if (Number.isInteger(x) && Number.isInteger(z)) { const o = atV.get(vkey(x, z)); for (let k = 0; k < o.length; k += 2) if (o[k] !== ri) raise(o[k], o[k + 1], h); }
  }
}
roads.forEach((r, id) => {
  if (r.t === 9) return; const st = styleAt(...r.pts[r.pts.length >> 1]), up = r.y && r.y.some(v => v > 0.05);
  let start = 0;
  for (let i = 0; i < r.pts.length - 1; i++) { // morceaux consecutifs dans la meme tuile
    const k = tileOf((r.pts[i][0] + r.pts[i + 1][0]) / 2, (r.pts[i][1] + r.pts[i + 1][1]) / 2), next = i + 1 < r.pts.length - 1 ? tileOf((r.pts[i + 1][0] + r.pts[i + 2][0]) / 2, (r.pts[i + 1][1] + r.pts[i + 2][1]) / 2) : null;
    if (next === k) continue;
    T(k).roads.push({ id, t: r.t, ow: r.ow, name: r.name, w: r.w, side: r.side, style: st, endA: start === 0, endB: i + 1 === r.pts.length - 1,
      pts: rp(r.pts.slice(start, i + 2)), y: up ? r.y.slice(start, i + 2).map(v => +v.toFixed(2)) : null });
    start = i + 1;
  }
});
// batiments administratifs (cache Overpass sur toute la region)
const fa = `${cache}/admin_dakar.json`;
async function overpass(file, q) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).elements;
  for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) }); const t = await r.text(); if (t.startsWith('{')) { fs.writeFileSync(file, t); return JSON.parse(t).elements; } } catch (e) { console.warn(E, e.message); }
  }
  return [];
}
const bb = '14.62,-17.55,14.85,-17.15';
const admin = (await overpass(fa, `[out:json][timeout:180];(way["building"~"^(government|public|civic|hospital|hotel|office)$"](${bb});way["amenity"~"^(townhall|courthouse|hospital|police|bank|post_office)$"](${bb});way["office"="government"](${bb}););out tags geom;`))
  .filter(e => e.geometry).map(e => { const t = e.tags || {}, g = e.geometry.map(n => [(n.lon - LON0) * KX, -(n.lat - LAT0) * KZ]), [cx, cz] = centre(g);
    return { kind: t.amenity === 'hospital' || t.building === 'hospital' ? 'hopital' : t.building === 'hotel' ? 'hotel' : t.amenity === 'bank' || t.building === 'office' ? 'bureau' : 'admin', name: t.name || '', cx, cz, g }; });
const agrid = new Map(); for (const a of admin) { const k = tileOf(a.cx, a.cz); (agrid.get(k) || agrid.set(k, []).get(k)).push(a); }
const inP = (x, z, P) => { let r = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [a, b] = P[i], [c, d] = P[j]; if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) r = !r; } return r; };
for (const [lv, kind, flat] of D.buildings) {
  const p = unflat(flat), [bx, bz] = centre(p); if (bx > XMAX) continue; const k = tileOf(bx, bz);
  const a = (agrid.get(k) || []).find(o => inP(bx, bz, o.g) || inP(o.cx, o.cz, p));
  T(k).buildings.push({ h: kind === 1 ? 11 : lv ? lv * 3.1 : 0, mosque: kind === 1, style: styleAt(bx, bz), use: a ? a.kind : '', name: a ? a.name : '', pts: rp(p) });
}
for (const [t, ...f] of L.verts) { if (t === 1) continue; const p = unflat(f), [x, z] = centre(p); if (x < XMAX) T(tileOf(x, z)).parks.push(rp(p)); }
for (const [name, ...f] of L.places || []) { const p = unflat(f), [x, z] = centre(p); if (x < XMAX) T(tileOf(x, z)).places.push({ name, pts: rp(p) }); }
for (const [name, x, z, area, ...f] of L.mosquees) if (x < XMAX) T(tileOf(x, z)).mosques.push({ name, x: r1(x), z: r1(z), area, pts: f.length >= 6 ? rp(unflat(f)) : null });
for (const [name, ...f] of L.ecoles) { const p = unflat(f), [x, z] = centre(p); if (x < XMAX) T(tileOf(x, z)).schools.push({ name, pts: rp(p) }); }
for (let i = 0; i < D.signals.length; i += 2) if (D.signals[i] < XMAX) T(tileOf(D.signals[i], D.signals[i + 1])).signals.push([r1(D.signals[i]), r1(D.signals[i + 1])]);
for (const e of JSON.parse(fs.readFileSync(`${cache}/fuel.json`, 'utf8')).elements) { const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, x = (lo - LON0) * KX, z = -(la - LAT0) * KZ;
  if (x < XMAX) T(tileOf(x, z)).fuel.push({ name: e.tags?.brand || e.tags?.name || 'Station', x: r1(x), z: r1(z) }); }
for (const e of JSON.parse(fs.readFileSync(`${cache}/marches.json`, 'utf8')).elements) {
  const g = e.geometry ? e.geometry.map(n => [(n.lon - LON0) * KX, -(n.lat - LAT0) * KZ]) : [[(e.lon - LON0) * KX, -(e.lat - LAT0) * KZ]], [x, z] = centre(g);
  if (x < XMAX) T(tileOf(x, z)).markets.push({ name: e.tags?.name || 'Marché', pts: rp(g) }); }

const dir = new URL('../godot/data/tuiles/', import.meta.url); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
let bytes = 0; for (const [k, v] of tiles) { const s = JSON.stringify(v); bytes += s.length; fs.writeFileSync(new URL(`${k}.json`, dir), s); }
const coast = []; for (let i = 0; i < D.coast.length; i += 2) coast.push([r1(D.coast[i]), r1(D.coast[i + 1])]);
const s0 = [D.coast[0], D.coast[1]], e = [D.coast.at(-2), D.coast.at(-1)];
const spawn = (([x, z]) => [r1(x), r1(z)])([(-17.4320 - LON0) * KX, -(14.6695 - LAT0) * KZ]); // Place de l'Independance
fs.writeFileSync(new URL('../godot/data/monde.json', import.meta.url), JSON.stringify({ tile: TILE, spawn, coast, coastClose: [[e[0] - 3000, 30000], [-30000, 30000], [-30000, -50000], [s0[0], -50000]], tiles: [...tiles.keys()] }));
console.log('tuiles', tiles.size, 'Mo', (bytes / 1e6).toFixed(1), 'admin', admin.length, 'routes', roads.length);
