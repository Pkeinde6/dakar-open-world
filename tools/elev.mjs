// Real terrain heights (SRTM 30 m via the public OpenTopoData API) on a 250 m grid around every road,
// gaps filled by diffusion and lightly smoothed. Writes elev.js: window.ELEV = { x0, z0, step, nx, nz, h } (h: base64 Int16, decimetres).
// usage: node tools/elev.mjs [--dry]
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const STEP = 250;
let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
const roadPts = [];
for (const r of D.roads) { let x = 0, z = 0; const f = r[4]; for (let i = 0; i < f.length; i += 2) { x += f[i]; z += f[i + 1]; roadPts.push(x, z); minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); } }
const x0 = Math.floor(minx / STEP) * STEP - 2 * STEP, z0 = Math.floor(minz / STEP) * STEP - 2 * STEP;
const nx = Math.ceil((maxx - x0) / STEP) + 3, nz = Math.ceil((maxz - z0) / STEP) + 3;
const want = new Uint8Array(nx * nz);
for (let i = 0; i < roadPts.length; i += 2) {
  const gx = Math.round((roadPts[i] - x0) / STEP), gz = Math.round((roadPts[i + 1] - z0) / STEP);
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const X = gx + a, Z = gz + b; if (X >= 0 && Z >= 0 && X < nx && Z < nz) want[Z * nx + X] = 1; }
}
const idx = []; for (let i = 0; i < want.length; i++) if (want[i]) idx.push(i);
console.log({ nx, nz, points: idx.length, requests: Math.ceil(idx.length / 100) });
if (process.argv.includes('--dry')) process.exit(0);

const cache = new URL('./elev-cache.json', import.meta.url);
const got = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const todo = idx.filter(i => got[i] === undefined);
for (let k = 0; k < todo.length; k += 100) {
  const part = todo.slice(k, k + 100);
  const locs = part.map(i => { const x = x0 + (i % nx) * STEP, z = z0 + Math.floor(i / nx) * STEP; return `${(LAT0 - z / KZ).toFixed(5)},${(LON0 + x / KX).toFixed(5)}`; }).join('|');
  for (let tries = 0; tries < 5; tries++) {
    try {
      const r = await fetch('https://api.opentopodata.org/v1/srtm30m', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locations: locs }) });
      const j = await r.json();
      if (j.status !== 'OK') throw new Error(j.error || r.status);
      j.results.forEach((res, n) => { got[part[n]] = res.elevation == null ? 0 : res.elevation; });
      break;
    } catch (e) { console.warn('retry', k, e.message); await sleep(5000); }
  }
  if ((k / 100) % 10 === 0) { fs.writeFileSync(cache, JSON.stringify(got)); console.log(`${Math.min(k + 100, todo.length)}/${todo.length}`); }
  await sleep(1100); // public API: 1 request per second
}
fs.writeFileSync(cache, JSON.stringify(got));

// fill unknown cells by diffusion from known ones, then a light blur (radar noise from buildings)
let H = new Float32Array(nx * nz), known = new Uint8Array(nx * nz);
for (const [i, v] of Object.entries(got)) { H[+i] = Math.max(0, v); known[+i] = 1; }
for (let it = 0; it < 400; it++) {
  let changed = 0; const H2 = H.slice(), K2 = known.slice();
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = z * nx + x; if (known[i]) continue; let s = 0, n = 0;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + a, Z = z + b; if (X >= 0 && Z >= 0 && X < nx && Z < nz && known[Z * nx + X]) { s += H[Z * nx + X]; n++; } }
    if (n) { H2[i] = s / n; K2[i] = 1; changed++; }
  }
  H = H2; known = K2; if (!changed) break;
}
const B = new Float32Array(nx * nz);
for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { let s = 0, w = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const X = x + a, Z = z + b; if (X >= 0 && Z >= 0 && X < nx && Z < nz) { const k = (a || b) ? 1 : 2; s += H[Z * nx + X] * k; w += k; } } B[z * nx + x] = s / w; }
const I16 = new Int16Array(nx * nz); for (let i = 0; i < B.length; i++) I16[i] = Math.round(B[i] * 10);
fs.writeFileSync(new URL('../elev.js', import.meta.url), `window.ELEV=${JSON.stringify({ x0, z0, step: STEP, nx, nz, h: Buffer.from(I16.buffer).toString('base64') })};`);
let mx = 0; for (const v of B) mx = Math.max(mx, v);
console.log('elev.js written, max', mx.toFixed(1), 'm');
