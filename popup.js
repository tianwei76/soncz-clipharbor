const refreshButton = document.getElementById("refreshButton");
const downloadButton = document.getElementById("downloadVideoButton");
const statusText = document.getElementById("statusText");
const videoTitle = document.getElementById("videoTitle");
const videoAuthor = document.getElementById("videoAuthor");
let latestInfo = null;
let busy = false;
let refreshSequence = 0;

function videoId(url) {
  const match = String(url || "").match(/\/video\/(\d+)(?:[/?#]|$)|[?&](?:modal_id|aweme_id)=(\d+)/);
  return match ? (match[1] || match[2]) : "";
}

function getVideoUrls(info) {
  if (!info) return [];
  const urls = ["video_urls", "video_backup_urls", "video_download_urls"]
    .flatMap((key) => Array.isArray(info[key]) ? info[key] : [])
    .filter((url, index, list) => typeof url === "string" && /^https?:\/\//i.test(url) && list.indexOf(url) === index);
  return [...urls.filter((url) => !/playwm|watermark|logo/i.test(url)), ...urls.filter((url) => /playwm|watermark|logo/i.test(url))];
}

function getBlobVideoUrls(info) {
  return info && Array.isArray(info.video_blob_urls)
    ? info.video_blob_urls.filter((url) => typeof url === "string" && url.startsWith("blob:"))
    : [];
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function render(info, url) {
  const id = videoId(url);
  latestInfo = info && id && String(info.aweme_id || "") === id && (getVideoUrls(info).length || getBlobVideoUrls(info).length) ? info : null;
  videoTitle.textContent = latestInfo && latestInfo.video_title || "暂未检测到视频";
  videoAuthor.textContent = latestInfo && latestInfo.video_author ? `作者：${latestInfo.video_author}` : "";
  videoAuthor.hidden = !videoAuthor.textContent;
  statusText.textContent = !id ? "请打开抖音视频详情页" : latestInfo ? "已检测到视频，可以下载" : "暂未检测到视频，请播放视频后刷新检测";
  downloadButton.disabled = busy || !latestInfo;
}

async function refresh() {
  const sequence = ++refreshSequence;
  refreshButton.disabled = true;
  refreshButton.textContent = "正在检测…";
  try {
    const tab = await getCurrentTab();
    const response = tab && tab.id && videoId(tab.url)
      ? await chrome.runtime.sendMessage({ type: "GET_VIDEO_INFO_FOR_TAB", tabId: tab.id }) : null;
    if (sequence === refreshSequence && !busy) render(response && response.payload, tab && tab.url);
  } catch (_) {
    if (sequence === refreshSequence && !busy) {
      render(null, "");
      statusText.textContent = "读取失败，请重新加载扩展和抖音页面";
    }
  } finally {
    if (sequence === refreshSequence) {
      refreshButton.disabled = busy;
      refreshButton.textContent = "刷新检测";
    }
  }
}

function buildVideoFilename(info) {
  const name = [info.aweme_id, info.video_title].filter(Boolean).join("-")
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 120).replace(/[. ]+$/g, "");
  return `douyin-videos/${name || `douyin-video-${Date.now()}`}.mp4`;
}

async function downloadCurrentVideo() {
  busy = true;
  ++refreshSequence;
  refreshButton.disabled = true;
  downloadButton.disabled = true;
  try {
    const tab = await getCurrentTab();
    const response = tab && tab.id && videoId(tab.url)
      ? await chrome.runtime.sendMessage({ type: "GET_VIDEO_INFO_FOR_TAB", tabId: tab.id }) : null;
    const info = response && response.payload;
    render(info, tab && tab.url);
    if (!latestInfo) return;
    statusText.textContent = "正在创建下载任务";
    const filename = buildVideoFilename(info);
    const httpUrl = getVideoUrls(info)[0];
    const blobUrl = getBlobVideoUrls(info)[0];
    const downloadBlob = async () => {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "DOWNLOAD_BLOB_VIDEO", url: blobUrl, filename });
      if (!response || !response.ok) throw new Error(response && response.error || "页面播放器不支持下载");
    };
    if (httpUrl) {
      try {
        await new Promise((resolve, reject) => {
          chrome.downloads.download({ url: httpUrl, filename, saveAs: true, conflictAction: "uniquify" }, (downloadId) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(downloadId);
          });
        });
      } catch (error) {
        if (!blobUrl) throw error;
        await downloadBlob();
      }
    } else {
      await downloadBlob();
    }
    statusText.textContent = "已创建下载任务，请在浏览器下载列表查看进度";
  } catch (error) {
    statusText.textContent = `下载未启动：${error.message || "请重试"}`;
  } finally {
    busy = false;
    refreshButton.disabled = false;
    refreshButton.textContent = "刷新检测";
    downloadButton.disabled = !latestInfo;
  }
}

refreshButton.addEventListener("click", refresh);
downloadButton.addEventListener("click", downloadCurrentVideo);
document.getElementById("versionBadge").textContent = `v${chrome.runtime.getManifest().version}`;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.videoInfoByTab && !busy) refresh();
});
chrome.tabs.onActivated.addListener(() => { if (!busy) refresh(); });
chrome.tabs.onUpdated.addListener((_tabId, change) => { if ((change.url || change.status === "complete") && !busy) refresh(); });
refresh();
