require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const yahooFinance = require("yahoo-finance2").default;

const CANDIDATE_SYMBOLS = [
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "ICICIBANK.NS",
  "SBIN.NS",
  "INFY.NS",
  "ITC.NS",
  "LT.NS",
  "AXISBANK.NS",
  "KOTAKBANK.NS",
  "BHARTIARTL.NS",
  "MARUTI.NS",
  "BAJFINANCE.NS",
  "ASIANPAINT.NS",
  "SUNPHARMA.NS",
  "TITAN.NS",
  "WIPRO.NS",
  "HCLTECH.NS",
  "ONGC.NS",
  "NTPC.NS",
];

const DEFAULT_TOTAL_CAPITAL = 10000;

function resolveTotalCapitalFromEnv() {
  const candidates = [
    process.env.TOTAL_CAPITAL,
    process.env.TRADING_CAPITAL,
    process.env.CAPITAL,
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_TOTAL_CAPITAL;
}

const TOTAL_CAPITAL = resolveTotalCapitalFromEnv();

const STRATEGY_CONFIG = {
  totalCapital: TOTAL_CAPITAL,
  maxDailyLossPercent: 1,
  topN: 5,
  selectionLimit: 0,
  buyContinuousRiseMinutes: 8,
  shortContinuousFallMinutes: 8,
  trendStrengthThreshold: 0.75,
  allowRepeatEntryOnContinuousTrend: true,
  perStockStopLossPercent: 0.8,
  firstProfitTargetPercent: 0.6,
  firstProfitExitPercent: 60,
  remainderHardTargetPercent: 1.2,
  trailingStopPercent: 0.5,
  timeExitMinutes: 0,
  moveStopToEntryAfterFirstExit: true,
  marketScreenerCount: 250,
  autoStartBeforeMarketMinutes: 30,
  marketOpenTimeIST: "09:00",
  marketCloseTimeIST: "15:00",
  squareOffTimeIST: "14:50",
  weekdaysOnly: true,
};

const STRATEGY_PRESETS = {
  S1: {
    name: "Balanced Momentum",
    config: {
      buyContinuousRiseMinutes: 8,
      shortContinuousFallMinutes: 8,
      trendStrengthThreshold: 0.75,
      allowRepeatEntryOnContinuousTrend: true,
      perStockStopLossPercent: 0.8,
      firstProfitTargetPercent: 0.6,
      firstProfitExitPercent: 60,
      remainderHardTargetPercent: 1.2,
      trailingStopPercent: 0.5,
      timeExitMinutes: 0,
      moveStopToEntryAfterFirstExit: true,
    },
  },
  S2: {
    name: "Conservative Filter",
    config: {
      buyContinuousRiseMinutes: 10,
      shortContinuousFallMinutes: 10,
      trendStrengthThreshold: 0.82,
      allowRepeatEntryOnContinuousTrend: false,
      perStockStopLossPercent: 0.8,
      firstProfitTargetPercent: 0.7,
      firstProfitExitPercent: 65,
      remainderHardTargetPercent: 1.4,
      trailingStopPercent: 0.45,
      timeExitMinutes: 0,
      moveStopToEntryAfterFirstExit: true,
    },
  },
  S3: {
    name: "Aggressive Intraday",
    config: {
      buyContinuousRiseMinutes: 6,
      shortContinuousFallMinutes: 6,
      trendStrengthThreshold: 0.65,
      allowRepeatEntryOnContinuousTrend: true,
      perStockStopLossPercent: 0.8,
      firstProfitTargetPercent: 0.5,
      firstProfitExitPercent: 50,
      remainderHardTargetPercent: 1.0,
      trailingStopPercent: 0.6,
      timeExitMinutes: 0,
      moveStopToEntryAfterFirstExit: true,
    },
  },
  S4: {
    name: "Option-Style Bearish PUT",
    config: {
      buyContinuousRiseMinutes: 6,
      shortContinuousFallMinutes: 6,
      trendStrengthThreshold: 0.65,
      allowRepeatEntryOnContinuousTrend: false,
      perStockStopLossPercent: 0.8,
      firstProfitTargetPercent: 0.5,
      firstProfitExitPercent: 100,
      remainderHardTargetPercent: 0,
      trailingStopPercent: 0,
      timeExitMinutes: 0,
      moveStopToEntryAfterFirstExit: false,
      supertrendFactor: 3.0,
      supertrendPeriod: 10,
      rsiPeriod: 14,
      emaFastPeriod: 20,
      emaSlowPeriod: 50,
      optionPremium: 5.0,
      targetPoints: 2.0,
      stopLossPoints: 1.0,
      premiumMovePerUnderlyingPercent: 1.0,
    },
  },
};

let activeStrategyId = "S4";

function applyStrategyPreset(strategyId) {
  const preset = STRATEGY_PRESETS[strategyId];
  if (!preset) {
    throw new Error(`Unknown strategy id: ${strategyId}`);
  }

  Object.assign(STRATEGY_CONFIG, preset.config);
  STRATEGY_CONFIG.totalCapital = TOTAL_CAPITAL;
  activeStrategyId = strategyId;

  return {
    id: activeStrategyId,
    name: preset.name,
    config: { ...STRATEGY_CONFIG },
  };
}

function getStrategyPresets() {
  return Object.entries(STRATEGY_PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    config: { ...preset.config },
  }));
}

function getActiveStrategy() {
  const preset = STRATEGY_PRESETS[activeStrategyId];
  return {
    id: activeStrategyId,
    name: preset?.name || activeStrategyId,
    config: { ...STRATEGY_CONFIG },
  };
}

applyStrategyPreset(activeStrategyId);

const state = {
  symbols: [],
  selectedSymbolsDate: null,
  selectionOffset: 0,
  selectionWindowStart: null,
  selectionWindowTradeCount: 0,
  historyLoadedDate: null,
  lastHistoryPersistAt: 0,
  marketUniverse: [],
  marketSource: "fallback",
  dailyControl: {
    date: null,
    cutoffHit: false,
  },
  historyBySymbol: new Map(),
  openPositions: new Map(),
  trades: [],
  liveStateLoaded: false,
  lastLiveStatePersistAt: 0,
  lastRun: null,
  lastError: null,
  cycleCount: 0,
  adaptiveStrategyGeneratedDate: null,
  adaptiveStrategyInProgress: false,
  lastAdaptiveStrategy: null,
  lastAdaptiveStrategyError: null,
};

const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_SCREENER_BASE_URL = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
const SIGNAL_CANDLE_MINUTES = 3;
const ENTRY_UP_CANDLE_COUNT = 4;
const HISTORY_DIRECTORY = path.join(__dirname, "..", "data", "price-history");
const HISTORY_SAVE_INTERVAL_MS = 15000;
const LIVE_STATE_FILE_PATH = path.join(__dirname, "..", "data", "live-state.json");
const LIVE_STATE_SAVE_INTERVAL_MS = 5000;

function getHistoryFilePath(dateString) {
  return path.join(HISTORY_DIRECTORY, `${dateString}.json`);
}

function serializeHistoryBySymbol() {
  const payload = {};
  for (const [symbol, points] of state.historyBySymbol.entries()) {
    payload[symbol] = points.map((point) => ({
      time: point.time instanceof Date ? point.time.toISOString() : point.time,
      price: point.price,
    }));
  }
  return payload;
}

function applySerializedHistory(historyPayload) {
  const nextMap = new Map();

  if (!historyPayload || typeof historyPayload !== "object") {
    state.historyBySymbol = nextMap;
    return;
  }

  Object.entries(historyPayload).forEach(([symbol, points]) => {
    if (!Array.isArray(points)) {
      return;
    }

    const cleaned = points
      .map((point) => {
        const time = new Date(point?.time);
        const price = Number(point?.price);
        if (!Number.isFinite(time.getTime()) || !Number.isFinite(price) || price <= 0) {
          return null;
        }
        return { time, price };
      })
      .filter(Boolean)
      .slice(-120);

    if (cleaned.length > 0) {
      nextMap.set(symbol, cleaned);
    }
  });

  state.historyBySymbol = nextMap;
}

function serializeLiveState() {
  return {
    savedAt: new Date().toISOString(),
    activeStrategyId,
    trades: state.trades.map((trade) => ({
      ...trade,
      strategyId: trade?.strategyId || activeStrategyId,
      time: trade?.time instanceof Date ? trade.time.toISOString() : trade?.time,
    })),
    openPositions: Array.from(state.openPositions.values()).map((position) => ({
      ...position,
      strategyId: position?.strategyId || activeStrategyId,
      entryTime: position?.entryTime instanceof Date ? position.entryTime.toISOString() : position?.entryTime,
    })),
  };
}

function applySerializedLiveState(payload) {
  const trades = Array.isArray(payload?.trades) ? payload.trades : [];
  const openPositions = Array.isArray(payload?.openPositions) ? payload.openPositions : [];

  state.trades = trades
    .map((trade) => {
      if (!trade || !trade.symbol || !trade.action) {
        return null;
      }

      const parsedTime = trade.time ? new Date(trade.time) : null;
      const time = parsedTime && Number.isFinite(parsedTime.getTime()) ? parsedTime : new Date();

      return {
        ...trade,
        strategyId: trade.strategyId || activeStrategyId,
        time,
      };
    })
    .filter(Boolean);

  const nextOpenPositions = new Map();
  openPositions.forEach((position) => {
    if (!position || !position.symbol) {
      return;
    }

    const parsedEntryTime = position.entryTime ? new Date(position.entryTime) : null;
    const entryTime = parsedEntryTime && Number.isFinite(parsedEntryTime.getTime())
      ? parsedEntryTime
      : new Date();

    nextOpenPositions.set(position.symbol, {
      ...position,
      strategyId: position.strategyId || activeStrategyId,
      entryTime,
    });
  });

  state.openPositions = nextOpenPositions;
}

async function loadLiveStateFromDisk() {
  if (state.liveStateLoaded) {
    return;
  }

  try {
    const raw = await fs.readFile(LIVE_STATE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    applySerializedLiveState(parsed);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      state.lastError = error.message || String(error);
    }
  } finally {
    state.liveStateLoaded = true;
  }
}

async function saveLiveStateToDisk(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - state.lastLiveStatePersistAt < LIVE_STATE_SAVE_INTERVAL_MS) {
    return;
  }

  await fs.mkdir(path.dirname(LIVE_STATE_FILE_PATH), { recursive: true });
  const payload = serializeLiveState();
  await fs.writeFile(LIVE_STATE_FILE_PATH, JSON.stringify(payload, null, 2), "utf8");
  state.lastLiveStatePersistAt = nowMs;
}

async function loadTodayPriceHistory(dateString) {
  if (state.historyLoadedDate === dateString) {
    return;
  }

  state.historyBySymbol = new Map();

  try {
    const filePath = getHistoryFilePath(dateString);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    applySerializedHistory(parsed?.historyBySymbol);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      state.lastError = error.message || String(error);
    }
  } finally {
    state.historyLoadedDate = dateString;
  }
}

async function saveTodayPriceHistory(dateString, force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - state.lastHistoryPersistAt < HISTORY_SAVE_INTERVAL_MS) {
    return;
  }

  await fs.mkdir(HISTORY_DIRECTORY, { recursive: true });
  const payload = {
    date: dateString,
    savedAt: new Date().toISOString(),
    historyBySymbol: serializeHistoryBySymbol(),
  };
  await fs.writeFile(getHistoryFilePath(dateString), JSON.stringify(payload, null, 2), "utf8");
  state.lastHistoryPersistAt = nowMs;
}

function percentChange(base, current) {
  if (!base || !current) {
    return 0;
  }
  return ((current - base) / base) * 100;
}

function round2(value) {
  return Number(value.toFixed(2));
}

function capitalPerPosition() {
  return STRATEGY_CONFIG.totalCapital / STRATEGY_CONFIG.topN;
}

function calculateUnits(price) {
  if (typeof price !== "number" || price <= 0) {
    return 0;
  }
  return Math.floor(capitalPerPosition() / price);
}

function minutesBetween(entryTime, now) {
  if (!entryTime || !now) {
    return 0;
  }
  return (new Date(now).getTime() - new Date(entryTime).getTime()) / (1000 * 60);
}

function getMaxDailyLossAmount() {
  return (STRATEGY_CONFIG.totalCapital * STRATEGY_CONFIG.maxDailyLossPercent) / 100;
}

function toMinuteLabel(value) {
  return new Date(value).toISOString();
}

function toDateStringInIST(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const getPart = (type) => parts.find((item) => item.type === type)?.value || "";
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  return `${year}-${month}-${day}`;
}

function normalizeDateToIST(value) {
  return toDateStringInIST(new Date(value));
}

function getIstDateParts(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(value);
  const getPart = (type) => parts.find((item) => item.type === type)?.value || "";
  const weekday = getPart("weekday");
  const hour = Number(getPart("hour"));
  const minute = Number(getPart("minute"));

  return {
    weekday,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

function parseTimeToMinutes(timeText) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeText || "");
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function getMarketPhase(now = new Date()) {
  const parts = getIstDateParts(now);
  const openMinutes = parseTimeToMinutes(STRATEGY_CONFIG.marketOpenTimeIST);
  const closeMinutes = parseTimeToMinutes(STRATEGY_CONFIG.marketCloseTimeIST);
  const squareOffMinutes = parseTimeToMinutes(STRATEGY_CONFIG.squareOffTimeIST);
  const warmupStartMinutes = Math.max(0, openMinutes - Math.max(0, Number(STRATEGY_CONFIG.autoStartBeforeMarketMinutes) || 0));

  const isWeekend = parts.weekday === "Sat" || parts.weekday === "Sun";
  if (STRATEGY_CONFIG.weekdaysOnly && isWeekend) {
    return "closed";
  }

  if (parts.minutesOfDay < warmupStartMinutes) {
    return "pre-open";
  }
  if (parts.minutesOfDay < openMinutes) {
    return "warmup";
  }
  if (parts.minutesOfDay >= closeMinutes) {
    return "closed";
  }
  if (parts.minutesOfDay >= squareOffMinutes) {
    return "square-off";
  }
  return "open";
}

function resetDailyControlIfNeeded(now = new Date()) {
  const today = toDateStringInIST(now);
  if (state.dailyControl.date !== today) {
    state.dailyControl.date = today;
    state.dailyControl.cutoffHit = false;
    state.selectionOffset = 0;
    state.selectionWindowStart = null;
    state.selectionWindowTradeCount = state.trades.length;
    state.selectedSymbolsDate = null;
    state.symbols = [];
    state.historyBySymbol = new Map();
    state.historyLoadedDate = null;
    state.lastHistoryPersistAt = 0;
    state.lastLiveStatePersistAt = 0;
    state.adaptiveStrategyGeneratedDate = null;
    state.adaptiveStrategyInProgress = false;
    state.lastAdaptiveStrategyError = null;
  }
}

function isPostMarketOptimizationWindow(now = new Date()) {
  const parts = getIstDateParts(now);
  const closeMinutes = parseTimeToMinutes(STRATEGY_CONFIG.marketCloseTimeIST);
  return parts.minutesOfDay >= (closeMinutes + 60);
}

async function generateAdaptiveStrategyForDate(dateString) {
  if (state.adaptiveStrategyInProgress) {
    return;
  }

  if (state.adaptiveStrategyGeneratedDate === dateString) {
    return;
  }

  state.adaptiveStrategyInProgress = true;
  state.lastAdaptiveStrategyError = null;

  const originalActiveStrategyId = activeStrategyId;
  const originalConfig = { ...STRATEGY_CONFIG };

  try {
    const candidateStrategyIds = Array.from(new Set([
      "S1",
      "S2",
      "S3",
      originalActiveStrategyId,
    ].filter((id) => Boolean(STRATEGY_PRESETS[id]))));

    let best = null;

    for (const strategyId of candidateStrategyIds) {
      const preset = STRATEGY_PRESETS[strategyId];
      Object.assign(STRATEGY_CONFIG, preset.config);

      const result = await runHistoryTrialForDate(dateString);
      const totalPnl = Number(result?.summary?.totalPnl) || 0;
      const totalTrades = Number(result?.summary?.totalTrades) || 0;

      if (!best || totalPnl > best.totalPnl) {
        best = {
          strategyId,
          strategyName: preset.name,
          config: { ...preset.config },
          totalPnl,
          totalTrades,
        };
      }
    }

    if (best) {
      STRATEGY_PRESETS.S4 = {
        name: `Auto Optimized (${dateString}) from ${best.strategyId}`,
        config: { ...best.config },
      };

      applyStrategyPreset("S4");

      state.lastAdaptiveStrategy = {
        date: dateString,
        sourceStrategyId: best.strategyId,
        sourceStrategyName: best.strategyName,
        totalPnl: round2(best.totalPnl),
        totalTrades: best.totalTrades,
      };
    }

    state.adaptiveStrategyGeneratedDate = dateString;
  } catch (error) {
    Object.assign(STRATEGY_CONFIG, originalConfig);
    activeStrategyId = originalActiveStrategyId;
    state.lastAdaptiveStrategyError = error.message || String(error);
  } finally {
    state.adaptiveStrategyInProgress = false;
  }
}

function getDailyRealizedPnl(dateString) {
  return state.trades
    .filter((trade) => (trade.action === "SELL" || trade.action === "COVER") && normalizeDateToIST(trade.time) === dateString)
    .reduce((sum, trade) => sum + (trade.pnl || 0), 0);
}

function getUnrealizedPnlFromQuoteMap(quoteMap) {
  let total = 0;
  for (const position of state.openPositions.values()) {
    const quote = quoteMap.get(position.symbol);
    if (!quote) {
      continue;
    }

    total += position.side === "LONG"
      ? (quote.price - position.entryPrice) * position.remainingUnits
      : (position.entryPrice - quote.price) * position.remainingUnits;
  }
  return total;
}

function shouldTriggerDailyCutoff(dateString, quoteMap) {
  const dailyRealized = getDailyRealizedPnl(dateString);
  const unrealized = getUnrealizedPnlFromQuoteMap(quoteMap);
  const dailyNet = dailyRealized + unrealized;

  return dailyNet <= -getMaxDailyLossAmount();
}

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || "");
  if (!match) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("Invalid date value. Use valid YYYY-MM-DD");
  }

  return { year, month, day };
}

function getNseEpochRangeForDate(dateString) {
  const { year, month, day } = parseDateString(dateString);
  const startIso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T00:00:00+05:30`;
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return {
    period1: Math.floor(start.getTime() / 1000),
    period2: Math.floor(end.getTime() / 1000),
  };
}

function getPreviousMarketDateInIST(baseDate = new Date()) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() - 1);

  while (true) {
    const parts = getIstDateParts(date);
    if (parts.weekday !== "Sat" && parts.weekday !== "Sun") {
      return toDateStringInIST(date);
    }
    date.setDate(date.getDate() - 1);
  }
}

function hasContinuousUptrend(points, lookbackMinutes) {
  if (points.length < lookbackMinutes + 1) {
    return false;
  }

  const recent = points.slice(-1 * (lookbackMinutes + 1));
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].price <= recent[index - 1].price) {
      return false;
    }
  }
  return true;
}

function hasContinuousDowntrend(points, lookbackMinutes) {
  if (points.length < lookbackMinutes + 1) {
    return false;
  }

  const recent = points.slice(-1 * (lookbackMinutes + 1));
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].price >= recent[index - 1].price) {
      return false;
    }
  }
  return true;
}

function uniqueSymbols(symbols) {
  return Array.from(new Set(symbols.filter(Boolean)));
}

async function fetchScreenerSymbols(screenId, count = 100) {
  const url = `${YAHOO_SCREENER_BASE_URL}?formatted=true&scrIds=${encodeURIComponent(screenId)}&count=${count}&start=0`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Screener fetch failed for ${screenId}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const quotes = payload?.finance?.result?.[0]?.quotes || [];
  return quotes
    .map((item) => item?.symbol)
    .filter((symbol) => typeof symbol === "string" && /\.(NS|BO)$/.test(symbol));
}

async function getAutomaticMarketSymbols() {
  try {
    const settled = await Promise.allSettled([
      fetchScreenerSymbols("day_gainers", STRATEGY_CONFIG.marketScreenerCount),
      fetchScreenerSymbols("day_losers", STRATEGY_CONFIG.marketScreenerCount),
      fetchScreenerSymbols("most_actives", STRATEGY_CONFIG.marketScreenerCount),
    ]);

    const symbols = uniqueSymbols(
      settled
        .filter((item) => item.status === "fulfilled")
        .flatMap((item) => item.value)
    );

    if (symbols.length >= STRATEGY_CONFIG.topN) {
      state.marketUniverse = symbols;
      state.marketSource = "yahoo-screener";
      return symbols;
    }
  } catch (error) {
    state.lastError = error.message || String(error);
  }

  state.marketUniverse = [...CANDIDATE_SYMBOLS];
  state.marketSource = "fallback-static";
  return CANDIDATE_SYMBOLS;
}

async function fetchMinuteHistoryForDate(symbol, dateString) {
  const { period1, period2 } = getNseEpochRangeForDate(dateString);
  const url = `${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1m&includePrePost=false&events=history`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`History fetch failed for ${symbol} on ${dateString}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];

  const points = [];
  let lastTimestampMs = null;
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = closes[index];
    const timestamp = Number(timestamps[index]);
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0 || !Number.isFinite(timestamp)) {
      continue;
    }

    const timestampMs = timestamp * 1000;
    if (lastTimestampMs === timestampMs) {
      continue;
    }

    points.push({
      time: new Date(timestampMs),
      price: close,
    });

    lastTimestampMs = timestampMs;
  }

  return points;
}

async function fetchDailyHistoryForDate(symbol, dateString) {
  const { period1, period2 } = getNseEpochRangeForDate(dateString);
  const historyStart = period1 - (45 * 24 * 60 * 60);
  const url = `${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}?period1=${historyStart}&period2=${period2}&interval=1d&includePrePost=false&events=history`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Daily history fetch failed for ${symbol} on ${dateString}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};

  const candles = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    const volume = quote.volume?.[index];

    if ([open, high, low, close].some((value) => typeof value !== "number")) {
      continue;
    }

    candles.push({
      date: toDateStringInIST(new Date(timestamps[index] * 1000)),
      open,
      high,
      low,
      close,
      volume: typeof volume === "number" ? volume : 0,
    });
  }

  return candles;
}

function average(values) {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) {
    return 0;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function calculateEma(closes, period) {
  if (!Array.isArray(closes) || closes.length === 0 || period <= 1) {
    return null;
  }

  const valid = closes.filter((value) => Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }

  const multiplier = 2 / (period + 1);
  let ema = valid[0];
  for (let index = 1; index < valid.length; index += 1) {
    ema = (valid[index] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSupertrendDirection(closes, factor = 3, period = 10) {
  if (!Array.isArray(closes) || closes.length < period + 2) {
    return null;
  }

  const trs = [0];
  for (let index = 1; index < closes.length; index += 1) {
    trs.push(Math.abs(closes[index] - closes[index - 1]));
  }

  let atr = average(trs.slice(1, Math.min(period + 1, trs.length)));
  let finalUpper = closes[0] + (factor * atr);
  let finalLower = closes[0] - (factor * atr);
  let direction = 1;

  for (let index = 1; index < closes.length; index += 1) {
    const tr = trs[index];
    atr = ((atr * (period - 1)) + tr) / period;

    const middle = closes[index];
    const basicUpper = middle + (factor * atr);
    const basicLower = middle - (factor * atr);

    finalUpper = (basicUpper < finalUpper || closes[index - 1] > finalUpper) ? basicUpper : finalUpper;
    finalLower = (basicLower > finalLower || closes[index - 1] < finalLower) ? basicLower : finalLower;

    if (closes[index] > finalUpper) {
      direction = 1;
    } else if (closes[index] < finalLower) {
      direction = -1;
    }
  }

  return direction;
}

function getPutSignal(symbol) {
  const history = state.historyBySymbol.get(symbol) || [];
  const closes = history.map((point) => Number(point?.price)).filter((value) => Number.isFinite(value));
  if (closes.length < 60) {
    return { isBearish: false, rsi: null, emaFast: null, emaSlow: null, direction: null };
  }

  const rsiPeriod = Math.max(2, Number(STRATEGY_CONFIG.rsiPeriod) || 14);
  const emaFastPeriod = Math.max(2, Number(STRATEGY_CONFIG.emaFastPeriod) || 20);
  const emaSlowPeriod = Math.max(3, Number(STRATEGY_CONFIG.emaSlowPeriod) || 50);
  const supertrendFactor = Math.max(1, Number(STRATEGY_CONFIG.supertrendFactor) || 3);
  const supertrendPeriod = Math.max(2, Number(STRATEGY_CONFIG.supertrendPeriod) || 10);

  const rsi = calculateRsi(closes, rsiPeriod);
  const emaFast = calculateEma(closes, emaFastPeriod);
  const emaSlow = calculateEma(closes, emaSlowPeriod);
  const direction = calculateSupertrendDirection(closes, supertrendFactor, supertrendPeriod);
  const close = closes[closes.length - 1];

  const isBearish =
    direction === -1
    && Number.isFinite(rsi)
    && rsi < 50
    && Number.isFinite(emaFast)
    && Number.isFinite(emaSlow)
    && close < emaFast
    && emaFast < emaSlow;

  return { isBearish, rsi, emaFast, emaSlow, direction };
}

function getPutPremiumFromPosition(position, currentUnderlyingPrice) {
  const entryUnderlying = Number(position?.entryPrice);
  const basePremium = Number(position?.optionEntryPremium);
  const movePerPercent = Number(position?.premiumMovePerUnderlyingPercent) || 1;

  if (!Number.isFinite(entryUnderlying) || entryUnderlying <= 0 || !Number.isFinite(basePremium) || basePremium <= 0) {
    return null;
  }

  const underlyingMovePercent = ((entryUnderlying - Number(currentUnderlyingPrice)) / entryUnderlying) * 100;
  const currentPremium = basePremium + (underlyingMovePercent * movePerPercent);
  return Math.max(0.1, currentPremium);
}

function scorePremarketCandidate(symbol, candle, previousCandles) {
  const dayRange = Math.max(0.0001, candle.high - candle.low);
  const closeStrength = (candle.close - candle.low) / dayRange;
  const dayChangePercent = percentChange(candle.open, candle.close);
  const rangePercent = percentChange(candle.close, candle.high) - percentChange(candle.close, candle.low);
  const prevClose = previousCandles.length > 0 ? previousCandles[previousCandles.length - 1].close : candle.close;
  const trendUp = candle.close > prevClose ? 1 : 0;
  const trendDown = candle.close < prevClose ? 1 : 0;
  const volumeAvg = average(previousCandles.map((item) => item.volume));
  const volumeSpike = volumeAvg > 0 ? candle.volume / volumeAvg : 1;

  const longScore =
    (closeStrength * 40) +
    (Math.max(dayChangePercent, 0) * 8) +
    (Math.max(rangePercent, 0) * 2) +
    (Math.min(volumeSpike, 3) * 10) +
    (trendUp * 8);

  const shortScore =
    ((1 - closeStrength) * 40) +
    (Math.max(-dayChangePercent, 0) * 8) +
    (Math.max(rangePercent, 0) * 2) +
    (Math.min(volumeSpike, 3) * 10) +
    (trendDown * 8);

  return {
    symbol,
    close: round2(candle.close),
    dayChangePercent: round2(dayChangePercent),
    rangePercent: round2(Math.abs(rangePercent)),
    closeStrength: round2(closeStrength * 100),
    volumeSpike: round2(volumeSpike),
    longScore: round2(longScore),
    shortScore: round2(shortScore),
  };
}

function scorePremarketCandidateFromQuote(symbol, quote) {
  const previousClose =
    typeof quote.regularMarketPreviousClose === "number"
      ? quote.regularMarketPreviousClose
      : quote.previousClose;
  const open =
    typeof quote.regularMarketOpen === "number"
      ? quote.regularMarketOpen
      : previousClose;
  const high =
    typeof quote.regularMarketDayHigh === "number"
      ? quote.regularMarketDayHigh
      : quote.regularMarketPrice;
  const low =
    typeof quote.regularMarketDayLow === "number"
      ? quote.regularMarketDayLow
      : quote.regularMarketPrice;
  const close =
    typeof quote.regularMarketPrice === "number"
      ? quote.regularMarketPrice
      : typeof quote.postMarketPrice === "number"
        ? quote.postMarketPrice
        : quote.preMarketPrice;

  if (
    typeof open !== "number" ||
    typeof high !== "number" ||
    typeof low !== "number" ||
    typeof close !== "number"
  ) {
    return null;
  }

  const volume =
    typeof quote.regularMarketVolume === "number"
      ? quote.regularMarketVolume
      : typeof quote.averageDailyVolume3Month === "number"
        ? quote.averageDailyVolume3Month
        : 0;

  return scorePremarketCandidate(
    symbol,
    { open, high, low, close, volume },
    []
  );
}

async function runPremarketShortlist(dateString) {
  const shortlistDate = dateString || getPreviousMarketDateInIST();
  const symbols = await getAutomaticMarketSymbols();

  const settled = await Promise.allSettled(symbols.map(async (symbol) => {
    const candles = await fetchDailyHistoryForDate(symbol, shortlistDate);
    const targetIndex = candles.findIndex((item) => item.date === shortlistDate);
    if (targetIndex < 0) {
      return null;
    }

    const target = candles[targetIndex];
    const previousCandles = candles.slice(Math.max(0, targetIndex - 5), targetIndex);
    return scorePremarketCandidate(symbol, target, previousCandles);
  }));

  const scored = settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value);

  let scoredCandidates = scored;
  let source = state.marketSource;

  if (scoredCandidates.length === 0) {
    const quoteSettled = await Promise.allSettled(
      symbols.map((symbol) => yahooFinance.quote(symbol))
    );

    scoredCandidates = quoteSettled
      .filter((item) => item.status === "fulfilled" && item.value)
      .map((item) => scorePremarketCandidateFromQuote(item.value.symbol, item.value))
      .filter(Boolean);

    source = `${state.marketSource}-quote-fallback`;
  }

  const longCandidates = [...scoredCandidates]
    .sort((a, b) => b.longScore - a.longScore)
    .slice(0, 10);

  const shortCandidates = [...scoredCandidates]
    .sort((a, b) => b.shortScore - a.shortScore)
    .slice(0, 10);

  return {
    date: shortlistDate,
    source,
    universeSize: symbols.length,
    evaluated: scoredCandidates.length,
    longCandidates,
    shortCandidates,
  };
}

function simulateHistoryForSymbol(symbol, points, config = STRATEGY_CONFIG) {
  const trades = [];
  const history = [];
  let openPosition = null;
  const emittedTradeKeys = new Set();

  function pushUniqueTrade(trade) {
    if (!trade) {
      return;
    }

    const timeKey = trade.time ? new Date(trade.time).toISOString() : "";
    const key = [
      trade.action,
      trade.symbol,
      timeKey,
      Number(trade.price).toFixed(4),
      Number(trade.units) || 0,
    ].join("|");

    if (emittedTradeKeys.has(key)) {
      return;
    }

    emittedTradeKeys.add(key);
    trades.push(trade);
  }

  function logEntry(side, price, time) {
    const units = calculateUnits(price);
    if (units <= 0) {
      return;
    }

    openPosition = {
      symbol,
      side,
      entryPrice: price,
      units,
      remainingUnits: units,
      partialBooked: false,
      maxFavorablePercent: 0,
      entryTime: time,
    };

    const action = side === "LONG" ? "BUY" : "SELL_SHORT";
    const reason = side === "LONG"
      ? "Continuous uptrend for 10+ minutes"
      : "Continuous downtrend for 10+ minutes";

    pushUniqueTrade({
      action,
      symbol,
      price: round2(price),
      units,
      time,
      reason,
    });
  }

  function logExit(price, time, reason, unitsOverride) {
    const units = typeof unitsOverride === "number" && unitsOverride > 0
      ? Math.min(unitsOverride, openPosition ? openPosition.remainingUnits : 0)
      : openPosition
        ? openPosition.remainingUnits
        : 0;
    if (!openPosition || units <= 0) {
      return;
    }

    const isLong = openPosition.side === "LONG";
    const action = isLong ? "SELL" : "COVER";
    const pnl = isLong
      ? (price - openPosition.entryPrice) * units
      : (openPosition.entryPrice - price) * units;

    openPosition.remainingUnits -= units;
    pushUniqueTrade({
      action,
      symbol,
      price: round2(price),
      units,
      time,
      reason,
      pnl: round2(pnl),
    });

    if (openPosition.remainingUnits <= 0) {
      openPosition = null;
    }
  }

  for (const point of points) {
    history.push(point);

    if (!openPosition) {
      if (hasContinuousUptrend(history, config.buyContinuousRiseMinutes)) {
        logEntry("LONG", point.price, point.time);
      } else if (hasContinuousDowntrend(history, config.shortContinuousFallMinutes)) {
        logEntry("SHORT", point.price, point.time);
      }
    }

    if (!openPosition) {
      continue;
    }

    const movePercent = percentChange(openPosition.entryPrice, point.price);
    const isLong = openPosition.side === "LONG";
    const favorablePercent = isLong ? movePercent : -movePercent;
    openPosition.maxFavorablePercent = Math.max(openPosition.maxFavorablePercent || 0, favorablePercent);

    const elapsedMinutes = minutesBetween(openPosition.entryTime, point.time);
    const partialBookedAtStart = openPosition.partialBooked;

    if (!openPosition.partialBooked && config.timeExitMinutes > 0 && elapsedMinutes >= config.timeExitMinutes && favorablePercent < config.firstProfitTargetPercent) {
      logExit(point.price, point.time, `Time exit (${config.timeExitMinutes} min) before target`);
      continue;
    }

    if (!openPosition.partialBooked && favorablePercent <= -config.perStockStopLossPercent) {
      logExit(point.price, point.time, `Per-stock stop loss hit (${config.perStockStopLossPercent}%)`);
      continue;
    }

    if (!openPosition.partialBooked && favorablePercent >= config.firstProfitTargetPercent) {
      const unitsToExit = Math.max(1, Math.floor((openPosition.units * config.firstProfitExitPercent) / 100));
      logExit(point.price, point.time, `First target hit (${config.firstProfitTargetPercent}%), booked ${config.firstProfitExitPercent}%`, unitsToExit);
      if (openPosition) {
        openPosition.partialBooked = true;
      }
      continue;
    }

    if (openPosition && openPosition.partialBooked) {
      if (config.moveStopToEntryAfterFirstExit && favorablePercent <= 0) {
        logExit(point.price, point.time, "No-loss mode stop at entry after first booking");
        continue;
      }

      const trailingStopLevel = openPosition.maxFavorablePercent - config.trailingStopPercent;
      if (openPosition.maxFavorablePercent > 0 && favorablePercent <= trailingStopLevel) {
        logExit(point.price, point.time, `Trailing stop hit (${config.trailingStopPercent}%)`);
        continue;
      }

      if (partialBookedAtStart && favorablePercent >= config.remainderHardTargetPercent) {
        logExit(point.price, point.time, `Final target hit (${config.remainderHardTargetPercent}%)`);
        continue;
      }
    }
  }

  const realizedPnl = trades
    .filter((trade) => trade.action === "SELL" || trade.action === "COVER")
    .reduce((sum, trade) => sum + (trade.pnl || 0), 0);

  const lastPrice = points.length > 0 ? points[points.length - 1].price : null;
  const unrealizedPnl = openPosition && typeof lastPrice === "number"
    ? openPosition.side === "LONG"
      ? (lastPrice - openPosition.entryPrice) * openPosition.remainingUnits
      : (openPosition.entryPrice - lastPrice) * openPosition.remainingUnits
    : 0;

  return {
    symbol,
    points,
    trades,
    openPosition,
    realizedPnl: round2(realizedPnl),
    unrealizedPnl: round2(unrealizedPnl),
    totalPnl: round2(realizedPnl + unrealizedPnl),
  };
}

function buildTrialResult(date, candidates, strategyConfig = STRATEGY_CONFIG) {
  const simulations = candidates.map((candidate) =>
    simulateHistoryForSymbol(candidate.symbol, candidate.points, strategyConfig)
  );

  const allTrades = simulations
    .flatMap((simulation) => simulation.trades)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const totalRealizedPnl = simulations.reduce((sum, simulation) => sum + simulation.realizedPnl, 0);
  const totalUnrealizedPnl = simulations.reduce((sum, simulation) => sum + simulation.unrealizedPnl, 0);

  const selectedSymbols = candidates.map((candidate) => ({
    symbol: candidate.symbol,
    intradayChangePercent: round2(candidate.intradayChangePercent),
    candles: candidate.points.length,
  }));

  const perSymbol = simulations.map((simulation) => ({
    symbol: simulation.symbol,
    realizedPnl: simulation.realizedPnl,
    unrealizedPnl: simulation.unrealizedPnl,
    totalPnl: simulation.totalPnl,
    trades: simulation.trades,
    openPosition: simulation.openPosition
      ? {
          symbol: simulation.openPosition.symbol,
          side: simulation.openPosition.side,
          entryPrice: round2(simulation.openPosition.entryPrice),
          remainingUnits: simulation.openPosition.remainingUnits,
          entryTime: simulation.openPosition.entryTime,
        }
      : null,
    chart: {
      prices: simulation.points.map((point) => ({
        time: toMinuteLabel(point.time),
        price: round2(point.price),
      })),
      buyMarkers: simulation.trades
        .filter((trade) => trade.action === "BUY" || trade.action === "COVER")
        .map((trade) => ({ time: toMinuteLabel(trade.time), price: trade.price, units: trade.units })),
      sellMarkers: simulation.trades
        .filter((trade) => trade.action === "SELL" || trade.action === "SELL_SHORT")
        .map((trade) => ({ time: toMinuteLabel(trade.time), price: trade.price, units: trade.units })),
    },
  }));

  return {
    date,
    config: strategyConfig,
    selectedSymbols,
    summary: {
      symbolsTested: selectedSymbols.length,
      totalTrades: allTrades.length,
      totalRealizedPnl: round2(totalRealizedPnl),
      totalUnrealizedPnl: round2(totalUnrealizedPnl),
      totalPnl: round2(totalRealizedPnl + totalUnrealizedPnl),
    },
    trades: allTrades,
    perSymbol,
  };
}

async function runHistoryTrialForDate(dateString, marketSymbolsOverride) {
  return runHistoryTrialForDateWithConfig(dateString, marketSymbolsOverride, STRATEGY_CONFIG);
}

async function runHistoryTrialForDateWithConfig(dateString, marketSymbolsOverride, strategyConfig) {
  const targetDate = dateString || toDateStringInIST();
  const marketSymbols = Array.isArray(marketSymbolsOverride) && marketSymbolsOverride.length > 0
    ? uniqueSymbols(marketSymbolsOverride)
    : await getAutomaticMarketSymbols();

  const settled = await Promise.allSettled(
    marketSymbols.map(async (symbol) => {
      const points = await fetchMinuteHistoryForDate(symbol, targetDate);
      if (points.length < 2) {
        return null;
      }

      const first = points[0].price;
      const last = points[points.length - 1].price;

      return {
        symbol,
        points,
        intradayChangePercent: percentChange(first, last),
      };
    })
  );

  const candidates = settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value)
    .sort((a, b) => b.intradayChangePercent - a.intradayChangePercent);

  const selectionLimit = Number(strategyConfig?.selectionLimit) || 0;

  const limitedCandidates = selectionLimit > 0
    ? candidates.slice(0, selectionLimit)
    : candidates;

  return buildTrialResult(targetDate, limitedCandidates, strategyConfig);
}

async function runTodayHistoryTrial() {
  return runHistoryTrialForDate(toDateStringInIST());
}

async function runHistoryTrialForStrategy(strategyId, dateString, marketSymbolsOverride) {
  const preset = STRATEGY_PRESETS[strategyId];
  if (!preset) {
    throw new Error(`Unknown strategy id: ${strategyId}`);
  }

  const strategyConfig = {
    ...STRATEGY_CONFIG,
    ...preset.config,
    totalCapital: STRATEGY_CONFIG.totalCapital,
  };

  return runHistoryTrialForDateWithConfig(dateString, marketSymbolsOverride, strategyConfig);
}

async function getStrategyMonitorForDate(dateString) {
  const targetDate = dateString || toDateStringInIST();
  const isToday = targetDate === toDateStringInIST();
  const capital = Number(STRATEGY_CONFIG.totalCapital) || 10000;
  const strategyIds = Object.keys(STRATEGY_PRESETS);
  const sharedSymbols = await getAutomaticMarketSymbols();

  const rows = [];
  for (const strategyId of strategyIds) {
    if (isToday && strategyId === activeStrategyId) {
      const strategyTrades = state.trades.filter((trade) => {
        const tradeStrategyId = trade?.strategyId || activeStrategyId;
        return tradeStrategyId === strategyId && normalizeDateToIST(trade.time) === targetDate;
      });

      const strategyOpenPositions = Array.from(state.openPositions.values())
        .filter((position) => (position?.strategyId || activeStrategyId) === strategyId)
        .map((position) => ({
          symbol: position.symbol,
          side: position.side,
          entryPrice: round2(Number(position.entryPrice) || 0),
          remainingUnits: Number(position.remainingUnits) || 0,
          entryTime: position.entryTime,
          strategyId: position.strategyId || strategyId,
        }));

      const strategySymbols = Array.from(new Set([
        ...strategyTrades.map((trade) => trade?.symbol).filter(Boolean),
        ...strategyOpenPositions.map((position) => position?.symbol).filter(Boolean),
      ]));

      const quoteMap = await getQuotesBySymbols(strategySymbols);
      const livePriceBySymbol = Object.fromEntries(
        strategySymbols.map((symbol) => {
          const quotePrice = Number(quoteMap.get(symbol)?.price);
          if (Number.isFinite(quotePrice) && quotePrice > 0) {
            return [symbol, round2(quotePrice)];
          }

          const history = state.historyBySymbol.get(symbol) || [];
          const latest = history[history.length - 1];
          const historyPrice = Number(latest?.price);
          return [symbol, Number.isFinite(historyPrice) && historyPrice > 0 ? round2(historyPrice) : null];
        })
      );

      const chartBySymbol = Object.fromEntries(
        strategySymbols.map((symbol) => {
          const history = state.historyBySymbol.get(symbol) || [];
          const symbolTrades = strategyTrades.filter((trade) => trade?.symbol === symbol);

          return [symbol, {
            prices: history.map((point) => ({
              time: point?.time,
              price: round2(Number(point?.price) || 0),
            })).filter((point) => Number.isFinite(point.price) && point.price > 0),
            buyMarkers: symbolTrades
              .filter((trade) => trade.action === "BUY" || trade.action === "COVER")
              .map((trade) => ({
                time: trade.time,
                price: round2(Number(trade.price) || 0),
                units: Number(trade.units) || 0,
                strategyId: trade.strategyId || strategyId,
              })),
            sellMarkers: symbolTrades
              .filter((trade) => trade.action === "SELL" || trade.action === "SELL_SHORT")
              .map((trade) => ({
                time: trade.time,
                price: round2(Number(trade.price) || 0),
                units: Number(trade.units) || 0,
                strategyId: trade.strategyId || strategyId,
              })),
          }];
        })
      );

      const realizedPnl = strategyTrades
        .filter((trade) => trade.action === "SELL" || trade.action === "COVER")
        .reduce((sum, trade) => sum + (Number(trade?.pnl) || 0), 0);

      const unrealizedPnl = strategyOpenPositions.reduce((sum, position) => {
        const history = state.historyBySymbol.get(position.symbol) || [];
        const latest = history[history.length - 1];
        const currentPrice = Number(latest?.price);
        if (!Number.isFinite(currentPrice)) {
          return sum;
        }

        const sideMultiplier = position.side === "SHORT" ? -1 : 1;
        return sum + ((currentPrice - position.entryPrice) * position.remainingUnits * sideMultiplier);
      }, 0);

      const totalPnl = realizedPnl + unrealizedPnl;
      const pnlPercent = capital > 0 ? (totalPnl / capital) * 100 : 0;

      rows.push({
        strategyId,
        strategyName: STRATEGY_PRESETS[strategyId]?.name || strategyId,
        totalTrades: strategyTrades.length,
        realizedPnl: round2(realizedPnl),
        unrealizedPnl: round2(unrealizedPnl),
        totalPnl: round2(totalPnl),
        pnlPercent: round2(pnlPercent),
        openPositions: strategyOpenPositions,
        recentTrades: strategyTrades.slice(-60),
        livePriceBySymbol,
        chartBySymbol,
        dataSource: "live-engine",
      });

      continue;
    }

    const trial = await runHistoryTrialForStrategy(strategyId, targetDate, sharedSymbols);
    const totalPnl = Number(trial?.summary?.totalPnl) || 0;
    const pnlPercent = capital > 0 ? (totalPnl / capital) * 100 : 0;
    const openPositions = (trial?.perSymbol || [])
      .map((item) => item?.openPosition)
      .filter(Boolean);
    const strategySymbols = Array.from(new Set([
      ...(trial?.trades || []).map((trade) => trade?.symbol).filter(Boolean),
      ...openPositions.map((position) => position?.symbol).filter(Boolean),
    ]));

    const perSymbolMap = new Map((trial?.perSymbol || []).map((item) => [item?.symbol, item]));
    const livePriceBySymbol = Object.fromEntries(
      strategySymbols.map((symbol) => {
        const chartPrices = perSymbolMap.get(symbol)?.chart?.prices || [];
        const latest = chartPrices.length > 0 ? chartPrices[chartPrices.length - 1] : null;
        const price = Number(latest?.price);
        return [symbol, Number.isFinite(price) && price > 0 ? round2(price) : null];
      })
    );
    const chartBySymbol = Object.fromEntries(
      strategySymbols.map((symbol) => {
        const item = perSymbolMap.get(symbol);
        const chart = item?.chart || { prices: [], buyMarkers: [], sellMarkers: [] };
        return [symbol, chart];
      })
    );

    rows.push({
      strategyId,
      strategyName: STRATEGY_PRESETS[strategyId]?.name || strategyId,
      totalTrades: Number(trial?.summary?.totalTrades) || 0,
      realizedPnl: Number(trial?.summary?.totalRealizedPnl) || 0,
      unrealizedPnl: Number(trial?.summary?.totalUnrealizedPnl) || 0,
      totalPnl,
      pnlPercent: round2(pnlPercent),
      openPositions,
      recentTrades: (trial?.trades || []).slice(-60),
      livePriceBySymbol,
      chartBySymbol,
      dataSource: "simulation",
    });
  }

  rows.sort((left, right) => right.totalPnl - left.totalPnl);

  return {
    date: targetDate,
    capital,
    activeStrategyId,
    bestStrategyId: rows[0]?.strategyId || null,
    results: rows,
  };
}

async function getStrategyComparisonForDate(dateString) {
  const targetDate = dateString || toDateStringInIST();
  const capital = Number(STRATEGY_CONFIG.totalCapital) || 10000;
  const strategyIds = Object.keys(STRATEGY_PRESETS);
  const sharedSymbols = await getAutomaticMarketSymbols();

  const rows = [];
  for (const strategyId of strategyIds) {
    const trial = await runHistoryTrialForStrategy(strategyId, targetDate, sharedSymbols);
    const totalPnl = Number(trial?.summary?.totalPnl) || 0;
    const pnlPercent = capital > 0 ? (totalPnl / capital) * 100 : 0;

    rows.push({
      strategyId,
      strategyName: STRATEGY_PRESETS[strategyId]?.name || strategyId,
      totalTrades: Number(trial?.summary?.totalTrades) || 0,
      realizedPnl: Number(trial?.summary?.totalRealizedPnl) || 0,
      unrealizedPnl: Number(trial?.summary?.totalUnrealizedPnl) || 0,
      totalPnl,
      pnlPercent: round2(pnlPercent),
    });
  }

  rows.sort((left, right) => right.totalPnl - left.totalPnl);

  return {
    date: targetDate,
    capital,
    activeStrategyId,
    bestStrategyId: rows[0]?.strategyId || null,
    results: rows,
  };
}

async function getLatestAndPrevClose(symbol) {
  const url = `${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false&events=history`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Quote fetch failed for ${symbol}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const closesRaw = result?.indicators?.quote?.[0]?.close || [];
  const closes = closesRaw.filter((value) => typeof value === "number");

  const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
  const previousCloseFromSeries = closes.length > 1 ? closes[closes.length - 2] : null;

  const marketPrice =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : lastClose;

  const previousClose =
    typeof meta.regularMarketPreviousClose === "number"
      ? meta.regularMarketPreviousClose
      : typeof meta.previousClose === "number"
        ? meta.previousClose
        : typeof meta.chartPreviousClose === "number"
          ? meta.chartPreviousClose
          : previousCloseFromSeries;

  if (typeof marketPrice !== "number" || typeof previousClose !== "number") {
    return null;
  }

  return {
    symbol,
    price: marketPrice,
    prevClose: previousClose,
    changePercent: percentChange(previousClose, marketPrice),
    quoteTime: typeof meta.regularMarketTime === "number" ? new Date(meta.regularMarketTime * 1000) : new Date(),
  };
}

async function selectTopIntraday(symbols = CANDIDATE_SYMBOLS, topN = STRATEGY_CONFIG.topN, offset = 0) {
  const sourceSymbols = Array.isArray(symbols) && symbols.length > 0
    ? symbols
    : await getAutomaticMarketSymbols();
  const settled = await Promise.allSettled(sourceSymbols.map((symbol) => getLatestAndPrevClose(symbol)));

  const valid = settled
    .filter((item) => item.status === "fulfilled" && item.value)
    .map((item) => item.value)
    .filter((item) => calculateUnits(item.price) > 0)
    .sort((a, b) => b.changePercent - a.changePercent);

  if (STRATEGY_CONFIG.selectionLimit > 0) {
    return valid.slice(0, STRATEGY_CONFIG.selectionLimit);
  }

  if (valid.length === 0) {
    return [];
  }

  const maxSymbols = Math.min(topN, valid.length);
  const normalizedOffset = ((offset % valid.length) + valid.length) % valid.length;
  const selected = [];

  for (let index = 0; index < maxSymbols; index += 1) {
    selected.push(valid[(normalizedOffset + index) % valid.length]);
  }

  return selected;
}

async function getQuotesBySymbols(symbols) {
  const unique = uniqueSymbols(symbols);
  const settled = await Promise.allSettled(unique.map((symbol) => getLatestAndPrevClose(symbol)));

  const quoteMap = new Map();
  settled.forEach((item) => {
    if (item.status === "fulfilled" && item.value) {
      quoteMap.set(item.value.symbol, item.value);
    }
  });

  return quoteMap;
}

function appendPricePoint(symbol, price, time = new Date()) {
  if (!state.historyBySymbol.has(symbol)) {
    state.historyBySymbol.set(symbol, []);
  }

  const history = state.historyBySymbol.get(symbol);
  history.push({ time, price });

  if (history.length > 120) {
    history.shift();
  }
}

function isContinuousUptrend(symbol, lookbackMinutes) {
  const history = state.historyBySymbol.get(symbol) || [];
  if (history.length < lookbackMinutes + 1) {
    return false;
  }

  const points = history.slice(-1 * (lookbackMinutes + 1));
  let riseCount = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].price > points[i - 1].price) {
      riseCount += 1;
    }
  }

  const requiredRises = Math.ceil(lookbackMinutes * STRATEGY_CONFIG.trendStrengthThreshold);
  return riseCount >= requiredRises;
}

function isContinuousDowntrend(symbol, lookbackMinutes) {
  const history = state.historyBySymbol.get(symbol) || [];
  if (history.length < lookbackMinutes + 1) {
    return false;
  }

  const points = history.slice(-1 * (lookbackMinutes + 1));
  let fallCount = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].price < points[i - 1].price) {
      fallCount += 1;
    }
  }

  const requiredFalls = Math.ceil(lookbackMinutes * STRATEGY_CONFIG.trendStrengthThreshold);
  return fallCount >= requiredFalls;
}

function getIntervalCandles(symbol, intervalMinutes, now = new Date()) {
  const history = state.historyBySymbol.get(symbol) || [];
  const intervalMs = intervalMinutes * 60 * 1000;
  const nowMs = new Date(now).getTime();
  const currentBucketStart = Math.floor(nowMs / intervalMs) * intervalMs;

  const candles = [];
  for (const point of history) {
    const pointMs = new Date(point.time).getTime();
    const bucketStart = Math.floor(pointMs / intervalMs) * intervalMs;
    const last = candles[candles.length - 1];

    if (!last || last.startTime !== bucketStart) {
      candles.push({
        startTime: bucketStart,
        close: point.price,
      });
    } else {
      last.close = point.price;
    }
  }

  if (candles.length > 0 && candles[candles.length - 1].startTime === currentBucketStart) {
    candles.pop();
  }

  return candles;
}

function hasConsecutiveUpCandles(symbol, candleCount, intervalMinutes, now = new Date()) {
  const candles = getIntervalCandles(symbol, intervalMinutes, now);
  if (candles.length < candleCount) {
    return false;
  }

  const recent = candles.slice(-1 * candleCount);
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].close <= recent[index - 1].close) {
      return false;
    }
  }

  return true;
}

function isLatestCandleDown(symbol, intervalMinutes, now = new Date()) {
  const candles = getIntervalCandles(symbol, intervalMinutes, now);
  if (candles.length < 2) {
    return false;
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  return latest.close < previous.close;
}

function executeEntry(symbol, price, time, side, reasonOverride, metadata = {}) {
  if (state.openPositions.has(symbol)) {
    return;
  }

  const units = Number.isFinite(Number(metadata.unitsOverride)) && Number(metadata.unitsOverride) > 0
    ? Math.floor(Number(metadata.unitsOverride))
    : calculateUnits(price);
  if (units <= 0) {
    return;
  }

  state.openPositions.set(symbol, {
    symbol,
    strategyId: activeStrategyId,
    side,
    entryPrice: price,
    units,
    remainingUnits: units,
    partialBooked: false,
    maxFavorablePercent: 0,
    entryTime: time,
    instrumentType: metadata.instrumentType || "SPOT",
    optionEntryPremium: Number.isFinite(Number(metadata.optionEntryPremium)) ? Number(metadata.optionEntryPremium) : null,
    premiumMovePerUnderlyingPercent: Number.isFinite(Number(metadata.premiumMovePerUnderlyingPercent))
      ? Number(metadata.premiumMovePerUnderlyingPercent)
      : 1,
  });

  const action = side === "LONG" ? "BUY" : "SELL_SHORT";
  const reason = reasonOverride || (side === "LONG"
    ? "Continuous uptrend for 10+ minutes"
    : "Continuous downtrend for 10+ minutes");
  const tradePrice = Number.isFinite(Number(metadata.tradePrice)) ? Number(metadata.tradePrice) : price;

  state.trades.push({
    action,
    symbol,
    strategyId: activeStrategyId,
    price: round2(tradePrice),
    units,
    time,
    reason,
  });

  saveLiveStateToDisk().catch((error) => {
    state.lastError = error.message || String(error);
  });
}

function executeExit(position, price, time, reason, unitsOverride) {
  const units = typeof unitsOverride === "number" && unitsOverride > 0
    ? Math.min(unitsOverride, position ? position.remainingUnits : 0)
    : position
      ? position.remainingUnits
      : 0;
  if (units <= 0 || !position) {
    return;
  }

  const isLong = position.side === "LONG";
  position.remainingUnits -= units;
  const isPutInstrument = position.instrumentType === "PUT_OPTION";
  const currentPutPremium = isPutInstrument ? getPutPremiumFromPosition(position, price) : null;
  const exitPrice = isPutInstrument && Number.isFinite(currentPutPremium) ? currentPutPremium : price;
  const entryReferencePrice = isPutInstrument && Number.isFinite(position.optionEntryPremium)
    ? position.optionEntryPremium
    : position.entryPrice;

  const pnl = isLong
    ? (exitPrice - entryReferencePrice) * units
    : (entryReferencePrice - exitPrice) * units;

  state.trades.push({
    action: isLong ? "SELL" : "COVER",
    symbol: position.symbol,
    strategyId: position.strategyId || activeStrategyId,
    price: round2(exitPrice),
    units,
    time,
    reason,
    pnl: round2(pnl),
  });

  if (position.remainingUnits <= 0) {
    state.openPositions.delete(position.symbol);
  }

  saveLiveStateToDisk().catch((error) => {
    state.lastError = error.message || String(error);
  });
}

async function forceSellAllActiveTrades(reason = "Manual sell: user booked profit") {
  const now = new Date();
  const positions = Array.from(state.openPositions.values());

  if (positions.length === 0) {
    return {
      requestedCount: 0,
      soldCount: 0,
      skippedSymbols: [],
      time: now.toISOString(),
    };
  }

  const symbols = uniqueSymbols(positions.map((position) => position.symbol));
  const quoteMap = await getQuotesBySymbols(symbols);
  const skippedSymbols = [];

  for (const position of positions) {
    const quote = quoteMap.get(position.symbol);
    let exitPrice = Number(quote?.price);

    if (!Number.isFinite(exitPrice)) {
      const history = state.historyBySymbol.get(position.symbol) || [];
      const latest = history[history.length - 1];
      exitPrice = Number(latest?.price);
    }

    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      skippedSymbols.push(position.symbol);
      continue;
    }

    executeExit(position, exitPrice, now, reason);
  }

  return {
    requestedCount: positions.length,
    soldCount: positions.length - skippedSymbols.length,
    skippedSymbols,
    time: now.toISOString(),
  };
}

async function forceSellActiveTradeBySymbol(symbol, reason = "Manual sell: user booked profit") {
  const now = new Date();
  const targetSymbol = String(symbol || "").trim();

  if (!targetSymbol) {
    return {
      requestedSymbol: targetSymbol,
      sold: false,
      skipped: true,
      reason: "Symbol is required",
      time: now.toISOString(),
    };
  }

  const position = state.openPositions.get(targetSymbol);
  if (!position) {
    return {
      requestedSymbol: targetSymbol,
      sold: false,
      skipped: true,
      reason: "No active position",
      time: now.toISOString(),
    };
  }

  const quoteMap = await getQuotesBySymbols([targetSymbol]);
  const quote = quoteMap.get(targetSymbol);
  let exitPrice = Number(quote?.price);

  if (!Number.isFinite(exitPrice)) {
    const history = state.historyBySymbol.get(targetSymbol) || [];
    const latest = history[history.length - 1];
    exitPrice = Number(latest?.price);
  }

  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return {
      requestedSymbol: targetSymbol,
      sold: false,
      skipped: true,
      reason: "No valid exit price",
      time: now.toISOString(),
    };
  }

  executeExit(position, exitPrice, now, reason);

  return {
    requestedSymbol: targetSymbol,
    sold: true,
    skipped: false,
    reason,
    time: now.toISOString(),
  };
}

function evaluatePutPosition(position, currentPrice, time) {
  const targetPoints = Math.max(0.1, Number(STRATEGY_CONFIG.targetPoints) || 2);
  const stopLossPoints = Math.max(0.1, Number(STRATEGY_CONFIG.stopLossPoints) || 1);
  const entryPremium = Number(position.optionEntryPremium);
  const currentPremium = getPutPremiumFromPosition(position, currentPrice);

  if (!Number.isFinite(entryPremium) || !Number.isFinite(currentPremium)) {
    return;
  }

  const premiumPnl = currentPremium - entryPremium;

  if (premiumPnl >= targetPoints) {
    executeExit(position, currentPrice, time, `S4 PUT target hit (+₹${targetPoints.toFixed(2)})`);
    return;
  }

  if (premiumPnl <= (-1 * stopLossPoints)) {
    executeExit(position, currentPrice, time, `S4 PUT stop loss hit (-₹${stopLossPoints.toFixed(2)})`);
  }
}

function evaluateSell(position, currentPrice, time) {
  if (position.side === "LONG" && isLatestCandleDown(position.symbol, SIGNAL_CANDLE_MINUTES, time)) {
    executeExit(position, currentPrice, time, "First down 3-minute candle after entry");
    return;
  }

  const movePercent = percentChange(position.entryPrice, currentPrice);
  const isLong = position.side === "LONG";
  const favorablePercent = isLong ? movePercent : -movePercent;
  position.maxFavorablePercent = Math.max(position.maxFavorablePercent || 0, favorablePercent);

  const elapsedMinutes = minutesBetween(position.entryTime, time);
  const partialBookedAtStart = Boolean(position.partialBooked);

  if (!position.partialBooked && STRATEGY_CONFIG.timeExitMinutes > 0 && elapsedMinutes >= STRATEGY_CONFIG.timeExitMinutes && favorablePercent < STRATEGY_CONFIG.firstProfitTargetPercent) {
    executeExit(position, currentPrice, time, `Time exit (${STRATEGY_CONFIG.timeExitMinutes} min) before target`);
    return;
  }

  if (!position.partialBooked && favorablePercent <= -STRATEGY_CONFIG.perStockStopLossPercent) {
    executeExit(position, currentPrice, time, `Per-stock stop loss hit (${STRATEGY_CONFIG.perStockStopLossPercent}%)`);
    return;
  }

  if (!position.partialBooked && favorablePercent >= STRATEGY_CONFIG.firstProfitTargetPercent) {
    const unitsToExit = Math.max(1, Math.floor((position.units * STRATEGY_CONFIG.firstProfitExitPercent) / 100));
    executeExit(
      position,
      currentPrice,
      time,
      `First target hit (${STRATEGY_CONFIG.firstProfitTargetPercent}%), booked ${STRATEGY_CONFIG.firstProfitExitPercent}%`,
      unitsToExit
    );
    if (state.openPositions.has(position.symbol)) {
      position.partialBooked = true;
    }
    return;
  }

  if (!position.partialBooked) {
    return;
  }

  if (STRATEGY_CONFIG.moveStopToEntryAfterFirstExit && favorablePercent <= 0) {
    executeExit(position, currentPrice, time, "No-loss mode stop at entry after first booking");
    return;
  }

  const trailingStopLevel = position.maxFavorablePercent - STRATEGY_CONFIG.trailingStopPercent;
  if (position.maxFavorablePercent > 0 && favorablePercent <= trailingStopLevel) {
    executeExit(position, currentPrice, time, `Trailing stop hit (${STRATEGY_CONFIG.trailingStopPercent}%)`);
    return;
  }

  if (partialBookedAtStart && favorablePercent >= STRATEGY_CONFIG.remainderHardTargetPercent) {
    executeExit(position, currentPrice, time, `Final target hit (${STRATEGY_CONFIG.remainderHardTargetPercent}%)`);
    return;
  }
}

async function runCycle() {
  const now = new Date();
  try {
    resetDailyControlIfNeeded(now);
    const today = toDateStringInIST(now);
    await loadTodayPriceHistory(today);
    const phase = getMarketPhase(now);

    if (phase === "pre-open" || phase === "closed") {
      if (phase === "closed" && isPostMarketOptimizationWindow(now)) {
        await generateAdaptiveStrategyForDate(today);
      }

      state.lastRun = now;
      state.cycleCount += 1;
      state.lastError = null;
      await saveTodayPriceHistory(today);
      return true;
    }

    let shouldReselectSymbols = state.selectedSymbolsDate !== today || state.symbols.length === 0;

    if (!shouldReselectSymbols && (phase === "open" || phase === "warmup") && state.selectionWindowStart) {
      const windowElapsedMinutes = minutesBetween(state.selectionWindowStart, now);
      if (windowElapsedMinutes >= 60) {
        const tradesInWindow = state.trades.length - state.selectionWindowTradeCount;
        if (tradesInWindow <= 0) {
          state.selectionOffset += STRATEGY_CONFIG.topN;
          shouldReselectSymbols = true;
        }

        state.selectionWindowStart = now;
        state.selectionWindowTradeCount = state.trades.length;
      }
    }

    if (shouldReselectSymbols) {
      const marketSymbols = await getAutomaticMarketSymbols();
      const selected = await selectTopIntraday(marketSymbols, STRATEGY_CONFIG.topN, state.selectionOffset);
      state.symbols = selected.map((item) => item.symbol);
      state.selectedSymbolsDate = today;
      state.selectionWindowStart = now;
      state.selectionWindowTradeCount = state.trades.length;
    }

    const trackedSymbols = uniqueSymbols([
      ...state.symbols,
      ...Array.from(state.openPositions.keys()),
    ]);
    const quoteMap = await getQuotesBySymbols(trackedSymbols);

    if (shouldTriggerDailyCutoff(today, quoteMap)) {
      state.dailyControl.cutoffHit = true;
    }

    const isPutStrategy = activeStrategyId === "S4";

    state.symbols.forEach((symbol) => {
      const quote = quoteMap.get(symbol);
      if (!quote) {
        return;
      }

      appendPricePoint(symbol, quote.price, now);
      if (!state.dailyControl.cutoffHit && !state.openPositions.has(symbol) && phase === "open") {
        if (isPutStrategy) {
          const putSignal = getPutSignal(symbol);
          if (putSignal.isBearish) {
            const optionPremium = Math.max(0.1, Number(STRATEGY_CONFIG.optionPremium) || 5);
            const units = Math.max(1, Math.floor(capitalPerPosition() / optionPremium));

            executeEntry(
              symbol,
              quote.price,
              now,
              "LONG",
              "S4 PUT entry: Supertrend bearish + RSI<50 + EMA fast below slow",
              {
                instrumentType: "PUT_OPTION",
                optionEntryPremium: optionPremium,
                premiumMovePerUnderlyingPercent: Number(STRATEGY_CONFIG.premiumMovePerUnderlyingPercent) || 1,
                unitsOverride: units,
                tradePrice: optionPremium,
              }
            );
          }
        } else if (hasConsecutiveUpCandles(symbol, ENTRY_UP_CANDLE_COUNT, SIGNAL_CANDLE_MINUTES, now)) {
          executeEntry(symbol, quote.price, now, "LONG", "3-minute candles moved up more than 2 times");
        }
      }
    });

    for (const position of Array.from(state.openPositions.values())) {
      const quote = quoteMap.get(position.symbol);
      if (!quote) {
        continue;
      }

      if (state.dailyControl.cutoffHit) {
        executeExit(position, quote.price, now, `Max daily loss cutoff hit (${STRATEGY_CONFIG.maxDailyLossPercent}%), forced square-off`);
      } else if (phase === "square-off") {
        executeExit(position, quote.price, now, `Auto square-off before market close (${STRATEGY_CONFIG.squareOffTimeIST} IST)`);
      } else if (position.instrumentType === "PUT_OPTION") {
        evaluatePutPosition(position, quote.price, now);
      } else {
        evaluateSell(position, quote.price, now);
      }
    }

    if (!state.dailyControl.cutoffHit && phase === "open" && STRATEGY_CONFIG.allowRepeatEntryOnContinuousTrend && activeStrategyId !== "S4") {
      state.symbols.forEach((symbol) => {
        if (state.openPositions.has(symbol)) {
          return;
        }

        const quote = quoteMap.get(symbol);
        if (!quote) {
          return;
        }

        if (hasConsecutiveUpCandles(symbol, ENTRY_UP_CANDLE_COUNT, SIGNAL_CANDLE_MINUTES, now)) {
          executeEntry(symbol, quote.price, now, "LONG", "3-minute candles moved up more than 2 times");
        }
      });
    }

    state.lastRun = now;
    state.cycleCount += 1;
    state.lastError = null;
    await saveTodayPriceHistory(today);
    return true;
  } catch (error) {
    state.lastRun = now;
    state.lastError = error.message || String(error);
    return false;
  }
}

function getSnapshot() {
  function getChangePercentByMinutes(history, minutes) {
    if (!history || history.length < 2) {
      return 0;
    }

    const latest = history[history.length - 1];
    if (!latest || typeof latest.price !== "number") {
      return 0;
    }

    const latestTimeMs = new Date(latest.time).getTime();
    const targetTimeMs = latestTimeMs - (minutes * 60 * 1000);

    let basePoint = null;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const point = history[index];
      if (!point || typeof point.price !== "number") {
        continue;
      }

      const pointTimeMs = new Date(point.time).getTime();
      if (pointTimeMs <= targetTimeMs) {
        basePoint = point;
        break;
      }
    }

    if (!basePoint) {
      return 0;
    }

    return percentChange(basePoint.price, latest.price);
  }

  const selected = state.symbols.map((symbol) => {
    const history = state.historyBySymbol.get(symbol) || [];
    const latest = history[history.length - 1];
    const position = state.openPositions.get(symbol);

    return {
      symbol,
      currentPrice: latest ? round2(latest.price) : null,
      move1mPercent: round2(getChangePercentByMinutes(history, 1)),
      move6mPercent: round2(getChangePercentByMinutes(history, 6)),
      move3mPercent: round2(getChangePercentByMinutes(history, 3)),
      move10mPercent: round2(getChangePercentByMinutes(history, 10)),
      uptrend10m: isContinuousUptrend(symbol, STRATEGY_CONFIG.buyContinuousRiseMinutes),
      downtrend10m: isContinuousDowntrend(symbol, STRATEGY_CONFIG.shortContinuousFallMinutes),
      hasOpenPosition: Boolean(position),
      positionSide: position ? position.side : null,
      positionStrategyId: position ? position.strategyId || null : null,
      entryPrice: position ? round2(position.entryPrice) : null,
      remainingUnits: position ? position.remainingUnits : 0,
    };
  });

  const charts = {};
  for (const symbol of state.symbols) {
    const history = state.historyBySymbol.get(symbol) || [];
    const symbolTrades = state.trades.filter((trade) => trade.symbol === symbol);

    charts[symbol] = {
      prices: history.map((point) => ({
        time: point.time,
        price: round2(point.price),
      })),
      buyMarkers: symbolTrades
        .filter((trade) => trade.action === "BUY" || trade.action === "COVER")
        .map((trade) => ({
          time: trade.time,
          price: trade.price,
          units: trade.units,
          strategyId: trade.strategyId || null,
        })),
      sellMarkers: symbolTrades
        .filter((trade) => trade.action === "SELL" || trade.action === "SELL_SHORT")
        .map((trade) => ({
          time: trade.time,
          price: trade.price,
          units: trade.units,
          strategyId: trade.strategyId || null,
        })),
    };
  }

  const openPositions = Array.from(state.openPositions.values()).map((position) => ({
    symbol: position.symbol,
    strategyId: position.strategyId || null,
    entryPrice: round2(position.entryPrice),
    units: position.units,
    remainingUnits: position.remainingUnits,
    side: position.side,
    partialBooked: position.partialBooked,
    maxFavorablePercent: round2(position.maxFavorablePercent || 0),
    entryTime: position.entryTime,
  }));

  const realizedPnl = state.trades
    .filter((trade) => trade.action === "SELL" || trade.action === "COVER")
    .reduce((sum, trade) => sum + (trade.pnl || 0), 0);
  const tradedAmount = state.trades.reduce((sum, trade) => {
    const price = Number(trade?.price);
    const units = Number(trade?.units);
    if (!Number.isFinite(price) || !Number.isFinite(units)) {
      return sum;
    }
    return sum + Math.abs(price * units);
  }, 0);

  const unrealizedPnl = Array.from(state.openPositions.values()).reduce((sum, position) => {
    const history = state.historyBySymbol.get(position.symbol) || [];
    const latest = history[history.length - 1];
    const currentPrice = Number(latest?.price);

    if (!Number.isFinite(currentPrice)) {
      return sum;
    }

    const sideMultiplier = position.side === "SHORT" ? -1 : 1;
    return sum + ((currentPrice - position.entryPrice) * position.remainingUnits * sideMultiplier);
  }, 0);

  const currentDate = state.dailyControl.date || toDateStringInIST();

  const todayInvestedAmount = state.trades
    .filter((trade) => {
      const isEntryTrade = trade.action === "BUY" || trade.action === "SELL_SHORT";
      return isEntryTrade && normalizeDateToIST(trade.time) === currentDate;
    })
    .reduce((sum, trade) => {
      const price = Number(trade?.price);
      const units = Number(trade?.units);
      if (!Number.isFinite(price) || !Number.isFinite(units)) {
        return sum;
      }
      return sum + Math.abs(price * units);
    }, 0);

  const totalPnl = realizedPnl + unrealizedPnl;
  const openAccountAmount = STRATEGY_CONFIG.totalCapital + totalPnl;
  const dailyRealizedPnl = getDailyRealizedPnl(currentDate);
  const dailyCutoffAmount = getMaxDailyLossAmount();

  return {
    config: STRATEGY_CONFIG,
    status: {
      lastRun: state.lastRun,
      cycleCount: state.cycleCount,
      lastError: state.lastError,
      marketSource: state.marketSource,
      marketUniverseSize: state.marketUniverse.length,
      dailyDate: currentDate,
      dailyLossCutoffHit: state.dailyControl.cutoffHit,
      activeStrategyId,
      adaptiveStrategyGeneratedDate: state.adaptiveStrategyGeneratedDate,
      adaptiveStrategyInProgress: state.adaptiveStrategyInProgress,
      lastAdaptiveStrategy: state.lastAdaptiveStrategy,
      lastAdaptiveStrategyError: state.lastAdaptiveStrategyError,
    },
    selected,
    charts,
    openPositions,
    trades: state.trades.slice(-100).reverse(),
    summary: {
      totalTrades: state.trades.length,
      openPositions: state.openPositions.size,
      realizedPnl: round2(realizedPnl),
      unrealizedPnl: round2(unrealizedPnl),
      totalPnl: round2(totalPnl),
      tradedAmount: round2(tradedAmount),
      todayInvestedAmount: round2(todayInvestedAmount),
      openAccountAmount: round2(openAccountAmount),
      dailyRealizedPnl: round2(dailyRealizedPnl),
      dailyLossCutoffAmount: round2(dailyCutoffAmount),
    },
  };
}

async function startEngine(intervalMs = 60000, onCycleComplete) {
  await loadLiveStateFromDisk();

  const executeCycle = async (trigger) => {
    const success = await runCycle();
    if (typeof onCycleComplete === "function") {
      await onCycleComplete({
        trigger,
        success,
        snapshot: getSnapshot(),
      });
    }
  };

  await executeCycle("startup");
  setInterval(() => {
    executeCycle("interval").catch((error) => {
      state.lastError = error.message || String(error);
    });
  }, intervalMs);
}

module.exports = {
  STRATEGY_CONFIG,
  getStrategyPresets,
  getActiveStrategy,
  applyStrategyPreset,
  getStrategyComparisonForDate,
  getStrategyMonitorForDate,
  startEngine,
  runCycle,
  forceSellAllActiveTrades,
  forceSellActiveTradeBySymbol,
  getSnapshot,
  runHistoryTrialForDate,
  runTodayHistoryTrial,
  runPremarketShortlist,
};
