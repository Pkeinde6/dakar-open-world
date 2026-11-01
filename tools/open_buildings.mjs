// Extrait de Google Open Buildings v3 (tuile S2 0ed, CC BY 4.0) les batiments de la region de Dakar, en coordonnees du jeu.
// usage: node tools/open_buildings.mjs <0ed_buildings.csv.gz> <sortie.json>
// Colonnes : latitude, longitude, area_in_meters, confidence, geometry (WKT), full_plus_code. On garde confiance >= 0,7, aire >= 12 m2.
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
const [src, out] = process.argv.slice(2);
const s = fs.readFileSync(new URL('../data.js', import.meta.url), 'utf8'), D = JSON.parse(s.slice(s.indexOf('=') + 1).replace(/;\s*$/, ''));
const [LAT0, LON0] = D.origin, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540;
const LAT = [14.62, 14.86], LON = [-17.55, -17.13]; // presqu'ile du Cap-Vert jusqu'a Bargny
const rl = readline.createInterface({ input: fs.createReadStream(src).pipe(zlib.createGunzip()) });
const res = []; let n = 0, head = true;
for await (const line of rl) {
  if (head) { head = false; continue; }
  n++;
  const c1 = line.indexOf(','), c2 = line.indexOf(',', c1 + 1), c3 = line.indexOf(',', c2 + 1), c4 = line.indexOf(',', c3 + 1);
  const la = +line.slice(0, c1), lo = +line.slice(c1 + 1, c2);
  if (la < LAT[0] || la > LAT[1] || lo < LON[0] || lo > LON[1]) continue;
  const area = +line.slice(c2 + 1, c3), conf = +line.slice(c3 + 1, c4);
  if (conf < 0.7 || area < 12) continue;
  const m = line.match(/POLYGON\(\(([^)]*)\)/); if (!m) continue;
  const pts = m[1].split(',').map(t => { const [x, y] = t.trim().split(' ').map(Number); return [Math.round((x - LON0) * KX * 10) / 10, Math.round(-(y - LAT0) * KZ * 10) / 10]; });
  if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  if (pts.length >= 3) res.push(pts);
}
fs.writeFileSync(out, JSON.stringify(res));
console.log('lignes lues', n, 'batiments Dakar gardes', res.length);
