export const DB_NAME = "mobile-html-poster-viewer";
export const DB_VERSION = 1;
export const POSTER_STORE = "posters";
export const FILE_STORE = "files";

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(POSTER_STORE)) {
        db.createObjectStore(POSTER_STORE, { keyPath: "id" });
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

export function runStore(mode, storeNames, callback) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeNames, mode);
        const stores = Array.isArray(storeNames)
          ? storeNames.map((name) => transaction.objectStore(name))
          : transaction.objectStore(storeNames);
        let result;

        transaction.oncomplete = () => {
          db.close();
          resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };

        result = callback(stores);
      }),
  );
}

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function normalizePath(path) {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}

export function fileKey(posterId, path) {
  return `${posterId}:${normalizePath(path)}`;
}

export async function getAllPosters() {
  const db = await openDatabase();
  try {
    const posters = await requestToPromise(db.transaction(POSTER_STORE).objectStore(POSTER_STORE).getAll());
    return posters.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function getPoster(id) {
  const db = await openDatabase();
  try {
    return await requestToPromise(db.transaction(POSTER_STORE).objectStore(POSTER_STORE).get(id));
  } finally {
    db.close();
  }
}

export async function getPosterFile(posterId, path) {
  const db = await openDatabase();
  try {
    return await requestToPromise(
      db.transaction(FILE_STORE).objectStore(FILE_STORE).get(fileKey(posterId, path)),
    );
  } finally {
    db.close();
  }
}

export async function savePosterBundle(poster, files) {
  await runStore("readwrite", [POSTER_STORE, FILE_STORE], ([posters, fileStore]) => {
    posters.put(poster);
    files.forEach((file) => fileStore.put(file));
  });
}

export async function updatePoster(poster) {
  await runStore("readwrite", POSTER_STORE, (store) => {
    store.put(poster);
  });
}

export async function deletePoster(id) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([POSTER_STORE, FILE_STORE], "readwrite");
      const posters = transaction.objectStore(POSTER_STORE);
      const files = transaction.objectStore(FILE_STORE);
      const index = files.index("posterId");

      posters.delete(id);
      index.openCursor(IDBKeyRange.only(id)).onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function guessMimeType(path) {
  const extension = normalizePath(path).toLowerCase().split(".").pop();
  const types = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eot: "application/vnd.ms-fontobject",
    txt: "text/plain",
    xml: "application/xml",
    pdf: "application/pdf",
  };

  return types[extension] || "application/octet-stream";
}
