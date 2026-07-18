const CACHE_NAME = "team-task-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/favicon.ico"];
const THUMBNAIL_API_PATHS = ["/api/task-photos/", "/api/task-reference-photos/"];

function isThumbnailRequest(requestUrl) {
  return (
    requestUrl.searchParams.get("thumb") === "1" &&
    THUMBNAIL_API_PATHS.some((path) => requestUrl.pathname.startsWith(path))
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }

          return Promise.resolve(false);
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (isThumbnailRequest(requestUrl)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === "opaque")) {
            void cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
          });
        }
      }),
    );
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response("Offline", {
          status: 503,
          statusText: "Offline",
        }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }

          const responseClone = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        })
        .catch(async () => {
          if (cachedResponse) {
            return cachedResponse;
          }

          if (event.request.mode === "navigate") {
            const fallback = await caches.match("/");
            if (fallback) {
              return fallback;
            }
          }

          return new Response("Offline", {
            status: 503,
            statusText: "Offline",
          });
        });

      return cachedResponse || networkFetch;
    }),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || "Team Task", {
      body: data.body || "",
      data: {
        url: data.url || "/",
      },
      badge: "/favicon.ico",
      icon: "/favicon.ico",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
