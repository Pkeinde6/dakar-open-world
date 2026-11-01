// Stades et eglises reels (OpenStreetMap) -> edifices.js : window.EDIFICES = { stades, eglises }
//   stades:  [nom, [x, z, x, z, ...]]   contour (leisure=stadium, building=stadium)
//   eglises: [nom, [x, z, ...]]         contour du batiment ; [nom, [x, z]] quand OSM n'a qu'un point
// usage: node tools/edifices.mjs [cache-dir]
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [Math.round((lon - LON0) * KX * 10) / 10, Math.round(-(lat - LAT0) * KZ * 10) / 10];
const dir = process.argv[2] || '.', BBOX = '14.55,-17.55,14.95,-15.80';
async function overpass(file, q) {
  const f = `${dir}/${file}`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
  for (let t = 0; t < 6; t++) for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'])
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) });
      const s = await r.text(); if (s.startsWith('{')) { fs.writeFileSync(f, s); return JSON.parse(s).elements; } console.warn(E, s.slice(0, 80)); } catch (e) { console.warn(E, e.message); }
  throw new Error('overpass');
}
const els = await overpass('edifices.json', `[out:json][timeout:180];(
way["leisure"="stadium"](${BBOX}); relation["leisure"="stadium"](${BBOX}); way["building"="stadium"](${BBOX});
way["amenity"="place_of_worship"]["religion"="christian"](${BBOX}); node["amenity"="place_of_worship"]["religion"="christian"](${BBOX});
way["building"~"^(church|cathedral|chapel)$"](${BBOX});
);out tags geom;`);
const out = { stades: [], eglises: [] }, seen = new Set();
const ring = (g) => { const p = g.map(n => px(n.lat, n.lon)); if (p.length > 2 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]) p.pop(); return p; };
const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; s += x1 * z2 - x2 * z1; } return Math.abs(s / 2); };
for (const e of els) {
  const t = e.tags || {}, name = (t.name || '').slice(0, 40);
  let p = null;
  if (e.type === 'way' && e.geometry) p = ring(e.geometry);
  else if (e.type === 'relation') { const m = (e.members || []).filter(m => m.role === 'outer' && m.geometry).sort((a, b) => b.geometry.length - a.geometry.length)[0]; if (m) p = ring(m.geometry); }
  else if (e.type === 'node') p = [px(e.lat, e.lon)];
  if (!p || !p.length) continue;
  const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length], [0, 0]), key = `${Math.round(c[0] / 40)},${Math.round(c[1] / 40)}`;
  if (t.leisure === 'stadium' || t.building === 'stadium') { if (p.length < 3 || area(p) < 3000 || seen.has('s' + key)) continue; seen.add('s' + key); out.stades.push([name, p.flat()]); }
  else { if (seen.has('e' + key) || (p.length > 2 && (area(p) < 60 || area(p) > 12000))) continue; seen.add('e' + key); out.eglises.push([name, p.flat()]); }
}
fs.writeFileSync(new URL('../edifices.js', import.meta.url), 'window.EDIFICES=' + JSON.stringify(out) + ';\n');
console.log('stades', out.stades.length, out.stades.map(s => s[0]).filter(Boolean).slice(0, 12).join(' | '));
console.log('eglises', out.eglises.length, out.eglises.map(s => s[0]).filter(Boolean).slice(0, 12).join(' | '));
