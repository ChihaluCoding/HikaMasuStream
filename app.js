"use strict";

/* ==========================================
   CONFIG: 元の認証情報を維持してください
   ========================================== */
const CONFIG = {
  /* 配信者ID（TwitchのURLのユーザー名） */
  streamer: "darkmasuotv",
  /* Twitch Developer Consoleで発行したClient-ID */
  clientId: "hh34ypoujfz3hr8pm61ct9s37z2jzs",
  /* OAuthトークン */
  token: "khvkcvwgyqwftcpltsfsijwg105q9o",
  /* YouTube Data APIの設定 */
  youtube: {
    /* YouTube Data API v3のAPIキー */
    apiKey: "AIzaSyBPY0fE2sRoTDsTNaIzsNjaaozptRuW5S4",
    /* YouTubeのチャンネルID */
    channelId: "UCCUd6vfPvpPHBWZ6XwXAlRQ",
  },
  intervalSec: 10,
  maxPoints: 120,
};

const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 300;
const MIN_POINTS = 10;
const MAX_POINTS = 600;
const YOUTUBE_SEARCH_REFRESH_MS = 5 * 60 * 1000;

/* DOM要素の参照 */
const dom = {
  startBtn: document.getElementById("start-btn"),
  stopBtn: document.getElementById("stop-btn"),
  notice: document.getElementById("form-errors"),
  
  /* Twitch Card Elements */
  liveStatus: document.getElementById("live-status"),
  viewerCount: document.getElementById("viewer-count"),
  streamTitle: document.getElementById("stream-title"),
  gameName: document.getElementById("game-name"),
  
  /* YouTube Card Elements */
  youtubeLiveStatus: document.getElementById("youtube-live-status"),
  youtubeViewerCount: document.getElementById("youtube-viewer-count"),
  youtubeStreamTitle: document.getElementById("youtube-stream-title"),
  
  /* Meta Info */
  lastUpdated: document.getElementById("last-updated"),
  apiMessage: document.getElementById("api-message"),
  
  /* Chart */
  chart: document.getElementById("viewer-chart"),
};

const timeFormatter = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const numberFormatter = new Intl.NumberFormat("ja-JP");

let chartInstance = null;
let pollingTimerId = null;
let isFetching = false;
let activeSettings = normalizeSettings(CONFIG);
let youtubeState = { liveVideoId: "", lastSearchAt: 0 };

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

function initializeApp() {
  if (!dom.chart || !dom.startBtn || !dom.stopBtn) return;

  activeSettings = normalizeSettings(CONFIG);
  chartInstance = createChart(dom.chart);

  const errors = validateSettings(activeSettings);
  if (errors.length > 0) {
    setNotice("Config Error", true);
    setRunningState(false, false);
  } else {
    setNotice("Ready to Monitor", false);
    setRunningState(false, true);
  }

  setApiMessage("Waiting for action...");
  dom.startBtn.addEventListener("click", handleStart);
  dom.stopBtn.addEventListener("click", handleStop);
}

/* ==========================================
   HELPER FUNCTIONS
   ========================================== */

function normalizeSettings(settings) {
  const rawToken = typeof settings.token === "string" ? settings.token.trim() : "";
  const normalizedToken = rawToken.toLowerCase().startsWith("bearer ") ? rawToken.slice(7).trim() : rawToken;
  const youtube = typeof settings.youtube === "object" && settings.youtube !== null ? settings.youtube : {};
  
  return {
    streamer: typeof settings.streamer === "string" ? settings.streamer.trim() : "",
    clientId: typeof settings.clientId === "string" ? settings.clientId.trim() : "",
    token: normalizedToken,
    youtube: {
      apiKey: typeof youtube.apiKey === "string" ? youtube.apiKey.trim() : "",
      channelId: typeof youtube.channelId === "string" ? youtube.channelId.trim() : "",
    },
    intervalSec: Number(settings.intervalSec),
    maxPoints: Number(settings.maxPoints),
  };
}

function validateSettings(settings) {
  const errors = [];
  if (!settings.streamer) errors.push("Twitch ID未設定");
  if (!settings.clientId) errors.push("Client ID未設定");
  if (!settings.token) errors.push("Token未設定");
  if (!settings.youtube.apiKey) errors.push("YouTube API Key未設定");
  if (!settings.youtube.channelId) errors.push("Channel ID未設定");
  return errors;
}

/**
 * ========================================================
 * YouTube風 個別桁回転アニメーションロジック
 * ========================================================
 */
function updateRollingNumber(element, newValue) {
  if (!element) return;

  const prevValue = element.dataset.lastValue || "";
  const nextValueStr = numberFormatter.format(newValue); // 例: "1,234"

  // 値が変わっていない場合、かつDOM構造がすでに作られているなら何もしない
  if (prevValue === String(newValue) && element.querySelector('.stat-number-container')) {
    return;
  }

  // 桁数が変わった場合（例: 99 -> 100）は構造を作り直す
  // (同じ桁数ならリールを回すだけで済むが、実装を簡単にするため文字長が変われば再構築)
  const prevStrLen = element.dataset.lastStrLen || 0;
  if (Number(prevStrLen) !== nextValueStr.length) {
    buildRollingStructure(element, nextValueStr);
  }

  // DOM更新後、各桁を指定の位置まで回転させる
  // 少し遅らせて描画を確定させないと、初期表示のアニメーションが効かないことがあるため
  requestAnimationFrame(() => {
    applyDigitPositions(element, nextValueStr);
  });

  // 値を保存
  element.dataset.lastValue = newValue;
  element.dataset.lastStrLen = nextValueStr.length;
}

// 桁ごとのHTML構造を作成する（0-9のリールを作る）
function buildRollingStructure(element, valueStr) {
  element.innerHTML = "";
  const container = document.createElement("div");
  container.className = "stat-number-container";

  // 文字列を一文字ずつ解析
  const chars = valueStr.split("");
  
  chars.forEach((char) => {
    if (/[0-9]/.test(char)) {
      // 数字の場合: 0〜9が入ったリールを作る
      const windowEl = document.createElement("div");
      windowEl.className = "digit-window";
      
      const laneEl = document.createElement("div");
      laneEl.className = "digit-lane";
      
      // 0から9までの数字を縦に積む
      let html = "";
      for (let i = 0; i <= 9; i++) {
        html += `<span>${i}</span>`;
      }
      laneEl.innerHTML = html;
      
      windowEl.appendChild(laneEl);
      container.appendChild(windowEl);
    } else {
      // カンマなどの記号の場合: 静的な要素として配置
      const symbolEl = document.createElement("div");
      symbolEl.className = "digit-symbol";
      symbolEl.textContent = char;
      container.appendChild(symbolEl);
    }
  });

  element.appendChild(container);
}

// 各リールの位置を決定してアニメーションさせる
function applyDigitPositions(element, valueStr) {
  const container = element.querySelector(".stat-number-container");
  if (!container) return;

  const windows = container.querySelectorAll(".digit-window");
  let digitIndex = 0;

  // 入力文字列の数字部分だけを抽出して対応させる
  for (let i = 0; i < valueStr.length; i++) {
    const char = valueStr[i];
    
    // 数字の場合のみリールを操作
    if (/[0-9]/.test(char)) {
      const targetNum = parseInt(char, 10);
      const lane = windows[digitIndex].querySelector(".digit-lane");
      
      // 数字の高さ(1.1em)ではなくパーセントで移動 (0 = 0%, 1 = -10%, ..., 9 = -90%)
      // 10個の数字が縦に並んでいるので、1つあたり10%の高さになる
      const translateY = -(targetNum * 10); 
      
      lane.style.transform = `translateY(${translateY}%)`;
      digitIndex++;
    }
  }
}
/* ======================================================== */


/* ==========================================
   MAIN ACTIONS
   ========================================== */

async function handleStart() {
  const settings = normalizeSettings(CONFIG);
  const errors = validateSettings(settings);
  if (errors.length > 0) {
    setNotice("Config Error", true);
    setRunningState(false, false);
    return;
  }

  activeSettings = { ...settings };
  setNotice("Monitoring...", false);
  setRunningState(true, true);

  await fetchAndUpdate();
  startPolling();
}

function handleStop() {
  stopPolling();
  setRunningState(false, true);
  setNotice("Stopped", false);
}

function startPolling() {
  stopPolling();
  pollingTimerId = window.setInterval(() => {
    void fetchAndUpdate();
  }, activeSettings.intervalSec * 1000);
}

function stopPolling() {
  if (pollingTimerId !== null) {
    clearInterval(pollingTimerId);
    pollingTimerId = null;
  }
}

async function fetchAndUpdate() {
  if (isFetching) return;
  isFetching = true;
  const now = new Date();

  try {
    const results = await Promise.allSettled([
      fetchTwitchLiveData(activeSettings),
      fetchYouTubeLiveData(activeSettings, now),
    ]);

    const twitchResult = results[0].status === "fulfilled" ? results[0].value : null;
    const youtubeResult = results[1].status === "fulfilled" ? results[1].value : null;

    updateTwitchStatus(twitchResult || null);
    updateYouTubeStatus(youtubeResult || null);
    updateLastUpdated(now);

    pushChartPoints(
      timeFormatter.format(now),
      [
        twitchResult ? twitchResult.viewerCount : null,
        youtubeResult ? youtubeResult.viewerCount : null,
      ],
      activeSettings.maxPoints
    );

    const apiMessage = buildApiMessage(results);
    setApiMessage(apiMessage);
    
    if (results.some(r => r.status === 'rejected')) {
        setNotice("API Error", true);
    } else {
        setNotice("Monitoring Active", false);
    }

  } catch (error) {
    setNotice("System Error", true);
    setApiMessage(error.message);
  } finally {
    isFetching = false;
  }
}

/* ==========================================
   API FETCHING
   ========================================== */

async function fetchTwitchLiveData(settings) {
  const url = new URL("https://api.twitch.tv/helix/streams");
  url.searchParams.set("user_login", settings.streamer);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Client-ID": settings.clientId,
      Authorization: `Bearer ${settings.token}`,
    },
  });

  if (!response.ok) throw new Error(`Twitch API Error: ${response.status}`);
  const payload = await response.json();
  const stream = Array.isArray(payload.data) && payload.data.length > 0 ? payload.data[0] : null;

  if (!stream) return { isLive: false, viewerCount: 0, title: "-", gameName: "-" };
  return {
    isLive: true,
    viewerCount: Number(stream.viewer_count) || 0,
    title: stream.title || "-",
    gameName: stream.game_name || "-",
  };
}

async function fetchYouTubeLiveData(settings, now) {
  const apiKey = settings.youtube.apiKey;
  const channelId = settings.youtube.channelId;
  const nowMs = now.getTime();
  const shouldSearch = !youtubeState.liveVideoId || nowMs - youtubeState.lastSearchAt > YOUTUBE_SEARCH_REFRESH_MS;

  if (shouldSearch) {
    youtubeState.liveVideoId = await fetchYouTubeLiveVideoId(apiKey, channelId);
    youtubeState.lastSearchAt = nowMs;
  }

  if (!youtubeState.liveVideoId) return { isLive: false, viewerCount: 0, title: "-" };

  const details = await fetchYouTubeVideoDetails(apiKey, youtubeState.liveVideoId);
  if (!details.isLive) youtubeState.liveVideoId = "";
  return details;
}

async function fetchYouTubeLiveVideoId(apiKey, channelId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "id");
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("eventType", "live");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) throw new Error("YouTube Search Error");
  const payload = await response.json();
  return payload?.items?.[0]?.id?.videoId || "";
}

async function fetchYouTubeVideoDetails(apiKey, videoId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);
  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) throw new Error("YouTube Details Error");
  const payload = await response.json();
  const item = payload?.items?.[0];
  if (!item) return { isLive: false, viewerCount: 0, title: "-" };
  
  const viewers = Number(item.liveStreamingDetails?.concurrentViewers);
  return {
    isLive: Number.isFinite(viewers),
    viewerCount: Number.isFinite(viewers) ? viewers : 0,
    title: item.snippet?.title || "-",
  };
}

/* ==========================================
   UI UPDATES
   ========================================== */

function buildApiMessage(results) {
  const twitch = results[0].status === "fulfilled" ? "OK" : "ERR";
  const youtube = results[1].status === "fulfilled" ? "OK" : "ERR";
  return `Twitch: ${twitch} / YouTube: ${youtube}`;
}

function updateTwitchStatus(result) {
  if (!dom.liveStatus) return;
  if (!result) {
    dom.liveStatus.textContent = "ERROR";
    dom.liveStatus.className = "live-badge offline";
    dom.viewerCount.textContent = "-";
    return;
  }
  dom.liveStatus.textContent = result.isLive ? "LIVE" : "OFFLINE";
  dom.liveStatus.className = result.isLive ? "live-badge live" : "live-badge offline";
  
  // 個別桁回転アニメーション適用
  updateRollingNumber(dom.viewerCount, result.viewerCount);
  
  dom.streamTitle.textContent = result.title;
  dom.gameName.textContent = result.gameName;
}

function updateYouTubeStatus(result) {
  if (!dom.youtubeLiveStatus) return;
  if (!result) {
    dom.youtubeLiveStatus.textContent = "ERROR";
    dom.youtubeLiveStatus.className = "live-badge offline";
    dom.youtubeViewerCount.textContent = "-";
    return;
  }
  dom.youtubeLiveStatus.textContent = result.isLive ? "LIVE" : "OFFLINE";
  dom.youtubeLiveStatus.className = result.isLive ? "live-badge live" : "live-badge offline";
  
  // 個別桁回転アニメーション適用
  updateRollingNumber(dom.youtubeViewerCount, result.viewerCount);
  
  dom.youtubeStreamTitle.textContent = result.title;
}

function updateLastUpdated(now) {
  if (dom.lastUpdated) dom.lastUpdated.textContent = timeFormatter.format(now);
}

function setNotice(message, isError) {
  if (!dom.notice) return;
  dom.notice.textContent = message;
  dom.notice.className = isError ? "status-text error" : "status-text ready";
}

function setApiMessage(message) {
  if (dom.apiMessage) dom.apiMessage.textContent = message;
}

function setRunningState(isRunning, canStart) {
  if (dom.startBtn) dom.startBtn.disabled = isRunning || !canStart;
  if (dom.stopBtn) dom.stopBtn.disabled = !isRunning;
}

/* ==========================================
   CHART
   ========================================== */

function pushChartPoints(label, values, maxPoints) {
  if (!chartInstance) return;
  chartInstance.data.labels.push(label);
  values.forEach((value, index) => {
    chartInstance.data.datasets[index]?.data.push(value);
  });
  if (chartInstance.data.labels.length > maxPoints) {
    chartInstance.data.labels.shift();
    chartInstance.data.datasets.forEach(ds => ds.data.shift());
  }
  chartInstance.update("none");
}

function createChart(canvas) {
  if (typeof Chart === "undefined") return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const createGradient = (ctx, color) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, color.replace("1)", "0.2)"));
    gradient.addColorStop(1, color.replace("1)", "0.0)"));
    return gradient;
  };

  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Twitch",
          data: [],
          borderColor: "#9146FF",
          backgroundColor: (c) => createGradient(c.chart.ctx, "rgba(145, 70, 255, 1)"),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
        },
        {
          label: "YouTube",
          data: [],
          borderColor: "#FF0000",
          backgroundColor: (c) => createGradient(c.chart.ctx, "rgba(255, 0, 0, 1)"),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1f2937",
          titleColor: "#f9fafb",
          bodyColor: "#f9fafb",
          padding: 10,
          cornerRadius: 4,
          displayColors: false,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#9ca3af",
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
            font: { family: "'Inter', sans-serif", size: 10 },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "#9ca3af",
            font: { family: "'Inter', sans-serif", size: 10 },
            callback: (val) => numberFormatter.format(val),
          },
          grid: {
            color: "#f3f4f6",
            borderDash: [0, 0],
          },
          border: { display: false },
        },
      },
    },
  });
}