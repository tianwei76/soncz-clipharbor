(function () {
  const MESSAGE_TYPE = "DOUYIN_VIDEO_DOWNLOADER_RESULT";
  function normalizeUrl(value) {
    const text = String(value || "");
    return text.startsWith("//") ? window.location.protocol + text : text;
  }
  function compactList(values) {
    return Array.from(new Set(values.filter(Boolean).map(normalizeUrl)));
  }
  function isDouyinPage() {
    return /(^|\.)douyin\.com$/.test(window.location.hostname);
  }

  function cleanVideoUrl(value) {
    if (!value) {
      return "";
    }

    return String(value)
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&quot;|["')\\]+$/g, "")
      .trim();
  }

  function addVideoUrl(values, value) {
    const url = normalizeUrl(cleanVideoUrl(value));
    if (!url || /^blob:|^data:/i.test(url)) {
      return;
    }

    if (/^https?:\/\//i.test(url) && !values.includes(url)) {
      values.push(url);
    }
  }

  function addBlobUrl(values, value) {
    const url = String(value || "").trim();
    if (url.startsWith("blob:") && !values.includes(url)) {
      values.push(url);
    }
  }

  function readUrlList(value) {
    if (!value || typeof value !== "object") {
      return [];
    }

    const urls = [];
    if (Array.isArray(value.url_list)) {
      value.url_list.forEach((url) => addVideoUrl(urls, url));
    }

    addVideoUrl(urls, value.url_key);
    addVideoUrl(urls, value.uri);
    addVideoUrl(urls, value.url);

    const cleanUrls = urls.filter((url) => !/playwm|watermark|logo/i.test(url));
    const fallbackUrls = urls.filter((url) => /playwm|watermark|logo/i.test(url));

    return [...cleanUrls, ...fallbackUrls];
  }

  function readDouyinAwemeIdFromUrl(url) {
    const match = String(url || window.location.href).match(/\/video\/(\d+)|[?&]modal_id=(\d+)|[?&]aweme_id=(\d+)/);
    return match ? (match[1] || match[2] || match[3]) : "";
  }

  function readCurrentAwemeId() {
    const fromUrl = readDouyinAwemeIdFromUrl(window.location.href);
    if (fromUrl) return fromUrl;
    const renderData = document.getElementById("RENDER_DATA");
    const text = renderData && renderData.textContent ? renderData.textContent : "";
    const decoded = text ? (() => {
      try { return decodeURIComponent(text); } catch (_) { return text; }
    })() : "";
    const sources = [decoded, document.documentElement && document.documentElement.innerHTML || ""];
    for (const source of sources) {
      const match = source.match(/(?:awemeId|aweme_id)["'\\:\s]+(?:\\?["']?)(\d{10,})/)
        || source.match(/\/video\/(\d{10,})/)
        || source.match(/[?&](?:modal_id|aweme_id)=(\d{10,})/);
      if (match) return match[1];
    }
    return "";
  }

  function isDouyinVideoDetailPage(url) {
    const value = String(url || window.location.href);
    return /^https:\/\/(?:www\.)?douyin\.com\/video\/\d+(?:[/?#]|$)/.test(value)
      || /[?&](?:modal_id|aweme_id)=\d+/.test(value)
      || (!url && Boolean(readCurrentAwemeId()));
  }

  function collectDouyinVideoFromAweme(aweme, requestUrl, method) {
    if (!aweme || typeof aweme !== "object") {
      return null;
    }

    const video = aweme.video || {};
    const playUrls = [];
    const downloadUrls = [];
    const coverUrls = [];

    [
      video.play_addr,
      video.play_addr_h264,
      video.play_addr_265,
      video.play_api,
      video.h264_play_addr
    ].forEach((value) => {
      readUrlList(value).forEach((url) => addVideoUrl(playUrls, url));
    });

    if (Array.isArray(video.bit_rate)) {
      video.bit_rate.forEach((item) => {
        readUrlList(item && item.play_addr).forEach((url) => addVideoUrl(playUrls, url));
      });
    }

    readUrlList(video.download_addr).forEach((url) => addVideoUrl(downloadUrls, url));

    [
      video.cover,
      video.origin_cover,
      video.dynamic_cover
    ].forEach((value) => {
      readUrlList(value).forEach((url) => addVideoUrl(coverUrls, url));
    });

    if (!playUrls.length && !downloadUrls.length) {
      return null;
    }

    const awemeId = aweme.aweme_id || aweme.awemeId || readDouyinAwemeIdFromUrl(requestUrl);
    const desc = aweme.desc || aweme.preview_title || document.title || "";
    const author = aweme.author && (aweme.author.nickname || aweme.author.unique_id || aweme.author.short_id);

    return {
      platform: "douyin",
      requestUrl: requestUrl || window.location.href,
      requestMethod: String(method || "GET").toUpperCase(),
      capturedAt: new Date().toISOString(),
      aweme_id: awemeId ? String(awemeId) : "",
      video_title: desc,
      title: desc,
      video_author: author ? String(author) : "",
      video_urls: compactList(playUrls),
      video_download_urls: compactList(downloadUrls),
      video_backup_urls: compactList(downloadUrls),
      video_cover_urls: compactList(coverUrls),
      video_ids: compactList([awemeId]),
      video_source: "aweme"
    };
  }

  function collectDouyinVideoFromObject(value, requestUrl, method) {
    if (!value || typeof value !== "object") {
      return null;
    }

    const candidates = [];
    const seen = new Set();
    const visited = new Set();

    function addCandidate(item) {
      if (!item || typeof item !== "object" || seen.has(item)) {
        return;
      }

      seen.add(item);
      candidates.push(item);
    }

    function walk(source, depth) {
      if (!source || typeof source !== "object" || depth > 8 || visited.has(source)) {
        return;
      }
      visited.add(source);

      if (source.aweme_detail) {
        addCandidate(source.aweme_detail);
      }

      if (source.aweme_info) {
        addCandidate(source.aweme_info);
      }

      if (source.aweme_id && source.video) {
        addCandidate(source);
      }

      [
        source.aweme_list,
        source.data,
        source.list
      ].forEach((list) => {
        if (Array.isArray(list)) {
          list.forEach((item) => addCandidate(item && (item.aweme || item.aweme_info || item)));
        }
      });

      Object.keys(source).forEach((key) => {
        const nestedValue = source[key];
        if (nestedValue && typeof nestedValue === "object") {
          walk(nestedValue, depth + 1);
        }
      });
    }

    walk(value, 0);

    const currentAwemeId = isDouyinVideoDetailPage() ? readDouyinAwemeIdFromUrl(window.location.href) : "";
    const preferred = currentAwemeId
      ? candidates.find((item) => String(item.aweme_id || item.awemeId || "") === currentAwemeId)
      : null;
    const orderedCandidates = currentAwemeId ? (preferred ? [preferred] : []) : candidates;

    for (const candidate of orderedCandidates) {
      const payload = collectDouyinVideoFromAweme(candidate, requestUrl, method);
      if (payload) {
        return payload;
      }
    }

    return null;
  }

  function getVisibleVideoScore(video) {
    if (!video || video.closest(".__pre_create_player__")) {
      return 0;
    }

    const style = window.getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return 0;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) {
      return 0;
    }

    const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const visibleArea = visibleWidth * visibleHeight;

    if (!visibleArea) {
      return 0;
    }

    return visibleArea + (video.paused ? 0 : 1000000) + (video.currentTime > 0 ? 100000 : 0);
  }

  function getCurrentDouyinVideos() {
    return Array.from(document.querySelectorAll("video"))
      .map((video) => ({
        video,
        score: getVisibleVideoScore(video)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.video);
  }

  function collectUrlsFromVideoElement(video) {
    const urls = [];
    const blobUrls = [];
    addVideoUrl(urls, video && (video.currentSrc || video.src || ""));
    addBlobUrl(blobUrls, video && (video.currentSrc || video.src || ""));
    Array.from(video ? video.querySelectorAll("source") : []).forEach((source) => {
      addVideoUrl(urls, source.currentSrc || source.src || source.getAttribute("src") || "");
      addBlobUrl(blobUrls, source.currentSrc || source.src || source.getAttribute("src") || "");
    });

    return { urls, blobUrls };
  }

  function collectDouyinVideoFromDom() {
    if (!isDouyinPage() || !isDouyinVideoDetailPage()) {
      return null;
    }

    const urls = [];
    const blobUrls = [];
    const currentVideos = getCurrentDouyinVideos();
    currentVideos.slice(0, 1).forEach((video) => {
      const found = collectUrlsFromVideoElement(video);
      found.urls.forEach((url) => addVideoUrl(urls, url));
      found.blobUrls.forEach((url) => addBlobUrl(blobUrls, url));
    });

    if (!urls.length && !blobUrls.length) {
      return null;
    }

    const awemeId = readCurrentAwemeId();
    return {
      platform: "douyin",
      requestUrl: window.location.href,
      requestMethod: "DOM",
      capturedAt: new Date().toISOString(),
      aweme_id: awemeId,
      title: document.title || "",
      video_title: document.title || "",
      video_urls: compactList(urls),
      video_blob_urls: blobUrls,
      video_download_urls: [],
      video_backup_urls: [],
      video_cover_urls: [],
      video_ids: compactList([awemeId]),
      video_source: "dom"
    };
  }

  function isVideoResourceUrl(url) {
    return /^https?:\/\//i.test(String(url || "")) &&
      /(\.mp4(?:$|[?#])|mime_type=video|video_id=|\/video\/|\/play(?:wm)?\/|\.m3u8(?:$|[?#]))/i.test(String(url));
  }

  function collectDouyinVideoFromResourceUrl(url, source) {
    if (!isVideoResourceUrl(url) || !isDouyinVideoDetailPage()) return null;
    const awemeId = readDouyinAwemeIdFromUrl();
    return {
      platform: "douyin",
      requestUrl: String(url),
      requestMethod: "GET",
      capturedAt: new Date().toISOString(),
      aweme_id: awemeId,
      title: document.title || "",
      video_title: document.title || "",
      video_urls: [String(url)],
      video_download_urls: [String(url)],
      video_backup_urls: [],
      video_cover_urls: [],
      video_blob_urls: [],
      video_ids: compactList([awemeId]),
      video_source: source || "resource"
    };
  }


  function publish(payload) {
    if (!payload || !isDouyinVideoDetailPage() || payload.aweme_id !== readCurrentAwemeId() ||
        !((Array.isArray(payload.video_urls) && payload.video_urls.length)
          || (Array.isArray(payload.video_download_urls) && payload.video_download_urls.length)
          || (Array.isArray(payload.video_blob_urls) && payload.video_blob_urls.length))) return;
    payload.pageUrl = window.location.href;
    window.postMessage({ type: MESSAGE_TYPE, payload }, window.location.origin);
  }

  function shouldInspect(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return /(^|\.)douyin\.com$/.test(parsed.hostname)
        && (/\/aweme\/v\d+\/web\//.test(parsed.pathname)
          || /\/aweme\/v\d+\//.test(parsed.pathname));
    } catch (_) { return false; }
  }

  function inspectResponse(text, url, method, pageUrl) {
    if (pageUrl !== window.location.href || !isDouyinVideoDetailPage()) return;
    try {
      publish(collectDouyinVideoFromObject(JSON.parse(text), url, method));
    } catch (_) {}
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const pageUrl = window.location.href;
    const response = await originalFetch.apply(this, args);
    const request = args[0];
    const url = String(request && request.url || request || "");
    if (isVideoResourceUrl(url)) publish(collectDouyinVideoFromResourceUrl(url, "fetch"));
    if (shouldInspect(url)) {
      try {
        response.clone().text()
          .then((text) => inspectResponse(text, url, args[1] && args[1].method || request && request.method, pageUrl))
          .catch(() => {});
      } catch (_) {}
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__douyinVideoMethod = method;
    this.__douyinVideoUrl = String(url || "");
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const url = this.__douyinVideoUrl;
    const method = this.__douyinVideoMethod;
    const pageUrl = window.location.href;
    if (isVideoResourceUrl(url)) publish(collectDouyinVideoFromResourceUrl(url, "xhr"));
    if (shouldInspect(url)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "json") {
            if (pageUrl === window.location.href) publish(collectDouyinVideoFromObject(this.response, url, method));
          } else if (!this.responseType || this.responseType === "text") {
            inspectResponse(this.responseText, url, method, pageUrl);
          }
        } catch (_) {}
      }, { once: true });
    }
    return originalSend.apply(this, arguments);
  };

  let publishTimer = 0;
  let previousSignature = "";
  let previousPage = window.location.href;
  function scanPage() {
    if (previousPage !== window.location.href) {
      previousPage = window.location.href;
      previousSignature = "";
    }
    if (!isDouyinVideoDetailPage()) return;
    const payload = collectDouyinVideoFromDom();
    if (payload) {
      const signature = JSON.stringify([payload.aweme_id, payload.video_urls, payload.video_blob_urls]);
      if (signature !== previousSignature) {
        previousSignature = signature;
        publish(payload);
      }
    }
    try {
      performance.getEntriesByType("resource")
        .map((entry) => entry && entry.name)
        .filter(isVideoResourceUrl)
        .slice(-20)
        .forEach((url) => publish(collectDouyinVideoFromResourceUrl(url, "performance")));
    } catch (_) {}
    if (!payload) return;
  }
  function scheduleScan() {
    window.clearTimeout(publishTimer);
    publishTimer = window.setTimeout(scanPage, 250);
  }
  function startObserver() {
    if (!document.documentElement) return;
    new MutationObserver((mutations) => {
      if (previousPage !== window.location.href || mutations.some((mutation) =>
        mutation.target.nodeName === "VIDEO" || mutation.target.nodeName === "SOURCE" ||
        Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 &&
          (node.nodeName === "VIDEO" || node.querySelector && node.querySelector("video")))
      )) scheduleScan();
    }).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["src"]
    });
    scheduleScan();
  }
  document.addEventListener("loadedmetadata", scheduleScan, true);
  document.addEventListener("play", scheduleScan, true);
  window.addEventListener("popstate", scheduleScan);
  window.addEventListener("load", scheduleScan, { once: true });
  startObserver();
  window.setTimeout(scheduleScan, 1200);
  window.setTimeout(scheduleScan, 3000);
})();
