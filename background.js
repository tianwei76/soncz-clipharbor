const STORAGE_KEY = "videoInfoByTab";
let pending = Promise.resolve();

function videoId(url) {
  const match = String(url || "").match(/\/video\/(\d+)(?:[/?#]|$)|[?&](?:modal_id|aweme_id)=(\d+)/);
  return match ? (match[1] || match[2]) : "";
}

function enqueue(operation) {
  pending = pending.then(operation, operation).catch((error) => console.error(error));
}

function mergeVideoInfo(previous, next) {
  if (!previous || previous.aweme_id !== next.aweme_id) return next;
  const merged = { ...previous, ...next };
  ["video_urls", "video_download_urls", "video_backup_urls", "video_cover_urls", "video_blob_urls", "video_ids"].forEach((field) => {
    const current = Array.isArray(next[field]) ? next[field] : [];
    const old = Array.isArray(previous[field]) ? previous[field] : [];
    merged[field] = current.length ? current : old;
  });
  ["aweme_id", "video_title", "video_author", "video_source", "title", "platform"].forEach((field) => {
    if (!merged[field] && previous[field]) merged[field] = previous[field];
  });
  if (previous.video_source === "aweme" && next.video_source === "dom") {
    ["video_urls", "video_download_urls", "video_backup_urls", "video_cover_urls", "video_ids", "video_title", "video_author", "title"].forEach((field) => {
      if (previous[field] && (!Array.isArray(next[field]) || !next[field].length)) merged[field] = previous[field];
    });
    merged.video_source = previous.video_source;
  }
  return merged;
}

chrome.runtime.onInstalled.addListener(() => enqueue(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ [STORAGE_KEY]: {} });
}));

function clearTab(tabId) {
  enqueue(async () => {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const byTab = data[STORAGE_KEY] || {};
    delete byTab[String(tabId)];
    await chrome.storage.local.set({ [STORAGE_KEY]: byTab });
  });
}

chrome.tabs.onRemoved.addListener(clearTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.status === "loading") clearTab(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;
  const tabId = sender.tab ? sender.tab.id : message.tabId;
  if (!tabId) return false;
  if (message.type === "DOUYIN_VIDEO_FOUND") {
    const info = message.payload;
    const id = videoId(sender.tab && sender.tab.url);
    if (!info || !id || String(info.aweme_id) !== id || videoId(info.pageUrl) !== id) return false;
    enqueue(async () => {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const byTab = data[STORAGE_KEY] && typeof data[STORAGE_KEY] === "object" ? data[STORAGE_KEY] : {};
      byTab[String(tabId)] = mergeVideoInfo(byTab[String(tabId)], { ...info, tabId, pageUrl: sender.tab.url, savedAt: new Date().toISOString() });
      await chrome.storage.local.set({ [STORAGE_KEY]: byTab });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "GET_VIDEO_INFO_FOR_TAB") {
    enqueue(async () => {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      sendResponse({ ok: true, payload: (data[STORAGE_KEY] || {})[String(tabId)] || null });
    });
    return true;
  }
  if (message.type === "CLEAR_VIDEO_INFO_FOR_TAB") {
    enqueue(async () => {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const byTab = data[STORAGE_KEY] || {};
      delete byTab[String(tabId)];
      await chrome.storage.local.set({ [STORAGE_KEY]: byTab });
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});
