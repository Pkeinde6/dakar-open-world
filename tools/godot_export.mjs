// Exporte une zone reelle de Dakar pour le prototype Godot -> godot/data/quartier.json :
// routes (avec hauteur des ponts et rampes, meme calcul que game.js), batiments, parcs, places, stations-service.
// usage: node tools/godot_export.mjs [lat lon rayon_m]   (defaut : Plateau + debut de l'autoroute a Malick Sy, 1400 m)
import fs from 'fs';
const read = f => { const s = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'); return JSON.parse(s.slice(s.indexOf('=') + 1).replace(/;\s*$/, '')); };
const D = read('data.js'), L = read('lieux.js'), BR = read('bridges.js');
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const [lat, lon, R] = process.argv.length > 4 ? process.argv.slice(2).map(Number) : [14.6775, -17.4385, 1400];
const cx = (lon - LON0) * KX, cz = -(lat - LAT0) * KZ;
const WIDTH = [11, 11, 10, 9.5, 9, 8, 7.5, 5.5, 5, 4, 7], SIDEW = [0, 2.5, 3, 3, 2.5, 2, 2, 1, 1, 0, 0];
const unflat = f => { const p = []; let x = 0, z = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; p.push([x, z]); } return p; };
const local = p => p.map(([x, z]) => [+(x - cx).toFixed(1), +(z - cz).toFixed(1)]);
const near = p => p.some(([x, z]) => Math.hypot(x - cx, z - cz) < R);

// every road (world coordinates), then the bridge heights spread down the approach ramps at 8 %
const roads = D.roads.map(([t, ni, ow, lanes, flat, mw, ms]) => {
  const pts = []; for (const q of unflat(flat)) { const last = pts.at(-1); if (last) { const L = Math.hypot(q[0] - last[0], q[1] - last[1]), n = Math.ceil(L / 20); for (let k = 1; k < n; k++) pts.push([last[0] + (q[0] - last[0]) * k / n, last[1] + (q[1] - last[1]) * k / n]); } pts.push(q); }
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { t, ow, name: ni >= 0 ? D.names[ni] : '', w: mw ? mw / 10 : lanes ? Math.min(18, Math.max(5, lanes * 3.3 + 1)) : WIDTH[t], side: ms ? Math.min(3.5, ms / 10) : SIDEW[t], pts, cum, y: null };
});
{
  const DECK = 6.8, SLOPE = 0.08, vkey = (x, z) => Math.round(x) * 1e6 + Math.round(z), atV = new Map(), byEnds = new Map(), heap = [];
  roads.forEach((r, ri) => { r.pts.forEach(([x, z], i) => { if (Number.isInteger(x) && Number.isInteger(z)) { const k = vkey(x, z); (atV.get(k) || atV.set(k, []).get(k)).push(ri, i); } });
    const a = vkey(...r.pts[0]), b = vkey(...r.pts.at(-1)); byEnds.set(a + ':' + b, ri); byEnds.set(b + ':' + a, ri); });
  const raise = (ri, i, h) => { const r = roads[ri]; r.y ||= new Array(r.pts.length).fill(0); if (h > r.y[i] + 0.01) { r.y[i] = h; heap.push([h, ri, i]); heap.sort((p, q) => q[0] - p[0]); } };
  for (const [layer, over, x0, z0, x1, z1] of BR) { if (!over) continue; const ri = byEnds.get(vkey(x0, z0) + ':' + vkey(x1, z1)); if (ri === undefined || !near(roads[ri].pts)) continue; roads[ri].bridge = 1; roads[ri].pts.forEach((_, i) => raise(ri, i, DECK * Math.min(layer, 2))); }
  while (heap.length) {
    const [h, ri, i] = heap.shift(), r = roads[ri]; if (h < r.y[i] - 0.01) continue;
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < r.pts.length) raise(ri, j, h - SLOPE * Math.abs(r.cum[j] - r.cum[i]));
    const [x, z] = r.pts[i]; if (Number.isInteger(x) && Number.isInteger(z)) { const o = atV.get(vkey(x, z)); for (let k = 0; k < o.length; k += 2) if (o[k] !== ri) raise(o[k], o[k + 1], h); }
  }
}
const out = { centre: [lat, lon], roads: [], buildings: [], parks: [], places: [], fuel: [], coast: [], mosques: [], schools: [], cemeteries: [], markets: [] };
// la cote entiere (la mer est a l'ouest de cette ligne, comme dans game.js), les mosquees, ecoles, cimetieres
for (let i = 0; i < D.coast.length; i += 2) out.coast.push([+(D.coast[i] - cx).toFixed(1), +(D.coast[i + 1] - cz).toFixed(1)]);
{ const s0 = [D.coast[0], D.coast[1]], e = [D.coast.at(-2), D.coast.at(-1)]; // fermeture du polygone de la mer, comme waterPoly dans game.js
  out.coastClose = [[e[0] - 3000, 30000], [-30000, 30000], [-30000, -50000], [s0[0], -50000]].map(([x, z]) => [+(x - cx).toFixed(1), +(z - cz).toFixed(1)]); }
for (const [name, x, z, area, ...f] of L.mosquees) if (Math.hypot(x - cx, z - cz) < R) out.mosques.push({ name, x: +(x - cx).toFixed(1), z: +(z - cz).toFixed(1), area, pts: f.length >= 6 ? local(unflat(f)) : null });
out.signals = []; for (let i = 0; i < D.signals.length; i += 2) if (Math.hypot(D.signals[i] - cx, D.signals[i + 1] - cz) < R) out.signals.push([+(D.signals[i] - cx).toFixed(1), +(D.signals[i + 1] - cz).toFixed(1)]); // feux tricolores OSM
for (const [name, ...f] of L.ecoles) { const p = unflat(f); if (near(p)) out.schools.push({ name, pts: local(p) }); }
for (const [rel, ...f] of L.cimetieres) { const p = unflat(f); if (near(p)) out.cemeteries.push(local(p)); }
for (const r of roads) { if (r.t === 9 || !near(r.pts)) continue; out.roads.push({ t: r.t, ow: r.ow, name: r.name, w: r.w, side: r.side, bridge: r.bridge || 0, pts: local(r.pts), y: r.y && r.y.some(v => v > 0.05) ? r.y.map(v => +v.toFixed(2)) : null }); }
// style de quartier, comme styleAt() dans game.js : l'ancre la plus proche (rapportee a son rayon) gagne
const cache = process.env.OSM_CACHE || '.';
const ZONES = [['Dakar-Plateau', 'plateau', 1500], ['Rebeuss', 'medina', 700], ['Medina', 'medina', 1100], ['Gueule Tapée', 'medina', 700], ['Fass Delorme', 'medina', 600],
  ['Colobane', 'medina', 700], ['HLM Fass', 'sicap', 500], ['Point E', 'villa', 650], ['Fann Résidence', 'villa', 700], ['Fann', 'villa', 500], ['Fann Mermoz', 'villa', 500],
  ['Mermoz', 'villa', 900], ['Sacré Coeur', 'villa', 800], ['Almadies', 'villa', 1600], ['Ngor', 'villa', 900], ['Mamelles', 'villa', 900], ['Ouakam', 'banlieue', 900],
  ['Amitié', 'sicap', 700], ['Liberté', 'sicap', 1100], ['HLM', 'sicap', 800], ['Biscuiterie', 'sicap', 600], ['Castor', 'sicap', 600], ['Derklé', 'sicap', 600],
  ['Hann Bel-Air', 'banlieue', 1200], ['Grand Yoff', 'banlieue', 1100], ['Yoff', 'medina', 1300], ["Patte d'Oie", 'sicap', 700]]
  .map(([n, st, r]) => { const p = D.places.find(q => q[0] === n); return p && { x: p[2], z: p[3], st, r }; }).filter(Boolean);
const styleAt = (x, z) => { let best = 'banlieue', bd = 1; for (const a of ZONES) { const d = Math.hypot(a.x - x, a.z - z) / a.r; if (d < bd) { bd = d; best = a.st; } } return best; };
// batiments administratifs et publics OSM (ministeres, mairie, tribunal, hopitaux, hotels, bureaux), caches
const fa = `${cache}/admin.json`;
if (!fs.existsSync(fa)) {
  const bb = '14.64,-17.48,14.71,-17.40', q = `[out:json][timeout:120];(way["building"~"^(government|public|civic|hospital|hotel|office|commercial)$"](${bb});way["amenity"~"^(townhall|courthouse|hospital|police|bank|post_office)$"](${bb});way["office"="government"](${bb}););out tags geom;`;
  for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) }); const t = await r.text(); if (t.startsWith('{')) { fs.writeFileSync(fa, t); break; } } catch (e) { console.warn(E, e.message); }
  }
  if (!fs.existsSync(fa)) fs.writeFileSync(fa, '{"elements":[]}');
}
const admin = JSON.parse(fs.readFileSync(fa, 'utf8')).elements.filter(e => e.geometry).map(e => { const t = e.tags || {}, g = e.geometry.map(n => [(n.lon - LON0) * KX, -(n.lat - LAT0) * KZ]);
  const kind = t.amenity === 'hospital' || t.building === 'hospital' ? 'hopital' : t.building === 'hotel' ? 'hotel' : t.amenity === 'bank' || t.building === 'commercial' || t.building === 'office' ? 'bureau' : 'admin';
  return { kind, name: t.name || '', cx: g.reduce((s, p) => s + p[0], 0) / g.length, cz: g.reduce((s, p) => s + p[1], 0) / g.length, g }; });
const inP = (x, z, P) => { let r = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [a, b] = P[i], [c, d] = P[j]; if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) r = !r; } return r; };
for (const [lv, kind, flat] of D.buildings) { const p = unflat(flat); if (!near(p)) continue;
  const bx = p.reduce((s, q) => s + q[0], 0) / p.length, bz = p.reduce((s, q) => s + q[1], 0) / p.length;
  const a = admin.find(o => Math.abs(o.cx - bx) < 150 && Math.abs(o.cz - bz) < 150 && (inP(bx, bz, o.g) || inP(o.cx, o.cz, p)));
  out.buildings.push({ h: kind === 1 ? 11 : lv ? lv * 3.1 : 0, mosque: kind === 1, style: styleAt(bx, bz), use: a ? a.kind : '', name: a ? a.name : '', pts: local(p) }); }
for (const [t, ...f] of L.verts) { const p = unflat(f); if (t !== 1 && near(p)) out.parks.push(local(p)); }
for (const [name, ...f] of L.places || []) { const p = unflat(f); if (near(p)) out.places.push({ name, pts: local(p) }); }
// stations-service OSM (amenity=fuel), cachees dans le dossier donne
const ff = `${cache}/fuel.json`;
if (!fs.existsSync(ff)) {
  const q = `[out:json][timeout:90];(node["amenity"="fuel"](14.55,-17.55,14.95,-15.80);way["amenity"="fuel"](14.55,-17.55,14.95,-15.80););out center tags;`;
  for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) }); const t = await r.text(); if (t.startsWith('{')) { fs.writeFileSync(ff, t); break; } } catch (e) { console.warn(E, e.message); }
  }
  if (!fs.existsSync(ff)) fs.writeFileSync(ff, '{"elements":[]}');
}
for (const e of JSON.parse(fs.readFileSync(ff, 'utf8')).elements) { const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon, x = (lo - LON0) * KX, z = -(la - LAT0) * KZ;
  if (Math.hypot(x - cx, z - cz) < R) out.fuel.push({ name: e.tags?.brand || e.tags?.name || 'Station', x: +(x - cx).toFixed(1), z: +(z - cz).toFixed(1) }); }
// marches OSM (amenity=marketplace) : Sandaga, Kermel, Tilene...
const fm = `${cache}/marches.json`;
if (!fs.existsSync(fm)) {
  const q = `[out:json][timeout:90];(node["amenity"="marketplace"](14.55,-17.55,14.95,-15.80);way["amenity"="marketplace"](14.55,-17.55,14.95,-15.80););out tags geom;`;
  for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) }); const t = await r.text(); if (t.startsWith('{')) { fs.writeFileSync(fm, t); break; } } catch (e) { console.warn(E, e.message); }
  }
  if (!fs.existsSync(fm)) fs.writeFileSync(fm, '{"elements":[]}');
}
for (const e of JSON.parse(fs.readFileSync(fm, 'utf8')).elements) {
  const g = e.geometry ? e.geometry.map(n => [(n.lon - LON0) * KX, -(n.lat - LAT0) * KZ]) : [[(e.lon - LON0) * KX, -(e.lat - LAT0) * KZ]];
  if (near(g)) out.markets.push({ name: e.tags?.name || 'Marché', pts: local(g) });
}
fs.mkdirSync(new URL('../godot/data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../godot/data/quartier.json', import.meta.url), JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])), 'ponts/rampes:', out.roads.filter(r => r.y).length, 'autoroute:', out.roads.filter(r => r.t === 0).length, 'stations:', out.fuel.length, 'marches:', out.markets.map(m => m.name).join(', '), 'mosquees:', out.mosques.length, 'admin:', out.buildings.filter(b => b.use).length, 'styles:', JSON.stringify(out.buildings.reduce((o, b) => (o[b.style] = (o[b.style] || 0) + 1, o), {})));
