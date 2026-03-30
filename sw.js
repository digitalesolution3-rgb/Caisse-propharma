/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   SERVICE WORKER — CAISSE SAAS PRO — DIGITALE SOLUTION      ║
 * ║   Stratégie : Cache-First pour assets statiques              ║
 * ║                Network-First pour Firebase & APIs            ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const SW_VERSION = "v1.0.0";
const CACHE_STATIC  = `caisse-static-${SW_VERSION}`;
const CACHE_CDN     = `caisse-cdn-${SW_VERSION}`;
const CACHE_FONTS   = `caisse-fonts-${SW_VERSION}`;

// ── Assets locaux à mettre en cache immédiatement (App Shell) ──
const STATIC_ASSETS = [
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// ── Scripts CDN critiques (React, Firebase, Babel) ──
const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js",
];

// ── Domaines réseau uniquement (jamais mis en cache) ──
const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /fcm\.googleapis\.com/,
  /api\.anthropic\.com/,
];

// ──────────────────────────────────────────────────────────────
//  INSTALL  — précache de l'App Shell
// ──────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log(`[SW ${SW_VERSION}] Install`);
  event.waitUntil(
    Promise.all([
      // Cache statique local
      caches.open(CACHE_STATIC).then((cache) => {
        return cache.addAll(STATIC_ASSETS).catch((err) => {
          console.warn("[SW] Erreur précache statique:", err.message);
        });
      }),
      // Cache CDN
      caches.open(CACHE_CDN).then((cache) => {
        return Promise.allSettled(
          CDN_ASSETS.map((url) =>
            fetch(url, { cache: "no-cache" })
              .then((res) => {
                if (res.ok) cache.put(url, res);
              })
              .catch(() => {}) // CDN inaccessible hors-ligne → skip silencieux
          )
        );
      }),
    ]).then(() => {
      // Activation immédiate sans attendre le rechargement de la page
      return self.skipWaiting();
    })
  );
});

// ──────────────────────────────────────────────────────────────
//  ACTIVATE  — nettoyage des anciens caches
// ──────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log(`[SW ${SW_VERSION}] Activate`);
  const VALID_CACHES = [CACHE_STATIC, CACHE_CDN, CACHE_FONTS];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !VALID_CACHES.includes(key))
          .map((key) => {
            console.log("[SW] Suppression ancien cache:", key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────────────────────
//  FETCH  — stratégies de cache
// ──────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Ignorer les requêtes non-GET
  if (request.method !== "GET") return;

  // 2. Réseau uniquement pour Firebase & APIs sensibles
  if (NETWORK_ONLY_PATTERNS.some((p) => p.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Google Fonts — Stale-While-Revalidate
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // 4. CDN scripts — Cache-First (jamais modifiés une fois versionnés)
  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(cacheFirst(request, CACHE_CDN));
    return;
  }

  // 5. App Shell local — Cache-First avec fallback réseau
  if (url.pathname.endsWith(".html") || STATIC_ASSETS.some((a) => request.url.includes(a.replace("./", "")))) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 6. Tout le reste — réseau avec fallback cache
  event.respondWith(networkWithFallback(request));
});

// ──────────────────────────────────────────────────────────────
//  Helpers de stratégie
// ──────────────────────────────────────────────────────────────

/** Cache-First : retourne le cache, sinon réseau puis mise en cache */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return offlineFallback(request);
  }
}

/** Stale-While-Revalidate : retourne cache immédiatement + rafraîchit en arrière-plan */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || networkFetch;
}

/** Network-First avec fallback cache (pour contenu dynamique) */
async function networkWithFallback(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/** Page de fallback hors-ligne pour les navigations HTML */
function offlineFallback(request) {
  if (request.destination === "document") {
    return caches.match("./index.html");
  }
  // Pour les autres ressources, retourner une réponse vide
  return new Response("", { status: 503, statusText: "Service Unavailable" });
}

// ──────────────────────────────────────────────────────────────
//  MESSAGE — communication avec la page principale
// ──────────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "GET_VERSION") {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
});

// ──────────────────────────────────────────────────────────────
//  BACKGROUND SYNC — file d'attente de ventes hors-ligne
//  (si le navigateur supporte Background Sync API)
// ──────────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending-sales") {
    console.log("[SW] Background Sync: sync-pending-sales");
    // La synchronisation réelle est gérée par Firebase Persistence
    // dans l'app — ce hook peut servir à notifier l'UI
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) =>
          client.postMessage({ type: "BG_SYNC_TRIGGERED", tag: event.tag })
        );
      })
    );
  }
});
