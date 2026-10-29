// Measures each street's real corridor (facade to facade) from the OSM building footprints,
// then derives a carriageway width and sidewalk width. Writes them back into data.js as
// roads[i][5] = carriageway (dm), roads[i][6] = sidewalk (dm); 0 = not measurable (use defaults).
// usage: node tools/widths.mjs
import fs from 'fs';
const file = new URL('../data.js', import.meta.url);
const src = fs.readFileSync(file, 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));

// building edges in a 50 m grid
const CELL = 50, grid = new Map(), key = (gx, gz) => gx * 100000 + gz;
for (const [, , flat] of D.buildings) {
  const pts = []; let x = 0, z = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; pts.push([x, z]); }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const gx0 = Math.floor(Math.min(a[0], b[0]) / CELL), gx1 = Math.floor(Math.max(a[0], b[0]) / CELL), gz0 = Math.floor(Math.min(a[1], b[1]) / CELL), gz1 = Math.floor(Math.max(a[1], b[1]) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) { const k = key(gx, gz); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(a[0], a[1], b[0], b[1]); }
  }
}
// distance along ray (ox,oz)+t*(dx,dz) to the first building edge, up to maxT
function cast(ox, oz, dx, dz, maxT) {
  let best = maxT; const seen = new Set();
  for (let t = 0; t <= maxT + CELL; t += CELL / 2) {
    const gx = Math.floor((ox + dx * Math.min(t, maxT)) / CELL), gz = Math.floor((oz + dz * Math.min(t, maxT)) / CELL), k = key(gx, gz);
    if (seen.has(k)) continue; seen.add(k);
    const l = grid.get(k); if (!l) continue;
    for (let i = 0; i < l.length; i += 4) {
      const ax = l[i], az = l[i + 1], ex = l[i + 2] - ax, ez = l[i + 3] - az, den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
      const tt = ((ax - ox) * ez - (az - oz) * ex) / den, u = ((ax - ox) * dz - (az - oz) * dx) / den;
      if (tt > 0.5 && tt < best && u >= 0 && u <= 1) best = tt;
    }
  }
  return best;
}
//              mway trunk prim sec tert resid uncl living serv track link
const MINW = [  7,   7,    7,   6.5, 6,   4.5,  4.5,  3.5,   3,   3,    4.5];
const MAXW = [  12,  16,   16,  14,  12,  9,    9,    6,     6,   5,    9];
const SIDE = [  0,   2.5,  3,   3,   2.5, 1.5,  1.5,  1,     1,   0,    0];
const med = a => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
let measured = 0, total = 0; const report = [];
for (const r of D.roads) {
  const [t, ni, ow, lanes, flat] = r; total++;
  r[5] = 0; r[6] = 0;
  if (t === 0 || t === 9 || (ow && t <= 4)) continue; // motorways, tracks and dual-carriageway halves: no facades to measure
  const pts = []; let x = 0, z = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; pts.push([x, z]); }
  const corr = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 12) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
    for (let d = 6; d < L - 6; d += 12) {
      const px = ax + ux * d, pz = az + uz * d, l = cast(px, pz, nx, nz, 35), rr = cast(px, pz, -nx, -nz, 35);
      if (l < 35 && rr < 35) corr.push(l + rr);
    }
  }
  if (corr.length < 3) continue;
  const c = med(corr);
  // carriageway: corridor minus a sidewalk/sand shoulder on each side; lanes tag wins when present
  let w = lanes ? lanes * 3.3 + 1 : c - 2 * SIDE[t] - 1;
  w = Math.max(MINW[t], Math.min(MAXW[t], w, c - 2));
  const side = Math.max(0.8, Math.min(5, (c - w) / 2 - 0.4));
  r[5] = Math.round(w * 10); r[6] = Math.round(side * 10); measured++;
  if (ni >= 0 && t <= 4 && report.length < 25) report.push(`${D.names[ni]} (${D.types[t]}) : façades ${c.toFixed(1)} m → chaussée ${w.toFixed(1)} m, trottoirs ${side.toFixed(1)} m`);
}
const byT = {};
for (const r of D.roads) if (r[5]) { const k = D.types[r[0]]; (byT[k] ||= []).push(r[5] / 10); }
for (const [k, a] of Object.entries(byT)) console.log(k.padEnd(13), 'n', a.length, 'median', med(a).toFixed(1), 'm');
console.log(report.join('\n'));
console.log({ measured, total });
fs.writeFileSync(file, 'window.MAP_DATA=' + JSON.stringify(D) + ';');
