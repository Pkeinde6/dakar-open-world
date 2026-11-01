// Prepare le dossier www/ de l'appli iPhone (Capacitor) a partir du site : memes fichiers, three.js embarque
// (plus de CDN : l'appli marche hors ligne des l'installation, Dakar entier est dans l'appli).
// usage: npm i three@0.160.0 && node tools/app_www.mjs   (Codemagic, workflow site-ios)
import fs from 'fs';
import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const www = path.join(root, 'www');
fs.rmSync(www, { recursive: true, force: true }); fs.mkdirSync(www);
const files = ['index.html', 'game.js', 'data.js', 'bridges.js', 'lieux.js', 'services.js', 'elev.js', 'brt.js', 'edifices.js', 'manifest.webmanifest'];
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(www, f));
for (const d of ['models', 'textures', 'icones', 'batiments']) fs.cpSync(path.join(root, d), path.join(www, d), { recursive: true, filter: s => !s.includes(`${path.sep}paquets`) });
// three.js en local
const three = path.join(root, 'node_modules', 'three');
if (!fs.existsSync(three)) throw new Error('lancer d\'abord : npm i three@0.160.0');
fs.mkdirSync(path.join(www, 'vendor', 'three', 'build'), { recursive: true });
fs.copyFileSync(path.join(three, 'build', 'three.module.js'), path.join(www, 'vendor', 'three', 'build', 'three.module.js'));
fs.cpSync(path.join(three, 'examples', 'jsm'), path.join(www, 'vendor', 'three', 'examples', 'jsm'), { recursive: true });
let html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
html = html.replaceAll('https://cdn.jsdelivr.net/npm/three@0.160.0/', './vendor/three/');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, ''); // une vraie appli : pas de manifeste web
fs.writeFileSync(path.join(www, 'index.html'), html);
let js = fs.readFileSync(path.join(www, 'game.js'), 'utf8');
js = js.replace("'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/'", "'./vendor/three/examples/jsm/libs/draco/gltf/'");
js = js.replace("if ('serviceWorker' in navigator && location.protocol.startsWith('http'))", "if (false)"); // tout est deja dans l'appli
js = js.replace("$('offline').onclick = downloadOffline;", "$('offline').style.display = 'none'; $('offtxt').style.display = 'none'; $('offline').onclick = downloadOffline;");
fs.writeFileSync(path.join(www, 'game.js'), js);
let n = 0, bytes = 0; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(www);
console.log(`www/ : ${n} fichiers, ${(bytes / 1e6).toFixed(0)} Mo`);
