// quick stats on data.js: world bbox, road types/widths, building count
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
const byT = {};
for (const [t, ni, ow, lanes, flat] of D.roads) { let x = 0, z = 0; for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  const k = D.types[t] || t; byT[k] = byT[k] || { n: 0, ow: 0, lanes: {} }; byT[k].n++; byT[k].ow += ow; byT[k].lanes[lanes] = (byT[k].lanes[lanes] || 0) + 1; }
console.log({ bbox: [minx, maxx, minz, maxz], roads: D.roads.length, buildings: D.buildings.length, kinds: D.buildings.reduce((a, b) => (a[b[1]] = (a[b[1]] || 0) + 1, a), {}) });
for (const [k, v] of Object.entries(byT)) console.log(k.padEnd(14), v.n, 'oneway', v.ow, 'lanes', JSON.stringify(v.lanes));
const named = D.roads.filter(r => r[1] >= 0 && /Senghor|Bourguiba|Pompidou|Malick Sy|Cheikh Anta/.test(D.names[r[1]])).slice(0, 12).map(r => [D.names[r[1]], D.types[r[0]], 'ow', r[2], 'lanes', r[3]]);
console.log(named);
