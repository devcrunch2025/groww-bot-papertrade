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

// STRATEGY_PRESETS must be defined here
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

// Per-strategy state and config (must be after STRATEGY_PRESETS)
const STRATEGY_CONFIG = {};
const STRATEGY_STATE = {};
for (const [strategyId, preset] of Object.entries(STRATEGY_PRESETS)) {
  STRATEGY_CONFIG[strategyId] = {
    ...preset.config,
    totalCapital: TOTAL_CAPITAL,
    maxDailyLossPercent: 1,
    topN: 5,
    selectionLimit: 0,
    marketScreenerCount: 250,
    autoStartBeforeMarketMinutes: 30,
    marketOpenTimeIST: "09:00",
    marketCloseTimeIST: "15:00",
    squareOffTimeIST: "14:50",
    weekdaysOnly: true,
  };
  STRATEGY_STATE[strategyId] = {
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
}


// Export the main objects for use in server.js and other modules
// Returns a snapshot of the current trading state for all strategies
function getSnapshot() {
  // Aggregate trades and open positions from all strategies
  let trades = [];
  let openPositions = [];
  let totalPnl = 0;
  let realizedPnl = 0;
  let unrealizedPnl = 0;
  let totalTrades = 0;
  for (const strategyId of Object.keys(STRATEGY_STATE)) {
    const state = STRATEGY_STATE[strategyId];
    if (!state) continue;
    if (Array.isArray(state.trades)) {
      trades = trades.concat(state.trades.map(t => ({ ...t, strategyId })));
      totalTrades += state.trades.length;
    }
    if (state.openPositions instanceof Map) {
      openPositions = openPositions.concat(Array.from(state.openPositions.values()).map(p => ({ ...p, strategyId })));
    }
    if (typeof state.realizedPnl === 'number') realizedPnl += state.realizedPnl;
    if (typeof state.unrealizedPnl === 'number') unrealizedPnl += state.unrealizedPnl;
  }
  totalPnl = realizedPnl + unrealizedPnl;
  return {
    summary: {
      totalTrades,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      openPositions: openPositions.length,
    },
    trades,
    openPositions,
    config: { totalCapital: TOTAL_CAPITAL },
    status: {},
  };
}


// Start all strategies in the background (dummy async for now)
async function startAllEngines(intervalMs = 10000, onCycle) {
  // For each strategy, simulate a background loop
  for (const strategyId of Object.keys(STRATEGY_PRESETS)) {
    setInterval(async () => {
      // Simulate a strategy cycle and call onCycle callback
      if (typeof onCycle === 'function') {
        const snapshot = getSnapshot();
        await onCycle({ snapshot, strategyId });
      }
    }, intervalMs);
  }
}

module.exports = {
  STRATEGY_PRESETS,
  STRATEGY_CONFIG,
  STRATEGY_STATE,
  CANDIDATE_SYMBOLS,
  TOTAL_CAPITAL,
  getSnapshot,
  startAllEngines,
};
