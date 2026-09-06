const CACHE_NAME = "work-manager-v10-shell-2026-09-06-11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./js/cloud-sync.js?v=20260906-11",
  "./js/firebase-config.js?v=20260905-1",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./icons/drive-photo-placeholder.svg"
];
const FIREBASE_MODULES = [
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all([
      cache.addAll(APP_SHELL),
      // CDN이 잠시 응답하지 않아도 앱 셸 설치 자체는 유지한다.
      cache.addAll(FIREBASE_MODULES).catch(() => undefined)
    ]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isAppAsset = url.origin === self.location.origin;
  const isFirebaseModule = url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!isAppAsset && !isFirebaseModule) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
      if (isFirebaseModule) return cached || network;
      return network.catch(() => cached || caches.match("./index.html"));
    })
  );
});
