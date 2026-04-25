const DB_NAME = "mobile-html-poster-viewer";
const DB_VERSION = 1;
const FILE_STORE = "files";
const CACHE_NAME = "mobile-html-poster-viewer-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./viewer.html",
  "./styles.css",
  "./app.js",
  "./viewer.js",
  "./db.js",
  "./zip-reader.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("posters")) {
        db.createObjectStore("posters", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const store = db.createObjectStore(FILE_STORE, { keyPath: "key" });
        store.createIndex("posterId", "posterId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizePath(path) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

function fileKey(posterId, path) {
  return `${posterId}:${normalizePath(path)}`;
}

async function getPosterFile(posterId, path) {
  const db = await openDatabase();
  try {
    return await requestToPromise(
      db.transaction(FILE_STORE).objectStore(FILE_STORE).get(fileKey(posterId, path)),
    );
  } finally {
    db.close();
  }
}

function contentTypeForPath(path, storedType) {
  const extension = normalizePath(path).toLowerCase().split(".").pop();
  const types = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    txt: "text/plain",
    xml: "application/xml",
  };

  return types[extension] || storedType || "application/octet-stream";
}

function parsePosterRequest(url) {
  const marker = "/__poster__/";
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex === -1) return null;

  const rest = url.pathname.slice(markerIndex + marker.length);
  const [encodedId, ...encodedPathParts] = rest.split("/");
  if (!encodedId || !encodedPathParts.length) return null;

  const posterId = decodeURIComponent(encodedId);
  const path = normalizePath(encodedPathParts.map(decodeURIComponent).join("/"));

  if (!path || path.split("/").includes("..")) return null;
  return { posterId, path };
}

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  const posterRequest = parsePosterRequest(requestUrl);
  if (posterRequest) {
    event.respondWith(
      getPosterFile(posterRequest.posterId, posterRequest.path)
        .then((file) => {
          if (!file) {
            return new Response("Not found", { status: 404 });
          }

          return new Response(file.bytes, {
            headers: {
              "Content-Type": contentTypeForPath(file.path || posterRequest.path, file.mimeType),
              "Cache-Control": "no-store",
            },
          });
        })
        .catch((error) => new Response(error.message || "Read error", { status: 500 })),
    );
    return;
  }

  if (event.request.method !== "GET" || requestUrl.origin !== location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
  );
});
