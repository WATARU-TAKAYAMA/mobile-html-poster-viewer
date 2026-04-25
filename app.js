import {
  deletePoster,
  fileKey,
  getAllPosters,
  getPoster,
  guessMimeType,
  normalizePath,
  savePosterBundle,
  updatePoster,
} from "./db.js";
import { readZipEntries } from "./zip-reader.js";

const zipInput = document.querySelector("#zipInput");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const refreshButton = document.querySelector("#refreshButton");
const posterList = document.querySelector("#posterList");
const posterCount = document.querySelector("#posterCount");
const emptyState = document.querySelector("#emptyState");
const entryChooser = document.querySelector("#entryChooser");
const entryOptions = document.querySelector("#entryOptions");

let pendingImport = null;

function setStatus(title, text) {
  statusTitle.textContent = title;
  statusText.textContent = text;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setStatus("Service Worker非対応", "このブラウザでは保存済みファイルの仮想配信が使えません。");
    return;
  }

  await navigator.serviceWorker.register("./sw.js");
  await navigator.serviceWorker.ready;
}

function posterUrl(poster) {
  return `./viewer.html?id=${encodeURIComponent(poster.id)}`;
}

function renderPosterCard(poster) {
  const card = document.createElement("article");
  card.className = "poster-card";

  const info = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = poster.title;
  const meta = document.createElement("div");
  meta.className = "poster-meta";
  meta.innerHTML = `
    <span>${poster.fileCount} files / ${formatBytes(poster.totalBytes)}</span>
    <span>起動: ${poster.entryFile}</span>
    <span>更新: ${formatDate(poster.updatedAt)}</span>
  `;
  info.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const open = document.createElement("a");
  open.href = posterUrl(poster);
  open.textContent = "開く";

  const rename = document.createElement("button");
  rename.type = "button";
  rename.textContent = "名前変更";
  rename.addEventListener("click", async () => {
    const nextTitle = prompt("ポスター名", poster.title);
    if (!nextTitle || nextTitle.trim() === poster.title) return;
    await updatePoster({ ...poster, title: nextTitle.trim(), updatedAt: Date.now() });
    await renderPosters();
    setStatus("名前を変更しました", nextTitle.trim());
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button";
  remove.textContent = "削除";
  remove.setAttribute("aria-label", `${poster.title}を削除`);
  remove.addEventListener("click", async () => {
    if (!confirm(`${poster.title} を削除しますか？`)) return;
    await deletePoster(poster.id);
    await renderPosters();
    setStatus("削除しました", poster.title);
  });

  actions.append(open, rename, remove);
  card.append(info, actions);
  return card;
}

async function renderPosters() {
  const posters = await getAllPosters();
  posterList.replaceChildren(...posters.map(renderPosterCard));
  posterCount.textContent = `${posters.length}件`;
  emptyState.hidden = posters.length > 0;
}

function stripCommonRoot(paths) {
  if (paths.length < 2) return paths;

  const firstParts = paths[0].split("/");
  if (firstParts.length < 2) return paths;
  const root = firstParts[0];
  const allShareRoot = paths.every((path) => path.startsWith(`${root}/`));

  return allShareRoot ? paths.map((path) => path.slice(root.length + 1)) : paths;
}

function findEntryCandidates(paths) {
  return paths
    .filter((path) => /\.html?$/i.test(path))
    .sort((a, b) => {
      const aIndex = /(^|\/)index\.html?$/i.test(a) ? 0 : 1;
      const bIndex = /(^|\/)index\.html?$/i.test(b) ? 0 : 1;
      return aIndex - bIndex || a.localeCompare(b);
    });
}

function chooseEntry(candidates) {
  return new Promise((resolve) => {
    entryOptions.replaceChildren(
      ...candidates.map((candidate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = candidate;
        button.addEventListener("click", () => {
          entryChooser.hidden = true;
          resolve(candidate);
        });
        return button;
      }),
    );
    entryChooser.hidden = false;
    entryChooser.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function createPosterFromZip(zipFile, entries, entryFile) {
  const now = Date.now();
  const id = `${now.toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const title = zipFile.name.replace(/\.zip$/i, "") || "Untitled poster";
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  const files = entries.map((entry) => ({
    key: fileKey(id, entry.path),
    posterId: id,
    path: entry.path,
    mimeType: guessMimeType(entry.path),
    bytes: entry.bytes,
  }));

  await savePosterBundle(
    {
      id,
      title,
      createdAt: now,
      updatedAt: now,
      entryFile,
      fileCount: files.length,
      totalBytes,
    },
    files,
  );

  return getPoster(id);
}

async function importZip(zipFile) {
  setStatus("ZIPを読み込んでいます", zipFile.name);
  const rawEntries = await readZipEntries(zipFile);
  const rawPaths = rawEntries.map((entry) => normalizePath(entry.name)).filter(Boolean);
  const strippedPaths = stripCommonRoot(rawPaths);
  const entries = rawEntries
    .map((entry, index) => ({ ...entry, path: normalizePath(strippedPaths[index]) }))
    .filter((entry) => entry.path && !entry.path.includes("../"));
  const candidates = findEntryCandidates(entries.map((entry) => entry.path));

  if (!candidates.length) {
    throw new Error("ZIP内にHTMLファイルが見つかりませんでした。");
  }

  const entryFile = candidates.length === 1 ? candidates[0] : await chooseEntry(candidates);
  setStatus("端末内に保存しています", entryFile);
  const poster = await createPosterFromZip(zipFile, entries, entryFile);
  await renderPosters();
  setStatus("取り込み完了", `${poster.title} を保存しました。`);
}

zipInput.addEventListener("change", async (event) => {
  const [zipFile] = event.target.files;
  zipInput.value = "";
  if (!zipFile) return;

  pendingImport = importZip(zipFile).catch((error) => {
    console.error(error);
    setStatus("取り込みに失敗しました", error.message || String(error));
  });
  await pendingImport;
  pendingImport = null;
});

refreshButton.addEventListener("click", async () => {
  await renderPosters();
  setStatus("一覧を更新しました", "保存済みポスターを再読み込みしました。");
});

window.addEventListener("online", () => setStatus("オンラインです", "保存済みポスターはオフラインでも開けます。"));
window.addEventListener("offline", () => setStatus("オフラインです", "保存済みポスターはこのまま閲覧できます。"));

await registerServiceWorker();
await renderPosters();
