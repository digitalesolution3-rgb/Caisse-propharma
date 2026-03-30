/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   SERVICE WORKER — CAISSE SAAS PRO — DIGITALE SOLUTION      ║
 * ║   Optimisé Vercel / HTTPS                                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const SW_VERSION = "v1.1.0";
const CACHE_STATIC = `caisse-static-${SW_VERSION}`;
const CACHE_CDN    = `caisse-cdn-${SW_VERSION}`;
const CACHE_FONTS  = `caisse-fonts-${SW_VERSION}`;

// App Shell — assets locaux
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Scripts CDN versionnés (immuables une fois en cache)
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
];

// Domaines toujours en réseau direct (Firebase, APIs)
const NETWORK_ONLY = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /fcm\.googleapis\.com/,
  /googleapis\.com\/identitytoolkit/,
];

// ── INSTALL ────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then((cache) =>
        // addAll peut échouer si une ressource n'existe pas encore → on try individuellement
        Promise.allSettled(STATIC_ASSETS.map(url =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        ))
      ),
      caches.open(CACHE_CDN).then((cache) =>
        Promise.allSettled(CDN_ASSETS.map(url =>
          fetch(url, { cache: "no-cache" })
            .then(res => { if (res.ok) cache.put(url, res); })
            .catch(() => {})
        ))
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const VALID = [CACHE_STATIC, CACHE_CDN, CACHE_FONTS];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !VALID.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer non-GET
  if (request.method !== "GET") return;

  // Ignorer les extensions Chrome internes
  if (url.protocol === "chrome-extension:") return;

  // Firebase & APIs → réseau pur, jamais de cache
  if (NETWORK_ONLY.some(p => p.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // Google Fonts → Stale-While-Revalidate
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // CDN Cloudflare → Cache-First
  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(cacheFirst(request, CACHE_CDN));
    return;
  }

  // Navigations HTML (requêtes de page) → App Shell
  if (request.destination === "document" || request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(res => {
          // Mettre à jour le cache à chaque visite réseau réussie
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_STATIC).then(c => c.put("/index.html", clone));
          }
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Assets locaux (icônes, manifest) → Cache-First
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // Tout le reste → Network avec fallback cache
  event.respondWith(networkWithFallback(request));
});

// ── Helpers ────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || networkFetch;
}

async function networkWithFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("", { status: 503 });
  }
}

// ── MESSAGES ───────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.ports[0]?.postMessage({ version: SW_VERSION });
});

// ── BACKGROUND SYNC ────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending-sales") {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: "BG_SYNC_TRIGGERED" }))
      )
    );
  }
});
