// Audit of the bridge / ramp heights the game computes (same code, run outside the browser):
// steep ramps, steps where a street meets a ramp, headroom over roads passing under, ramps ending in mid-air.
// usage: node tools/check-bridges.mjs [--list]
import fs from 'fs'; import vm from 'vm';
const root = new URL('..', import.meta.url), rd = f => fs.readFileSync(new URL(f, root), 'utf8');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(rd('data.js'), ctx); vm.runInContext(rd('bridges.js'), ctx);
const g = rd('game.js'), a = g.indexOf('// ---------------- Decode roads'), b = g.indexOf('const segLift');
const code = g.slice(a, b).replace(/\/\/ how far \(x,z\)[\s\S]*?(?=\/\/ ---------------- Ponts)/, '');
vm.runInContext('const D = window.MAP_DATA; const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));' + code + ';globalThis.roads=roads;', ctx);
const roads = ctx.roads, list = process.argv.includes('--list');
const [LAT0, LON0] = ctx.window.MAP_DATA.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const where = (x, z) => `${(LAT0 - z / KZ).toFixed(5)},${(LON0 + x / KX).toFixed(5)}`;
const H = (r, i) => r.y ? r.y[i] : 0, issues = { pente: [], marche: [], hauteurLibre: [], rampeEnLAir: [] };
const vk = (x, z) => Math.round(x) + ',' + Math.round(z), atV = new Map();
roads.forEach((r, ri) => r.pts.forEach(([x, z], i) => { if (Number.isInteger(x) && Number.isInteger(z)) { const k = vk(x, z); (atV.get(k) || atV.set(k, []).get(k)).push([ri, i]); } }));
for (const r of roads) if (r.y) for (let i = 0; i + 1 < r.pts.length; i++) { const L = r.cum[i + 1] - r.cum[i]; if (L > 0.5 && Math.abs(r.y[i + 1] - r.y[i]) / L > 0.095) issues.pente.push([r.name, where(...r.pts[i]), (Math.abs(r.y[i + 1] - r.y[i]) / L * 100).toFixed(0) + '%']); }
for (const [k, o] of atV) { if (o.length < 2) continue; const hs = o.map(([ri, i]) => H(roads[ri], i)), mx = Math.max(...hs), mn = Math.min(...hs);
  if (mx - mn > 0.4) issues.marche.push([o.map(([ri]) => roads[ri].name || '?').join(' / '), where(...k.split(',').map(Number)), mx.toFixed(1) + ' vs ' + mn.toFixed(1)]); }
for (const r of roads) if (r.y) for (const e of [0, r.pts.length - 1]) { const [x, z] = r.pts[e]; if (r.y[e] > 0.4 && !(r.stub || []).includes(e) && (atV.get(vk(x, z)) || []).length < 2) issues.rampeEnLAir.push([r.name, where(x, z), r.y[e].toFixed(1) + ' m']); }
// headroom: every ground road segment crossing a lifted one without a shared node
const cross = (p, q, r2, s) => { const d = (q[0] - p[0]) * (s[1] - r2[1]) - (q[1] - p[1]) * (s[0] - r2[0]); if (!d) return null; const t = ((r2[0] - p[0]) * (s[1] - r2[1]) - (r2[1] - p[1]) * (s[0] - r2[0])) / d, u = ((r2[0] - p[0]) * (q[1] - p[1]) - (r2[1] - p[1]) * (q[0] - p[0])) / d; return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98 ? [t, u] : null; };
const grid = new Map(), C = 100; roads.forEach((r, ri) => { if (r.t > 8 && r.t !== 10) return; for (let i = 0; i + 1 < r.pts.length; i++) { const k = Math.floor((r.pts[i][0] + r.pts[i + 1][0]) / 2 / C) + ',' + Math.floor((r.pts[i][1] + r.pts[i + 1][1]) / 2 / C); (grid.get(k) || grid.set(k, []).get(k)).push([ri, i]); } });
for (const r of roads) if (r.y) for (let i = 0; i + 1 < r.pts.length; i++) { const hm = Math.max(r.y[i], r.y[i + 1]); if (hm < 0.3) continue;
  const cx = Math.floor((r.pts[i][0] + r.pts[i + 1][0]) / 2 / C), cz = Math.floor((r.pts[i][1] + r.pts[i + 1][1]) / 2 / C);
  for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (const [rj, j] of grid.get((cx + p) + ',' + (cz + q)) || []) { const o = roads[rj]; if (o === r) continue;
    const x = cross(r.pts[i], r.pts[i + 1], o.pts[j], o.pts[j + 1]); if (!x) continue;
    const top = r.y[i] + (r.y[i + 1] - r.y[i]) * x[0], low = H(o, j) + (H(o, j + 1) - H(o, j)) * x[1], gap = Math.abs(top - low);
    if (gap < 4.6) issues.hauteurLibre.push([`${r.name || '?'} sur ${o.name || '?'}`, where(...r.pts[i]), gap.toFixed(1) + ' m']); } }
const matched = roads.filter(r => r.bridge).length;
console.log(`ponts relies ${matched}/${ctx.window.BRIDGES.length}`);
for (const [k, v] of Object.entries(issues)) { const u = [...new Map(v.map(e => [e[1], e])).values()]; console.log(`${k}: ${u.length}`); if (list) for (const e of u.slice(0, 25)) console.log('   ', e.join(' | ')); }
