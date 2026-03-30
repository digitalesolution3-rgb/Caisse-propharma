/**
 * SERVICE WORKER — CAISSE SAAS PRO — DIGITALE SOLUTION
 * Compatible Vercel (chemins absolus)
 */

var SW_VERSION = "v1.2.0";
var CACHE_STATIC = "caisse-static-" + SW_VERSION;
var CACHE_CDN    = "caisse-cdn-"    + SW_VERSION;
var CACHE_FONTS  = "caisse-fonts-"  + SW_VERSION;

var STATIC_ASSETS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

var CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-app-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-firestore-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/firebase/10.7.1/firebase-auth-compat.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js"
];

var NETWORK_ONLY = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /googleapis\.com/
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then(function(cache) {
        return Promise.allSettled(STATIC_ASSETS.map(function(url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function(){});
        }));
      }),
      caches.open(CACHE_CDN).then(function(cache) {
        return Promise.allSettled(CDN_ASSETS.map(function(url) {
          return fetch(url, { cache: "no-cache" }).then(function(res) {
            if (res.ok) cache.put(url, res);
          }).catch(function(){});
        }));
      })
    ]).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event) {
  var valid = [CACHE_STATIC, CACHE_CDN, CACHE_FONTS];
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) {
        return valid.indexOf(k) === -1;
      }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event) {
  var request = event.request;
  var url;
  try { url = new URL(request.url); } catch(e) { return; }
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;

  for (var i = 0; i < NETWORK_ONLY.length; i++) {
    if (NETWORK_ONLY[i].test(request.url)) {
      event.respondWith(fetch(request));
      return;
    }
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(cacheFirst(request, CACHE_CDN));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function(res) {
        if (res.ok) caches.open(CACHE_STATIC).then(function(c) { c.put("/index.html", res.clone()); });
        return res;
      }).catch(function() { return caches.match("/index.html"); })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  event.respondWith(fetch(request).catch(function() { return caches.match(request); }));
});

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request).then(function(res) {
      if (res.ok) caches.open(cacheName).then(function(c) { c.put(request, res.clone()); });
      return res;
    }).catch(function() { return new Response("", { status: 503 }); });
  });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var nf = fetch(request).then(function(res) {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(function() { return cached; });
      return cached || nf;
    });
  });
}

self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
