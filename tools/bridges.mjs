// Road bridges from OpenStreetMap -> bridges.js: window.BRIDGES = [[layer, over, x0, z0, x1, z1, xm, zm], ...]
// over = 1 when the bridge spans another road or a railway (an overpass, deck ~7 m up), 0 over water/canals (low deck).
// The game matches each entry to its road by the end points (data.js keeps OSM ways one road per way).
// usage: node tools/bridges.mjs [cache-dir]
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [Math.round((lon - LON0) * KX), Math.round(-(lat - LAT0) * KZ)];
const dir = process.argv[2] || '.';
const BBOX = '14.55,-17.55,14.95,-15.80';
async function overpass(file, q) {
  const f = `${dir}/${file}`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
  for (let tries = 0; tries < 6; tries++) for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) });
      const t = await r.text(); if (t.startsWith('{')) { fs.writeFileSync(f, t); return JSON.parse(t).elements; } console.warn(E, t.slice(0, 80)); } catch (e) { console.warn(E, e.message); }
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('overpass ' + file);
}
const HW = 'motorway|trunk|primary|secondary|tertiary|residential|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const bridges = await overpass('bridges.json', `[out:json][timeout:180];way["highway"~"^(${HW})$"]["bridge"~"^(yes|viaduct)$"](${BBOX});out tags geom;`);
const rails = await overpass('rails.json', `[out:json][timeout:180];way["railway"~"^(rail|light_rail)$"](${BBOX});out geom;`);

// every road / railway segment, to test what each bridge crosses
const segs = [];
for (const [, , , , flat] of D.roads) { let x = 0, z = 0; const p = []; for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; p.push([x, z]); } for (let i = 0; i + 1 < p.length; i++) segs.push([...p[i], ...p[i + 1]]); }
for (const w of rails) { const p = w.geometry.map(g => px(g.lat, g.lon)); for (let i = 0; i + 1 < p.length; i++) segs.push([...p[i], ...p[i + 1]]); }
const cross = (a, b, c, d) => { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0; };

const out = [];
for (const w of bridges) {
  const p = w.geometry.map(g => px(g.lat, g.lon)); if (p.length < 2) continue;
  let over = 0;
  for (let i = 0; i + 1 < p.length && !over; i++) for (const s of segs) if (cross(p[i], p[i + 1], [s[0], s[1]], [s[2], s[3]])) { over = 1; break; }
  const m = p[p.length >> 1];
  out.push([Math.max(1, +w.tags.layer || 1), over, ...p[0], ...p.at(-1), ...m]);
}
fs.writeFileSync(new URL('../bridges.js', import.meta.url), `window.BRIDGES=${JSON.stringify(out)};`);
console.log(out.length, 'ponts,', out.filter(b => b[1]).length, 'au-dessus d\'une route ou d\'un rail');
