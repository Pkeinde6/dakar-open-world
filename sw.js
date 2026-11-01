// Mode hors ligne de Dakar Open World : tout ce que le jeu charge est garde sur l'appareil (Cache Storage).
// Le code et les donnees du jeu passent d'abord par le reseau (pour recevoir les mises a jour) puis par le cache
// quand il n'y a pas de reseau ; modeles, textures, bibliotheques et batiments sont servis directement du cache.
const CACHE = 'dow-1';
// une recherche qui ignore ?v=… parcourt tout le cache : seulement pour les adresses versionnees
const find = (c, req) => c.match(req).then(hit => hit || (new URL(req.url).search ? c.match(req, { ignoreSearch: true }) : undefined));
const CORE = ['./', 'index.html', 'game.js', 'data.js', 'bridges.js', 'lieux.js', 'services.js', 'manifest.webmanifest', 'textures/menu.jpg', 'icones/icone-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const keep = (res) => res && (res.ok || res.type === 'opaque');
async function fromNet(req) { // reseau d'abord, cache si hors ligne
  const c = await caches.open(CACHE);
  try { const res = await fetch(req); if (keep(res)) c.put(req, res.clone()); return res; }
  catch (e) { const hit = await find(c, req); if (hit) return hit; throw e; }
}
async function fromCache(req) { // cache d'abord, reseau sinon (et on garde la reponse)
  const c = await caches.open(CACHE);
  const hit = await find(c, req); if (hit) return hit;
  const res = await fetch(req); if (keep(res)) c.put(req, res.clone()); return res;
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const same = u.origin === location.origin;
  if (!same && !/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(u.host)) return; // Google 3D et le reste : en ligne seulement
  if (same && u.pathname.endsWith('/cle-google.js')) return;
  const fresh = same && (u.pathname.endsWith('/') || /\.(html|js|webmanifest)$/.test(u.pathname));
  e.respondWith(fresh ? fromNet(req) : fromCache(req));
});
