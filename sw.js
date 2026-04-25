const DB_NAME = "mobile-html-poster-viewer";
const DB_VERSION = 1;
const FILE_STORE = "files";
const CACHE_NAME = "mobile-html-poster-viewer-v4";
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
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    xml: "application/xml; charset=utf-8",
  };

  return types[extension] || storedType || "application/octet-stream";
}

const SAFARI_TEXT_FIX_STYLE = `
<style id="mobile-html-poster-viewer-safari-text-fix">
html, body {
  -webkit-text-size-adjust: 100% !important;
}
body * {
  text-rendering: auto !important;
}
body :where(p, span, div, h1, h2, h3, h4, h5, h6, li, td, th, a, button, label, text, tspan) {
  opacity: max(1, var(--mhpv-opacity, 1));
}
:where([style*="color: transparent" i], [style*="-webkit-text-fill-color: transparent" i]) {
  color: #111 !important;
  -webkit-text-fill-color: currentColor !important;
  background-image: none !important;
  -webkit-background-clip: border-box !important;
  background-clip: border-box !important;
}
svg text,
svg tspan,
svg textPath {
  fill: currentColor;
  -webkit-text-fill-color: currentColor;
  paint-order: fill stroke markers;
}
svg [fill="none"] text,
svg text[fill="none"],
svg tspan[fill="none"] {
  fill: currentColor !important;
}
</style>
`;

const SAFARI_SVG_TEXT_FIX_STYLE = `
<style id="mobile-html-poster-viewer-safari-svg-text-fix">
text, tspan, textPath {
  fill: currentColor;
  -webkit-text-fill-color: currentColor;
  paint-order: fill stroke markers;
}
text[fill="none"], tspan[fill="none"] {
  fill: currentColor !important;
}
</style>
`;

function isTextCompatibilityRequest(request, url) {
  if (url.searchParams.get("compat") === "safari-text") {
    return true;
  }

  if (!request.referrer) {
    return false;
  }

  try {
    return new URL(request.referrer).searchParams.get("compat") === "safari-text";
  } catch {
    return false;
  }
}

function injectBefore(text, pattern, injection) {
  if (pattern.test(text)) {
    return text.replace(pattern, `${injection}$&`);
  }
  return `${injection}\n${text}`;
}

function applyTextCompatibility(file, path) {
  const extension = normalizePath(path).toLowerCase().split(".").pop();
  if (!["html", "htm", "svg"].includes(extension)) {
    return file.bytes;
  }

  const text = new TextDecoder("utf-8").decode(file.bytes);
  const fixed =
    extension === "svg"
      ? injectBefore(text, /<\/svg\s*>/i, SAFARI_SVG_TEXT_FIX_STYLE)
      : injectBefore(text, /<\/head\s*>/i, SAFARI_TEXT_FIX_STYLE);

  return new TextEncoder().encode(fixed);
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

          const bytes = isTextCompatibilityRequest(event.request, requestUrl)
            ? applyTextCompatibility(file, file.path || posterRequest.path)
            : file.bytes;

          return new Response(bytes, {
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
