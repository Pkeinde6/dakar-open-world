// Stations-service et restaurants reels (OpenStreetMap) -> services.js : window.SERVICES = { fuel, resto }
//   fuel:  [x, z, marque]                    amenity=fuel (Total, Shell, Oryx, Elton...)
//   resto: [x, z, nom, sorte]                amenity=restaurant|fast_food|cafe ; sorte 0 restaurant, 1 fast-food, 2 cafe
// usage: node tools/services.mjs [cache-dir]
import fs from 'fs';
const src = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8');
const D = JSON.parse(src.slice(src.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const px = (lat, lon) => [Math.round((lon - LON0) * KX), Math.round(-(lat - LAT0) * KZ)];
const dir = process.argv[2] || '.', BBOX = '14.55,-17.55,14.95,-15.80';
async function overpass(file, q) {
  const f = `${dir}/${file}`; if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
  for (let t = 0; t < 6; t++) for (const E of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'])
    try { const r = await fetch(E, { method: 'POST', headers: { 'User-Agent': 'DakarDriveGame/1.0 (personal project)' }, body: new URLSearchParams({ data: q }) });
      const s = await r.text(); if (s.startsWith('{')) { fs.writeFileSync(f, s); return JSON.parse(s).elements; } console.warn(E, s.slice(0, 80)); } catch (e) { console.warn(E, e.message); }
  throw new Error('overpass');
}
const els = await overpass('services.json', `[out:json][timeout:120];(
node["amenity"~"^(fuel|restaurant|fast_food|cafe)$"](${BBOX});
way["amenity"~"^(fuel|restaurant|fast_food|cafe)$"](${BBOX});
);out center tags;`);
const out = { fuel: [], resto: [] }, seen = new Set();
for (const e of els) {
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon, t = e.tags || {}; if (lat == null) continue;
  const [x, z] = px(lat, lon), k = `${t.amenity}${Math.round(x / 15)},${Math.round(z / 15)}`; if (seen.has(k)) continue; seen.add(k); // un point et son batiment
  if (t.amenity === 'fuel') out.fuel.push([x, z, (t.brand || t.operator || t.name || 'Station').slice(0, 24)]);
  else out.resto.push([x, z, (t.name || '').slice(0, 28), t.amenity === 'fast_food' ? 1 : t.amenity === 'cafe' ? 2 : 0]);
}
fs.writeFileSync(new URL('../services.js', import.meta.url), 'window.SERVICES=' + JSON.stringify(out) + ';\n');
console.log('stations', out.fuel.length, 'restaurants', out.resto.length);
