// Gives every building its real use from OpenStreetMap (school, mosque, church, hospital, market...).
// Fetches tagged buildings, amenity grounds and amenity points from Overpass, then classifies each
// building of data.js: same footprint > amenity point inside it > inside an amenity ground.
// Writes buildings[i][1] = kind code and buildings[i][3] = name index (into D.names) or -1.
// usage: node tools/pois.mjs
import fs from 'fs';
const file = new URL('../data.js', import.meta.url);
const src = fs.readFileSync(file, 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];

export const KINDS = ['generic', 'mosque', 'church', 'school', 'university', 'hospital', 'market', 'fuel', 'government', 'office', 'hotel', 'commercial', 'industrial', 'apartments', 'stadium', 'pharmacy'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
function kindOf(t) {
  const a = t.amenity, b = t.building;
  if (a === 'place_of_worship' || b === 'mosque' || b === 'church' || b === 'cathedral' || b === 'chapel') return t.religion === 'christian' || /church|cathedral|chapel/.test(b || '') ? K.church : K.mosque;
  if (a === 'school' || a === 'kindergarten' || b === 'school' || b === 'kindergarten') return K.school;
  if (a === 'university' || a === 'college' || b === 'university' || b === 'college') return K.university;
  if (a === 'hospital' || a === 'clinic' || a === 'doctors' || b === 'hospital') return K.hospital;
  if (a === 'marketplace') return K.market;
  if (a === 'fuel') return K.fuel;
  if (a === 'pharmacy') return K.pharmacy;
  if (/^(police|townhall|courthouse|post_office|fire_station)$/.test(a || '') || /^(government|civic|public)$/.test(b || '') || t.office === 'government') return K.government;
  if (a === 'bank' || b === 'office' || t.office) return K.office;
  if (t.tourism === 'hotel' || b === 'hotel') return K.hotel;
  if (/^(commercial|retail|supermarket|kiosk)$/.test(b || '') || /^(supermarket|mall)$/.test(t.shop || '')) return K.commercial;
  if (/^(industrial|warehouse)$/.test(b || '')) return K.industrial;
  if (b === 'apartments') return K.apartments;
  if (t.leisure === 'stadium' || t.leisure === 'sports_centre' || b === 'stadium') return K.stadium;
  return 0;
}

const BOXES = [[14.62, -17.55, 14.82, -17.15], [14.63, -16.27, 14.69, -16.19], [14.82, -15.93, 14.90, -15.84]];
const AM = 'school|college|university|kindergarten|place_of_worship|hospital|clinic|doctors|marketplace|fuel|police|bank|pharmacy|townhall|courthouse|post_office|fire_station';
const BU = 'school|kindergarten|mosque|church|cathedral|chapel|hospital|university|college|commercial|retail|supermarket|kiosk|office|hotel|apartments|industrial|warehouse|government|civic|public|stadium';
async function overpass(q) {
  for (let t = 0; t < 6; t++) for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) }); const txt = await r.text(); if (txt.trim().startsWith('{')) return JSON.parse(txt).elements; console.warn('overpass', r.status, txt.slice(0, 120)); } catch (e) { console.warn('overpass', e.message); }
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('overpass failed');
}
const els = [];
for (const [s, w, n, e] of BOXES) {
  const bb = `(${s},${w},${n},${e})`;
  els.push(...await overpass(`[out:json][timeout:180];(way["building"~"^(${BU})$"]${bb};way["amenity"~"^(${AM})$"]${bb};way["leisure"~"^(stadium|sports_centre)$"]${bb};way["tourism"="hotel"]${bb};way["shop"~"^(supermarket|mall)$"]${bb};);out tags geom;`));
  els.push(...await overpass(`[out:json][timeout:180];(node["amenity"~"^(${AM})$"]${bb};node["tourism"="hotel"]${bb};node["shop"~"^(supermarket|mall)$"]${bb};node["office"="government"]${bb};relation["amenity"~"^(${AM})$"]${bb};);out tags center;`));
  console.log('box', bb, 'elements', els.length);
}

// footprints (tagged buildings), grounds (tagged non-building areas), points
const foot = new Map(), grounds = [], points = [];
const names = D.names, nameIdx = new Map(names.map((n, i) => [n, i]));
const nid = n => { if (!n) return -1; if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
for (const e of els) {
  const t = e.tags || {}, k = kindOf(t); if (!k) continue; const nm = t.name || t['name:fr'] || '';
  if (e.type === 'way' && e.geometry) {
    const poly = e.geometry.map(g => px(g.lat, g.lon));
    let cx = 0, cz = 0; poly.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= poly.length; cz /= poly.length;
    if (t.building) foot.set(Math.round(cx / 2) + ',' + Math.round(cz / 2), [k, nm]);
    else grounds.push({ k, nm, poly, minx: Math.min(...poly.map(p => p[0])), maxx: Math.max(...poly.map(p => p[0])), minz: Math.min(...poly.map(p => p[1])), maxz: Math.max(...poly.map(p => p[1])) });
  } else { const c = e.center || e; if (c.lat) points.push([k, nm, ...px(c.lat, c.lon)]); }
}
const inside = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const pgrid = new Map(); for (const p of points) { const k = Math.floor(p[2] / 100) + ',' + Math.floor(p[3] / 100); (pgrid.get(k) || pgrid.set(k, []).get(k)).push(p); }
const ggrid = new Map(); for (const g of grounds) for (let a = Math.floor(g.minx / 100); a <= Math.floor(g.maxx / 100); a++) for (let b = Math.floor(g.minz / 100); b <= Math.floor(g.maxz / 100); b++) { const k = a + ',' + b; (ggrid.get(k) || ggrid.set(k, []).get(k)).push(g); }

const count = {};
for (const B of D.buildings) {
  const [, oldKind, flat] = B; const pts = []; let x = 0, z = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; z += flat[i + 1]; pts.push([x, z]); }
  let cx = 0, cz = 0; pts.forEach(p => { cx += p[0]; cz += p[1]; }); cx /= pts.length; cz /= pts.length;
  let k = 0, nm = '';
  // 1) the very same footprint (centroids agree within ~2 m, data.js was simplified slightly)
  for (let a = -1; a <= 1 && !k; a++) for (let b = -1; b <= 1 && !k; b++) { const f = foot.get((Math.round(cx / 2) + a) + ',' + (Math.round(cz / 2) + b)); if (f) [k, nm] = f; }
  // 2) an amenity point inside the footprint
  if (!k) for (const p of pgrid.get(Math.floor(cx / 100) + ',' + Math.floor(cz / 100)) || []) if (inside(p[2], p[3], pts)) { [k, nm] = p; break; }
  // 3) inside an amenity ground (school yard, hospital compound, market...)
  if (!k) for (const g of ggrid.get(Math.floor(cx / 100) + ',' + Math.floor(cz / 100)) || []) if (cx > g.minx && cx < g.maxx && cz > g.minz && cz < g.maxz && inside(cx, cz, g.poly)) { k = g.k; nm = g.nm; break; }
  if (!k && oldKind === 1) k = 1; // keep mosques found by the first import
  B[1] = k; B[3] = nid(nm); count[KINDS[k]] = (count[KINDS[k]] || 0) + 1;
}
console.log(count, { footprints: foot.size, grounds: grounds.length, points: points.length });
fs.writeFileSync(file, 'window.MAP_DATA=' + JSON.stringify(D) + ';');
