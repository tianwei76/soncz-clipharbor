const SCRIPT_ID = "douyin-video-downloader-injected";
const MESSAGE_TYPE = "DOUYIN_VIDEO_DOWNLOADER_RESULT";

function isDouyinPage() {
  return /(^|\.)douyin\.com$/i.test(window.location.hostname);
}

function send(message) {
  try { chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError); } catch (_) {}
}

function inject() {
  if (!isDouyinPage() || document.getElementById(SCRIPT_ID)) return;
  let url;
  try { url = chrome.runtime.getURL("injected.js"); } catch (_) { return; }
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = url;
  script.onload = () => script.remove();
  const root = document.documentElement || document.head;
  if (root) root.appendChild(script);
  else document.addEventListener("DOMContentLoaded", inject, { once: true });
}

window.addEventListener("message", (event) => {
  if (event.source === window && event.origin === window.location.origin && event.data && event.data.type === MESSAGE_TYPE && event.data.payload) {
    send({ type: "DOUYIN_VIDEO_FOUND", payload: event.data.payload });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "DOWNLOAD_BLOB_VIDEO" || typeof message.url !== "string" || !message.url.startsWith("blob:")) {
    return false;
  }

  try {
    const link = document.createElement("a");
    link.href = message.url;
    link.download = message.filename || "douyin-video.mp4";
    link.style.display = "none";
    (document.body || document.documentElement).appendChild(link);
    link.click();
    link.remove();
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message || "无法创建下载" });
  }
  return true;
});

send({ type: "CLEAR_VIDEO_INFO_FOR_TAB" });
inject();
