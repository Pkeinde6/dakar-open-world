// Batiments Google Open Buildings (CC BY 4.0) pour le site : un petit fichier par carre de 200 m (le CELL de game.js),
// batiments/<gx>_<gz>.json = [[0, 0, flat delta], ...] comme D.buildings. Le site les telecharge au fil de la route.
// On ne garde que ceux qui ne recouvrent pas un batiment OSM deja dans data.js.
// usage: node tools/web_batiments.mjs <open_buildings_dakar.json>
import fs from 'fs';
const src = process.argv[2];
const s = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8'), D = JSON.parse(s.slice(s.indexOf('=') + 1).replace(/;\s*$/, ''));
const CELL = 200, cell = v => Math.floor(v / CELL), key = (x, z) => `${cell(x)}_${cell(z)}`;
const unflat = f => { const p = []; let x = 0, z = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; p.push([x, z]); } return p; };
const inP = (x, z, P) => { let r = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [a, b] = P[i], [c, d] = P[j]; if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) r = !r; } return r; };
const osm = new Map(); // carre -> [boite, contour] des batiments OSM
for (const [, , flat] of D.buildings) { const p = unflat(flat), xs = p.map(q => q[0]), zs = p.map(q => q[1]), b = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), p];
  for (let gx = cell(b[0]); gx <= cell(b[1]); gx++) for (let gz = cell(b[2]); gz <= cell(b[3]); gz++) { const k = `${gx}_${gz}`; (osm.get(k) || osm.set(k, []).get(k)).push(b); } }
const out = new Map(); let added = 0, dup = 0;
for (const p of JSON.parse(fs.readFileSync(src, 'utf8'))) {
  const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length;
  if ((osm.get(key(cx, cz)) || []).some(([x0, x1, z0, z1, q]) => cx > x0 && cx < x1 && cz > z0 && cz < z1 && inP(cx, cz, q))) { dup++; continue; }
  const flat = []; let px = 0, pz = 0; for (const [x, z] of p) { const rx = Math.round(x), rz = Math.round(z); flat.push(rx - px, rz - pz); px = rx; pz = rz; }
  const k = key(p[0][0], p[0][1]); (out.get(k) || out.set(k, []).get(k)).push([0, 0, flat]); added++; // carre du premier point, comme bGrid dans game.js
}
const dir = new URL('../batiments/', import.meta.url); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
let bytes = 0; for (const [k, v] of out) { const t = JSON.stringify(v); bytes += t.length; fs.writeFileSync(new URL(`${k}.json`, dir), t); }
console.log('ajoutes', added, 'deja dans OSM', dup, 'fichiers', out.size, 'Mo', (bytes / 1e6).toFixed(1));
