import { getPoster } from "./db.js";

const posterFrame = document.querySelector("#posterFrame");
const viewerTitle = document.querySelector("#viewerTitle");
const viewerMessage = document.querySelector("#viewerMessage");
const fullscreenButton = document.querySelector("#fullscreenButton");
const directButton = document.querySelector("#directButton");

let currentPosterUrl = "";

function setMessage(message) {
  viewerMessage.textContent = message;
  viewerMessage.hidden = false;
  posterFrame.hidden = true;
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("このブラウザはService Workerに対応していません。");
  }

  await navigator.serviceWorker.register("./sw.js");
  await navigator.serviceWorker.ready;

  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      location.reload();
    });
  }
}

function virtualPosterUrl(poster) {
  const base = new URL("./", location.href);
  const path = `__poster__/${encodeURIComponent(poster.id)}/${poster.entryFile
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  return new URL(path, base).href;
}

async function loadPoster() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    setMessage("ポスターIDが指定されていません。");
    return;
  }

  await ensureServiceWorker();
  const poster = await getPoster(id);
  if (!poster) {
    setMessage("保存済みポスターが見つかりません。");
    return;
  }

  document.title = poster.title;
  viewerTitle.textContent = poster.title;
  currentPosterUrl = virtualPosterUrl(poster);
  posterFrame.src = currentPosterUrl;
  posterFrame.hidden = false;
  viewerMessage.hidden = true;
}

directButton.addEventListener("click", () => {
  if (currentPosterUrl) {
    location.href = currentPosterUrl;
  }
});

fullscreenButton.addEventListener("click", async () => {
  const target = posterFrame;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (target.requestFullscreen) {
    await target.requestFullscreen();
  }
});

loadPoster().catch((error) => {
  console.error(error);
  setMessage(error.message || String(error));
});
