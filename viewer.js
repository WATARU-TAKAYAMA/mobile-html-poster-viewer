import { getPoster } from "./db.js";

const posterFrame = document.querySelector("#posterFrame");
const viewerTitle = document.querySelector("#viewerTitle");
const viewerMessage = document.querySelector("#viewerMessage");
const fullscreenButton = document.querySelector("#fullscreenButton");
const directButton = document.querySelector("#directButton");
const safariFixButton = document.querySelector("#safariFixButton");

let currentPosterUrl = "";
let safariFixEnabled = /fix=safari/.test(location.search);

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
  const url = new URL(path, base);
  if (safariFixEnabled) {
    url.searchParams.set("compat", "safari-text");
  }
  return url.href;
}

function updateSafariFixButton() {
  safariFixButton.textContent = safariFixEnabled ? "補正中" : "Safari補正";
  safariFixButton.setAttribute("aria-pressed", String(safariFixEnabled));
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
  updateSafariFixButton();
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

safariFixButton.addEventListener("click", () => {
  safariFixEnabled = !safariFixEnabled;
  updateSafariFixButton();
  if (currentPosterUrl) {
    const url = new URL(currentPosterUrl);
    if (safariFixEnabled) {
      url.searchParams.set("compat", "safari-text");
    } else {
      url.searchParams.delete("compat");
    }
    currentPosterUrl = url.href;
    posterFrame.src = currentPosterUrl;
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
