// Real places from OpenStreetMap -> lieux.js: window.LIEUX = { verts, ecoles, mosquees, cimetieres }
//   verts:      [kind, flat...]   kind 0 park/garden, 1 pitch, 2 grass/green, 3 playground  (closed outlines, delta-encoded)
//   ecoles:     [name, flat...]
//   mosquees:   [name, x, z, area, flat...]  (flat empty for node-only mosques)
//   cimetieres: [religion, flat...]
// usage: node tools/lieux.mjs [cache-dir]
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [Math.round((lon - LON0) * KX), Math.round(-(lat - LAT0) * KZ)];
const dir = process.argv[2] || '.', BBOX = '14.55,-17.55,14.95,-15.80';
const Q = `[out:json][timeout:240];(
way["leisure"~"^(park|garden|pitch|playground)$"](${BBOX});
way["landuse"~"^(grass|recreation_ground|village_green|cemetery)$"](${BBOX});
way["amenity"~"^(school|college|university|kindergarten|grave_yard)$"](${BBOX});
way["amenity"="place_of_worship"](${BBOX});
node["amenity"="place_of_worship"](${BBOX});
way["building"="mosque"](${BBOX});
);out tags geom;`;
async function overpass(file, q) {
  const f = `${dir}/${file}`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
  for (let t = 0; t < 6; t++) for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) });
      const s = await r.text(); if (s.startsWith('{')) { fs.writeFileSync(f, s); return JSON.parse(s).elements; } console.warn(E, s.slice(0, 80)); } catch (e) { console.warn(E, e.message); }
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('overpass');
}
const els = await overpass('lieux.json', Q);
const flat = g => { const p = g.map(n => px(n.lat, n.lon)); if (p.length > 2 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]) p.pop(); const o = []; let a = 0, b = 0; for (const [x, z] of p) { o.push(x - a, z - b); a = x; b = z; } return o; };
const area = g => { const p = g.map(n => px(n.lat, n.lon)); let s = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; s += x1 * z2 - x2 * z1; } return Math.abs(s / 2); };
const out = { verts: [], ecoles: [], mosquees: [], cimetieres: [] }, seen = new Set();
for (const e of els) {
  if (seen.has(e.type + e.id)) continue; seen.add(e.type + e.id); const t = e.tags || {};
  const muslim = (t.amenity === 'place_of_worship' && (t.religion === 'muslim' || /mosqu|jumm|djami/i.test(t.name || ''))) || t.building === 'mosque';
  if (muslim) {
    if (e.type === 'node') { const [x, z] = px(e.lat, e.lon); out.mosquees.push([t.name || '', x, z, 0]); }
    else if (e.geometry) { const p = e.geometry.map(n => px(n.lat, n.lon)), cx = p.reduce((s, q) => s + q[0], 0) / p.length, cz = p.reduce((s, q) => s + q[1], 0) / p.length; out.mosquees.push([t.name || '', Math.round(cx), Math.round(cz), Math.round(area(e.geometry)), ...flat(e.geometry)]); }
    continue;
  }
  if (!e.geometry || e.geometry.length < 4) continue;
  if (/^(school|college|university|kindergarten)$/.test(t.amenity)) out.ecoles.push([t.name || '', ...flat(e.geometry)]);
  else if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') out.cimetieres.push([t.religion === 'christian' ? 1 : 0, ...flat(e.geometry)]);
  else if (t.leisure === 'park' || t.leisure === 'garden') out.verts.push([0, ...flat(e.geometry)]);
  else if (t.leisure === 'pitch') out.verts.push([1, ...flat(e.geometry)]);
  else if (t.leisure === 'playground') out.verts.push([3, ...flat(e.geometry)]);
  else out.verts.push([2, ...flat(e.geometry)]);
}
fs.writeFileSync(new URL('../lieux.js', import.meta.url), `window.LIEUX=${JSON.stringify(out)};`);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), 'mosquees nommees:', out.mosquees.filter(m => m[0]).length);
