// Le BRT de Dakar (Petersen <-> Prefecture de Guediawaye) d'apres OpenStreetMap -> brt.js : window.BRT = { line, stops }
//   line:  [[x, z], ...]        trace continu de la ligne (le plus long des deux sens), points tous les ~20 m
//   stops: [[x, z, nom], ...]   stations
// usage: node tools/brt.mjs [cache-dir]
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [Math.round((lon - LON0) * KX * 10) / 10, Math.round(-(lat - LAT0) * KZ * 10) / 10];
const dir = process.argv[2] || '.', BBOX = '14.62,-17.50,14.82,-17.35';
async function overpass(file, q) {
  const f = `${dir}/${file}`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
  for (let t = 0; t < 6; t++) for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'])
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) });
      const s = await r.text(); if (s.startsWith('{')) { fs.writeFileSync(f, s); return JSON.parse(s).elements; } console.warn(E, s.slice(0, 80)); } catch (e) { console.warn(E, e.message); }
  throw new Error('overpass');
}
const els = await overpass('brt2.json', `[out:json][timeout:120];
(relation["route"="bus"]["name"~"BRT",i](${BBOX}); relation["route"="bus"]["network"~"BRT",i](${BBOX}); relation["route"="bus"]["ref"~"BRT",i](${BBOX});)->.r;
.r out geom; node(r.r); out tags;`);
const rels = els.filter(e => e.type === 'relation');
console.log('relations', rels.map(r => `${r.id} ${r.tags.name || ''} (${r.members.length})`));
if (!rels.length) throw new Error('pas de relation BRT');
// chaine les chemins d'une relation dans l'ordre, en retournant ceux qui sont a l'envers
function chain(rel) {
  const out = [];
  for (const m of rel.members) { if (m.type !== 'way' || !m.geometry || (m.role && !/^(forward|backward)?$/.test(m.role))) continue;
    let g = m.geometry.map(n => px(n.lat, n.lon)); if (!out.length) { out.push(...g); continue; }
    const end = out[out.length - 1], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d(end, g[g.length - 1]) < d(end, g[0])) g = g.reverse();
    if (out.length === g.length && d(out[0], g[0]) < d(end, g[0])) out.reverse();
    out.push(...g.slice(d(end, g[0]) < 1 ? 1 : 0)); }
  return out;
}
let line = rels.map(chain).sort((a, b) => b.length - a.length)[0];
// points reguliers (~20 m) : la voie et les bus en ont besoin
const dense = [line[0]]; for (let i = 1; i < line.length; i++) { const [ax, az] = dense[dense.length - 1], [bx, bz] = line[i], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue; const n = Math.ceil(L / 20); for (let k = 1; k <= n; k++) dense.push([+(ax + (bx - ax) * k / n).toFixed(1), +(az + (bz - az) * k / n).toFixed(1)]); }
const stops = [], seen = new Set();
for (const r of rels) for (const m of r.members) if (m.type === 'node' && /stop|platform/.test(m.role || '') && m.lat) {
  const [x, z] = px(m.lat, m.lon), k = `${Math.round(x / 60)},${Math.round(z / 60)}`; if (seen.has(k)) continue; seen.add(k);
  const nd = els.find(e => e.type === 'node' && e.id === m.ref); stops.push([x, z, nd?.tags?.name || '']); }
fs.writeFileSync(new URL('../brt.js', import.meta.url), 'window.BRT=' + JSON.stringify({ line: dense, stops }) + ';\n');
let len = 0; for (let i = 1; i < dense.length; i++) len += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
console.log('brt.js : ligne', (len / 1000).toFixed(1), 'km,', dense.length, 'points,', stops.length, 'stations');
