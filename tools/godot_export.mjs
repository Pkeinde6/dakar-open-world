// Exporte un quartier reel de Dakar (routes, batiments, parcs, places) pour le prototype Godot -> godot/data/quartier.json
// usage: node tools/godot_export.mjs [lat lon rayon_m]   (defaut : Place de l'Independance, 600 m)
import fs from 'fs';
const read = f => { const s = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'); return JSON.parse(s.slice(s.indexOf('=') + 1).replace(/;\s*$/, '')); };
const D = read('data.js'), L = read('lieux.js');
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const [lat, lon, R] = process.argv.length > 4 ? process.argv.slice(2).map(Number) : [14.6695, -17.4320, 600];
const cx = (lon - LON0) * KX, cz = -(lat - LAT0) * KZ;
const WIDTH = [11, 11, 10, 9.5, 9, 8, 7.5, 5.5, 5, 4, 7], SIDEW = [0, 2.5, 3, 3, 2.5, 2, 2, 1, 1, 0, 0];
const unflat = f => { const p = []; let x = 0, z = 0; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; p.push([+(x - cx).toFixed(1), +(z - cz).toFixed(1)]); } return p; };
const near = p => p.some(([x, z]) => Math.hypot(x, z) < R);
const out = { centre: [lat, lon], roads: [], buildings: [], parks: [], places: [] };
for (const [t, ni, ow, lanes, flat, mw, ms] of D.roads) {
  if (t === 9) continue; const pts = unflat(flat); if (!near(pts)) continue;
  out.roads.push({ t, name: ni >= 0 ? D.names[ni] : '', w: mw ? mw / 10 : lanes ? Math.min(18, Math.max(5, lanes * 3.3 + 1)) : WIDTH[t], side: ms ? Math.min(3.5, ms / 10) : SIDEW[t], pts });
}
for (const [lv, kind, flat] of D.buildings) { const pts = unflat(flat); if (near(pts)) out.buildings.push({ h: kind === 1 ? 11 : lv ? lv * 3.1 : 0, mosque: kind === 1, pts }); }
for (const [t, ...f] of L.verts) { const pts = unflat(f); if (t !== 1 && near(pts)) out.parks.push(pts); }
for (const [name, ...f] of L.places || []) { const pts = unflat(f); if (near(pts)) out.places.push({ name, pts }); }
fs.mkdirSync(new URL('../godot/data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../godot/data/quartier.json', import.meta.url), JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])));
