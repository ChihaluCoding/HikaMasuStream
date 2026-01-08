"use strict";

/* ==========================================
   CONFIG: 2人分の設定をここに記述します
   ========================================== */
const CONFIG = {
  /* 【共通設定】APIキーなど（開発者自身のキー） */
  auth: {
    /* Twitch Client-ID */
    clientId: "hh34ypoujfz3hr8pm61ct9s37z2jzs",
    /* Twitch OAuth Token */
    token: "khvkcvwgyqwftcpltsfsijwg105q9o",
    /* YouTube API Key */
    apiKey: "AIzaSyBPY0fE2sRoTDsTNaIzsNjaaozptRuW5S4",
  },
  
  /* 【ターゲット設定】切り替える2人の情報 */
  targets: [
    {
      name: "Main Streamer", // ボタンに表示する名前等（自由記述）
      twitchId: "darkmasuotv", // 1人目のTwitch ID
      youtubeChannelId: "UCCUd6vfPvpPHBWZ6XwXAlRQ", // 1人目のYouTube Channel ID
    },
    {
      name: "Sub Streamer", // 2人目の名前
      twitchId: "shakach", // ★ここに2人目のTwitch IDを入力
      youtubeChannelId: "UCjg5-lUiUzTO_JlAG5wHwsQ", // ★ここに2人目のYouTube Channel IDを入力
    }
  ],

  intervalSec: 10,
  maxPoints: 120,
};

const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 300;
const YOUTUBE_SEARCH_REFRESH_MS = 5 * 60 * 1000;

/* DOM要素の参照 */
const dom = {
  startBtn: document.getElementById("start-btn"),
  stopBtn: document.getElementById("stop-btn"),
  notice: document.getElementById("form-errors"),
  
  /* Profile Buttons */
  profileBtn0: document.getElementById("profile-btn-0"),
  profileBtn1: document.getElementById("profile-btn-1"),
  
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

/* 現在選択中のターゲット番号 (0 or 1) */
let currentTargetIndex = 0; 
let activeSettings = null; // 現在有効な設定（結合後）

/* YouTubeの状態管理（配信者ごとに管理するため配列化） */
let youtubeStates = [
  { liveVideoId: "", lastSearchAt: 0 },
  { liveVideoId: "", lastSearchAt: 0 }
];

document.addEventListener("DOMContentLoaded", () => {
  initializeApp();
});

function initializeApp() {
  if (!dom.chart || !dom.startBtn) return;

  // 初期設定を読み込み
  updateActiveSettings(0);

  chartInstance = createChart(dom.chart);

  setNotice("Ready to Monitor", false);
  setApiMessage("Waiting for action...");

  // イベントリスナー
  dom.startBtn.addEventListener("click", handleStart);
  dom.stopBtn.addEventListener("click", handleStop);
  
  // 切り替えボタンのイベント
  if (dom.profileBtn0) {
    dom.profileBtn0.textContent = CONFIG.targets[0].name || "Streamer 1";
    dom.profileBtn0.addEventListener("click", () => switchProfile(0));
  }
  if (dom.profileBtn1) {
    dom.profileBtn1.textContent = CONFIG.targets[1].name || "Streamer 2";
    dom.profileBtn1.addEventListener("click", () => switchProfile(1));
  }
}

/* 設定を結合して現在のターゲットを更新 */
function updateActiveSettings(index) {
  currentTargetIndex = index;
  const target = CONFIG.targets[index];
  const auth = CONFIG.auth;

  // 表示用設定オブジェクトを作成
  activeSettings = {
    streamer: target.twitchId,
    clientId: auth.clientId,
    token: auth.token.replace("Bearer ", "").trim(), // Bearer除去
    youtube: {
      apiKey: auth.apiKey,
      channelId: target.youtubeChannelId
    },
    intervalSec: CONFIG.intervalSec,
    maxPoints: CONFIG.maxPoints
  };
}

/* プロファイル切り替え処理 */
function switchProfile(index) {
  if (currentTargetIndex === index) return; // 同じなら何もしない

  // 1. 設定を更新
  updateActiveSettings(index);

  // 2. ボタンの見た目を更新
  dom.profileBtn0.classList.toggle("active", index === 0);
  dom.profileBtn1.classList.toggle("active", index === 1);

  // 3. グラフをリセット
  if (chartInstance) {
    chartInstance.data.labels = [];
    chartInstance.data.datasets.forEach(ds => ds.data = []);
    chartInstance.update();
  }
  
  // 4. 数値表示をリセット
  resetDisplay();

  // 5. 実行中なら即時再取得、停止中なら設定変更のみ
  if (pollingTimerId !== null) {
    // タイマーリセットして即実行
    stopPolling();
    setNotice(`Switched to ${CONFIG.targets[index].name}`, false);
    handleStart(); // 再開
  } else {
    setNotice(`Selected: ${CONFIG.targets[index].name}`, false);
  }
}

/* 表示のリセット */
function resetDisplay() {
  // 数値をハイフンに戻し、アニメーション用の前回値をクリア
  dom.viewerCount.innerHTML = "-";
  delete dom.viewerCount.dataset.lastValue;
  delete dom.viewerCount.dataset.lastStrLen;

  dom.youtubeViewerCount.innerHTML = "-";
  delete dom.youtubeViewerCount.dataset.lastValue;
  delete dom.youtubeViewerCount.dataset.lastStrLen;

  dom.streamTitle.textContent = "-";
  dom.gameName.textContent = "-";
  dom.youtubeStreamTitle.textContent = "-";
  
  dom.liveStatus.className = "live-badge offline";
  dom.liveStatus.textContent = "WAITING";
  dom.youtubeLiveStatus.className = "live-badge offline";
  dom.youtubeLiveStatus.textContent = "WAITING";
}

/* ==========================================
   MAIN ACTIONS (Start/Stop)
   ========================================== */

async function handleStart() {
  setNotice(`Monitoring: ${CONFIG.targets[currentTargetIndex].name}`, false);
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
      fetchYouTubeLiveData(activeSettings, now, currentTargetIndex),
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
        // エラーでも止まらないように通知のみ
        console.error(results);
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

async function fetchYouTubeLiveData(settings, now, targetIdx) {
  const apiKey = settings.youtube.apiKey;
  const channelId = settings.youtube.channelId;
  
  // 現在のターゲット用の状態を使用
  const state = youtubeStates[targetIdx];
  const nowMs = now.getTime();
  const shouldSearch = !state.liveVideoId || nowMs - state.lastSearchAt > YOUTUBE_SEARCH_REFRESH_MS;

  if (shouldSearch) {
    state.liveVideoId = await fetchYouTubeLiveVideoId(apiKey, channelId);
    state.lastSearchAt = nowMs;
  }

  if (!state.liveVideoId) return { isLive: false, viewerCount: 0, title: "-" };

  const details = await fetchYouTubeVideoDetails(apiKey, state.liveVideoId);
  if (!details.isLive) state.liveVideoId = ""; // ライブが終わっていたらIDクリア
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
  
  try {
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) return ""; 
    const payload = await response.json();
    return payload?.items?.[0]?.id?.videoId || "";
  } catch(e) {
    return "";
  }
}

async function fetchYouTubeVideoDetails(apiKey, videoId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);
  
  try {
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) return { isLive: false, viewerCount: 0, title: "-" };
    const payload = await response.json();
    const item = payload?.items?.[0];
    if (!item) return { isLive: false, viewerCount: 0, title: "-" };
    
    const viewers = Number(item.liveStreamingDetails?.concurrentViewers);
    return {
      isLive: Number.isFinite(viewers),
      viewerCount: Number.isFinite(viewers) ? viewers : 0,
      title: item.snippet?.title || "-",
    };
  } catch(e) {
    return { isLive: false, viewerCount: 0, title: "-" };
  }
}

/* ==========================================
   UI UPDATES & ANIMATION (YouTube Style)
   ========================================== */

function updateRollingNumber(element, newValue) {
  if (!element) return;
  const prevValue = element.dataset.lastValue || "";
  const nextValueStr = numberFormatter.format(newValue);

  if (prevValue === String(newValue) && element.querySelector('.stat-number-container')) return;

  const prevStrLen = element.dataset.lastStrLen || 0;
  if (Number(prevStrLen) !== nextValueStr.length) {
    buildRollingStructure(element, nextValueStr);
  }
  
  requestAnimationFrame(() => {
    applyDigitPositions(element, nextValueStr);
  });

  element.dataset.lastValue = newValue;
  element.dataset.lastStrLen = nextValueStr.length;
}

function buildRollingStructure(element, valueStr) {
  element.innerHTML = "";
  const container = document.createElement("div");
  container.className = "stat-number-container";
  const chars = valueStr.split("");
  
  chars.forEach((char) => {
    if (/[0-9]/.test(char)) {
      const windowEl = document.createElement("div");
      windowEl.className = "digit-window";
      const laneEl = document.createElement("div");
      laneEl.className = "digit-lane";
      let html = "";
      for (let i = 0; i <= 9; i++) html += `<span>${i}</span>`;
      laneEl.innerHTML = html;
      windowEl.appendChild(laneEl);
      container.appendChild(windowEl);
    } else {
      const symbolEl = document.createElement("div");
      symbolEl.className = "digit-symbol";
      symbolEl.textContent = char;
      container.appendChild(symbolEl);
    }
  });
  element.appendChild(container);
}

function applyDigitPositions(element, valueStr) {
  const container = element.querySelector(".stat-number-container");
  if (!container) return;
  const windows = container.querySelectorAll(".digit-window");
  let digitIndex = 0;
  for (let i = 0; i < valueStr.length; i++) {
    const char = valueStr[i];
    if (/[0-9]/.test(char)) {
      const targetNum = parseInt(char, 10);
      const lane = windows[digitIndex].querySelector(".digit-lane");
      const translateY = -(targetNum * 10); 
      lane.style.transform = `translateY(${translateY}%)`;
      digitIndex++;
    }
  }
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
  updateRollingNumber(dom.youtubeViewerCount, result.viewerCount);
  dom.youtubeStreamTitle.textContent = result.title;
}

function buildApiMessage(results) {
  const twitch = results[0].status === "fulfilled" ? "OK" : "ERR";
  const youtube = results[1].status === "fulfilled" ? "OK" : "ERR";
  return `Twitch: ${twitch} / YouTube: ${youtube}`;
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