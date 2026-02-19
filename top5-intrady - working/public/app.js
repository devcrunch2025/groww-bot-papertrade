const REQUEST_TIMEOUT_MS = 20000;

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchState() {
  const response = await fetchJson(`/api/state?_ts=${Date.now()}`);
  return response;
}

async function fetchTrial(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetchJson(`/api/trial${query}`, 30000);
  return response;
}

async function fetchPremarketShortlist(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetchJson(`/api/premarket-shortlist${query}`, 15000);
  return response;
}

async function fetchStrategies() {
  const response = await fetchJson('/api/strategies', 15000);
  return response;
}

async function fetchStrategyMonitor(date) {
  const query = date
    ? `?date=${encodeURIComponent(date)}&_ts=${Date.now()}`
    : `?_ts=${Date.now()}`;
  const response = await fetchJson(`/api/strategy-monitor${query}`, 30000);
  return response;
}

async function sellTradeBySymbol(symbol, reason = 'Manual sell: user booked profit') {
  const response = await fetch('/api/sell-trade', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    body: JSON.stringify({ symbol, reason }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Sell trade failed: ${response.status}`);
  }

  return response.json();
}

const liveChartInstances = new Map();
const todayTradedChartInstances = new Map();
const strategyPresetById = new Map();
let dashboardViewStrategyId = '';
let latestLiveRealizedPnl = 0;
let latestTrialTotalPnl = 0;
let lastPremarketFetchAt = 0;
let refreshInProgress = false;
let refreshQueued = false;
let premarketFetchInProgress = false;
let nextAutoRefreshAt = Date.now() + 10000;

const PREMARKET_REFRESH_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 10000;
const CHART_LIBRARY_CDN_URLS = [
  'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js',
  'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js',
];

let chartLibraryLoadPromise = null;
const DASHBOARD_VIEW_STRATEGY_STORAGE_KEY = 'groww.dashboard.viewStrategyId';

function loadPersistedViewStrategyId() {
  try {
    const value = window.localStorage.getItem(DASHBOARD_VIEW_STRATEGY_STORAGE_KEY);
    return value ? String(value).trim() : '';
  } catch (error) {
    return '';
  }
}

function persistViewStrategyId(strategyId) {
  try {
    const value = String(strategyId || '').trim();
    if (!value) {
      window.localStorage.removeItem(DASHBOARD_VIEW_STRATEGY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(DASHBOARD_VIEW_STRATEGY_STORAGE_KEY, value);
  } catch (error) {
    // ignore storage failures
  }
}

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatChartTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getSelectedDashboardDate() {
  const dateInput = document.getElementById('trialDate');
  const selectedDate = dateInput?.value;
  return selectedDate || todayDateValue();
}

function isTodaySelectedDate() {
  return getSelectedDashboardDate() === todayDateValue();
}

function updateClockAndRefreshTimer() {
  const currentTime = document.getElementById('currentTime');
  const refreshTimer = document.getElementById('refreshTimer');

  if (currentTime) {
    currentTime.textContent = `Current time: ${new Date().toLocaleTimeString()}`;
  }

  if (!refreshTimer) {
    return;
  }

  if (refreshInProgress) {
    refreshTimer.textContent = 'Next refresh in: Refreshing...';
    return;
  }

  const remainingMs = nextAutoRefreshAt - Date.now();
  refreshTimer.textContent = `Next refresh in: ${formatCountdown(remainingMs)}`;
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (window.LightweightCharts && typeof window.LightweightCharts.createChart === 'function') {
        resolve(true);
        return;
      }

      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureChartLibraryLoaded() {
  if (window.LightweightCharts && typeof window.LightweightCharts.createChart === 'function') {
    return true;
  }

  if (chartLibraryLoadPromise) {
    return chartLibraryLoadPromise;
  }

  chartLibraryLoadPromise = (async () => {
    for (const src of CHART_LIBRARY_CDN_URLS) {
      try {
        await loadExternalScript(src);
        if (window.LightweightCharts && typeof window.LightweightCharts.createChart === 'function') {
          return true;
        }
      } catch (error) {
        continue;
      }
    }
    throw new Error('Chart library not loaded from available CDNs');
  })();

  try {
    await chartLibraryLoadPromise;
    return true;
  } finally {
    chartLibraryLoadPromise = null;
  }
}

function todayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toPercentText(value) {
  const numericValue = toNumber(value);
  const prefix = numericValue > 0 ? '+' : '';
  return `${prefix}${numericValue.toFixed(2)}%`;
}

function formatStrategyInfoText(strategyId, config) {
  if (!strategyId || !config) {
    return 'Strategy: -';
  }

  const repeatEntry = config.allowRepeatEntryOnContinuousTrend ? 'On' : 'Off';
  const timeExit = toNumber(config.timeExitMinutes) > 0 ? `${toNumber(config.timeExitMinutes)}m` : 'Off';

  return `${strategyId}: Trend ${toNumber(config.buyContinuousRiseMinutes)}m @ ${(toNumber(config.trendStrengthThreshold) * 100).toFixed(0)}% | SL ${toPercentText(-toNumber(config.perStockStopLossPercent))} | T1 ${toPercentText(toNumber(config.firstProfitTargetPercent))} (${toNumber(config.firstProfitExitPercent).toFixed(0)}%) | Trail ${toPercentText(toNumber(config.trailingStopPercent))} | Final ${toPercentText(toNumber(config.remainderHardTargetPercent))} | Repeat ${repeatEntry} | TimeExit ${timeExit}`;
}

function updateStrategyInfoLine(strategyId, configOverride) {
  const infoElement = document.getElementById('strategyInfoLine');
  if (!infoElement) {
    return;
  }

  const configFromPreset = strategyPresetById.get(strategyId)?.config;
  const config = configOverride || configFromPreset;
  const infoText = formatStrategyInfoText(strategyId, config);
  infoElement.textContent = infoText;

  const strategySelect = document.getElementById('strategySelect');
  if (strategySelect) {
    strategySelect.title = infoText;
  }
}

function setStrategyInfoVisibility(isVisible) {
  const infoElement = document.getElementById('strategyInfoLine');
  if (!infoElement) {
    return;
  }

  infoElement.style.display = isVisible ? 'inline' : 'none';
}

async function initStrategySelector() {
  const strategySelect = document.getElementById('strategySelect');
  const strategyStatus = document.getElementById('strategyStatus');
  if (!strategySelect) {
    return;
  }

  try {
    const strategyData = await fetchStrategies();
    const activeId = strategyData?.active?.id;
    const presets = strategyData?.presets || [];

    strategyPresetById.clear();
    presets.forEach((preset) => {
      strategyPresetById.set(preset.id, preset);
    });

    strategySelect.innerHTML = presets
      .map((preset) => {
        const infoText = formatStrategyInfoText(preset.id, preset.config).replace(/"/g, '&quot;');
        return `<option value="${preset.id}" title="${infoText}">${preset.id} - ${preset.name}</option>`;
      })
      .join('');

    const persistedViewStrategyId = loadPersistedViewStrategyId();
    const isPersistedAvailable = persistedViewStrategyId && strategyPresetById.has(persistedViewStrategyId);
    dashboardViewStrategyId = isPersistedAvailable
      ? persistedViewStrategyId
      : (activeId || presets?.[0]?.id || '');

    persistViewStrategyId(dashboardViewStrategyId);
    if (dashboardViewStrategyId) {
      strategySelect.value = dashboardViewStrategyId;
    }

    if (strategyStatus) {
      strategyStatus.textContent = activeId
        ? `Engine active: ${activeId} | Viewing: ${dashboardViewStrategyId || '-'}`
        : '';
    }

    if (dashboardViewStrategyId) {
      updateStrategyInfoLine(dashboardViewStrategyId, strategyPresetById.get(dashboardViewStrategyId)?.config);
    }
  } catch (error) {
    if (strategyStatus) {
      strategyStatus.textContent = `Strategy load failed: ${error.message}`;
    }
  }
}

function buildViewStateByStrategy(state, strategyId) {
  const selectedStrategyId = String(strategyId || '').trim();
  if (!selectedStrategyId) {
    return state;
  }

  const rawTrades = state?.trades || [];
  const rawOpenPositions = state?.openPositions || [];
  const selected = state?.selected || [];
  const charts = state?.charts || {};

  const trades = rawTrades.filter((trade) => {
    const tradeStrategyId = trade?.strategyId || state?.status?.activeStrategyId || '';
    return tradeStrategyId === selectedStrategyId;
  });

  const openPositions = rawOpenPositions.filter((position) => {
    const positionStrategyId = position?.strategyId || state?.status?.activeStrategyId || '';
    return positionStrategyId === selectedStrategyId;
  });

  const openPositionBySymbol = new Map(
    openPositions
      .filter((position) => position?.symbol)
      .map((position) => [position.symbol, position]),
  );

  const selectedRows = selected.map((row) => {
    const position = openPositionBySymbol.get(row.symbol);
    return {
      ...row,
      hasOpenPosition: Boolean(position),
      positionSide: position ? position.side : null,
      entryPrice: position ? position.entryPrice : null,
      remainingUnits: position ? position.remainingUnits : 0,
      positionStrategyId: position ? (position.strategyId || selectedStrategyId) : null,
    };
  });

  const filteredCharts = Object.fromEntries(
    Object.entries(charts).map(([symbol, chart]) => {
      const buyMarkers = (chart?.buyMarkers || []).filter((marker) => {
        const markerStrategyId = marker?.strategyId || state?.status?.activeStrategyId || '';
        return markerStrategyId === selectedStrategyId;
      });
      const sellMarkers = (chart?.sellMarkers || []).filter((marker) => {
        const markerStrategyId = marker?.strategyId || state?.status?.activeStrategyId || '';
        return markerStrategyId === selectedStrategyId;
      });

      return [symbol, {
        ...(chart || {}),
        buyMarkers,
        sellMarkers,
      }];
    }),
  );

  const realizedPnl = trades
    .filter((trade) => trade?.action === 'SELL' || trade?.action === 'COVER')
    .reduce((sum, trade) => sum + toNumber(trade?.pnl), 0);

  const tradedAmount = trades.reduce((sum, trade) => {
    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  const todayInvestedAmount = trades.reduce((sum, trade) => {
    const isEntryTrade = trade?.action === 'BUY' || trade?.action === 'SELL_SHORT';
    if (!isEntryTrade) {
      return sum;
    }
    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  const livePriceBySymbol = new Map(
    selectedRows
      .filter((row) => row && row.symbol)
      .map((row) => ({ symbol: row.symbol, currentPrice: Number(row.currentPrice) }))
      .filter((row) => Number.isFinite(row.currentPrice) && row.currentPrice > 0)
      .map((row) => [row.symbol, row.currentPrice]),
  );

  const unrealizedPnl = openPositions.reduce((sum, position) => {
    const currentPrice = livePriceBySymbol.get(position.symbol);
    if (!Number.isFinite(currentPrice)) {
      return sum;
    }

    const entryPrice = toNumber(position.entryPrice);
    const remainingUnits = toNumber(position.remainingUnits);
    const sideMultiplier = position.side === 'SHORT' ? -1 : 1;
    return sum + ((currentPrice - entryPrice) * remainingUnits * sideMultiplier);
  }, 0);

  const totalPnl = realizedPnl + unrealizedPnl;
  const totalCapital = toNumber(state?.config?.totalCapital);
  const openAccountAmount = totalCapital + totalPnl;

  return {
    ...state,
    selected: selectedRows,
    charts: filteredCharts,
    trades,
    openPositions,
    summary: {
      ...(state?.summary || {}),
      totalTrades: trades.length,
      openPositions: openPositions.length,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      tradedAmount,
      todayInvestedAmount,
      openAccountAmount,
    },
  };
}

function buildViewStateFromMonitorStrategy(baseState, monitorRow, strategyId) {
  const fallbackState = buildViewStateByStrategy(baseState, strategyId);
  if (!monitorRow) {
    return fallbackState;
  }

  const trades = Array.isArray(monitorRow?.recentTrades) ? monitorRow.recentTrades : [];
  const openPositions = Array.isArray(monitorRow?.openPositions) ? monitorRow.openPositions : [];
  const monitorCharts = monitorRow?.chartBySymbol || {};
  const monitorLivePriceBySymbol = monitorRow?.livePriceBySymbol || {};
  const fallbackSelectedRows = Array.isArray(fallbackState?.selected) ? fallbackState.selected : [];
  const fallbackCharts = fallbackState?.charts || {};
  const openPositionBySymbol = new Map(
    openPositions
      .filter((position) => position?.symbol)
      .map((position) => [position.symbol, position]),
  );

  const symbolsFromTrades = trades
    .map((trade) => trade?.symbol)
    .filter(Boolean);
  const symbolsFromOpen = openPositions
    .map((position) => position?.symbol)
    .filter(Boolean);
  const symbolsFromFallback = fallbackSelectedRows
    .map((row) => row?.symbol)
    .filter(Boolean);

  const strategySymbols = Array.from(new Set([
    ...symbolsFromFallback,
    ...symbolsFromTrades,
    ...symbolsFromOpen,
  ]));

  const fallbackSelectedBySymbol = new Map(
    fallbackSelectedRows
      .filter((row) => row?.symbol)
      .map((row) => [row.symbol, row]),
  );

  const selectedRows = strategySymbols.map((symbol) => {
    const baseRow = fallbackSelectedBySymbol.get(symbol) || {
      symbol,
      currentPrice: null,
      move1mPercent: 0,
      move3mPercent: 0,
      move6mPercent: 0,
      move10mPercent: 0,
      hasOpenPosition: false,
      positionSide: null,
      entryPrice: null,
      remainingUnits: 0,
      positionStrategyId: null,
    };

    const chartPrices = monitorCharts?.[symbol]?.prices || fallbackCharts?.[symbol]?.prices || [];
    const latestChartPoint = chartPrices.length > 0 ? chartPrices[chartPrices.length - 1] : null;
    const monitorLivePrice = Number(monitorLivePriceBySymbol?.[symbol]);
    const chartPrice = Number(latestChartPoint?.price);
    const baseCurrentPrice = Number(baseRow?.currentPrice);
    const currentPrice = Number.isFinite(monitorLivePrice) && monitorLivePrice > 0
      ? monitorLivePrice
      : Number.isFinite(baseCurrentPrice) && baseCurrentPrice > 0
        ? baseCurrentPrice
      : (Number.isFinite(chartPrice) && chartPrice > 0 ? chartPrice : null);

    const position = openPositionBySymbol.get(symbol);
    return {
      ...baseRow,
      currentPrice,
      hasOpenPosition: Boolean(position),
      positionSide: position ? position.side : null,
      entryPrice: position ? toNumber(position.entryPrice) : null,
      remainingUnits: position ? toNumber(position.remainingUnits) : 0,
      positionStrategyId: position ? (position.strategyId || strategyId) : null,
    };
  });

  const tradesBySymbol = trades.reduce((map, trade) => {
    if (!trade?.symbol) {
      return map;
    }
    if (!map.has(trade.symbol)) {
      map.set(trade.symbol, []);
    }
    map.get(trade.symbol).push(trade);
    return map;
  }, new Map());

  const charts = Object.fromEntries(
    strategySymbols.map((symbol) => {
      const baseChart = monitorCharts[symbol] || fallbackCharts[symbol] || { prices: [], buyMarkers: [], sellMarkers: [] };
      const symbolTrades = tradesBySymbol.get(symbol) || [];

      const buyMarkers = symbolTrades
        .filter((trade) => trade?.action === 'BUY' || trade?.action === 'COVER')
        .map((trade) => ({
          time: trade.time,
          price: toNumber(trade.price),
          units: toNumber(trade.units),
          strategyId: trade.strategyId || strategyId,
        }));

      const sellMarkers = symbolTrades
        .filter((trade) => trade?.action === 'SELL' || trade?.action === 'SELL_SHORT')
        .map((trade) => ({
          time: trade.time,
          price: toNumber(trade.price),
          units: toNumber(trade.units),
          strategyId: trade.strategyId || strategyId,
        }));

      return [symbol, {
        ...baseChart,
        buyMarkers,
        sellMarkers,
      }];
    }),
  );

  const tradedAmount = trades.reduce((sum, trade) => {
    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  const todayInvestedAmount = trades.reduce((sum, trade) => {
    const isEntryTrade = trade?.action === 'BUY' || trade?.action === 'SELL_SHORT';
    if (!isEntryTrade) {
      return sum;
    }

    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  return {
    ...fallbackState,
    selected: selectedRows,
    charts,
    trades,
    openPositions,
    status: {
      ...(fallbackState?.status || {}),
      monitorSource: monitorRow?.dataSource || 'simulation',
    },
    summary: {
      ...(fallbackState?.summary || {}),
      totalTrades: toNumber(monitorRow?.totalTrades ?? trades.length),
      openPositions: openPositions.length,
      realizedPnl: toNumber(monitorRow?.realizedPnl),
      unrealizedPnl: toNumber(monitorRow?.unrealizedPnl),
      totalPnl: toNumber(monitorRow?.totalPnl),
      tradedAmount,
      todayInvestedAmount,
    },
  };
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value) {
  return toNumber(value).toFixed(2);
}

function formatSignedAmount(value) {
  const numericValue = toNumber(value);
  const prefix = numericValue > 0 ? '+' : '';
  return `${prefix}${numericValue.toFixed(2)}`;
}

function updateBotThinkingTicker(state, mode = 'live') {
  const ticker = document.getElementById('botThinkingText');
  if (!ticker) {
    return;
  }

  const summary = state?.summary || {};
  const status = state?.status || {};
  const totalPnl = toNumber(summary.totalPnl);
  const totalCapital = toNumber(state?.config?.totalCapital) || 10000;
  const pnlPercent = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;

  const parts = [
    `Bot thinking (${mode}):`,
    `Strategy ${status.activeStrategyId || '-'}`,
    `Trades ${toNumber(summary.totalTrades)}`,
    `Open ${toNumber(summary.openPositions)}`,
    `P/L ${formatAmount(totalPnl)} (${toPercentText(pnlPercent)})`,
    status.lastError ? `Issue: ${status.lastError}` : 'System normal',
  ];

  if (status.adaptiveStrategyInProgress) {
    parts.push('Adaptive strategy generation in progress');
  }
  if (status.lastAdaptiveStrategy?.sourceStrategyId) {
    parts.push(`S4 built from ${status.lastAdaptiveStrategy.sourceStrategyId}`);
  }
  if (status.lastAdaptiveStrategyError) {
    parts.push(`Adaptive error: ${status.lastAdaptiveStrategyError}`);
  }

  ticker.textContent = parts.join('  •  ');
}

function valueClass(value) {
  if (value > 0) return 'pos';
  if (value < 0) return 'neg';
  return 'neu';
}

function applyValueClass(elementId, value) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.classList.remove('pos', 'neg', 'neu');
  element.classList.add(valueClass(value));
}

function applyAutoTheme() {
  const combinedPnl = latestLiveRealizedPnl + latestTrialTotalPnl;
  const accent = combinedPnl > 0 ? '#16a34a' : combinedPnl < 0 ? '#dc2626' : '#2563eb';
  document.documentElement.style.setProperty('--accent-color', accent);
}

function renderSelected(rows) {
  const body = document.getElementById('selectedTable');
  body.innerHTML = rows
    .map((row) => {
      const move1m = toNumber(row.move1mPercent);
      const move3m = toNumber(row.move3mPercent);
      const move6m = toNumber(row.move6mPercent);
      const move10m = toNumber(row.move10mPercent);

      return `
      <tr>
        <td>${row.symbol}</td>
        <td class="money-col">${row.currentPrice ?? '-'}</td>
        <td class="${valueClass(move1m)}">${move1m}%</td>
        <td class="${valueClass(move3m)}">${move3m}%</td>
        <td class="${valueClass(move6m)}">${move6m}%</td>
        <td class="${valueClass(move10m)}">${move10m}%</td>
        <td>${row.hasOpenPosition ? `${row.positionSide} ${row.remainingUnits} @ ${row.entryPrice}` : '-'}</td>
      </tr>
    `;
    })
    .join('');
}

function renderTrades(trades, selectedRows = []) {
  const body = document.getElementById('tradesTable');
  body.innerHTML = trades
    .map((trade) => {
      const investedAmount = Math.abs(toNumber(trade?.price) * toNumber(trade?.units));

      return `
      <tr>
        <td>${formatTime(trade.time)}</td>
        <td class="${trade.action === 'BUY' || trade.action === 'COVER' ? 'buy' : 'sell'}">${trade.action}</td>
        <td>${trade.strategyId || '-'}</td>
        <td>${trade.symbol}</td>
        <td class="money-col">${trade.price}</td>
        <td class="money-col">${trade.units}</td>
        <td class="money-col">${formatAmount(investedAmount)}</td>
        <td>${trade.reason}</td>
        <td class="money-col ${valueClass(toNumber(trade?.pnl))}">${trade?.pnl !== null && trade?.pnl !== undefined ? formatSignedAmount(trade.pnl) : '-'}</td>
      </tr>
    `;
    })
    .join('');
}

function renderActiveTrades(openPositions = [], selectedRows = []) {
  const livePriceBySymbol = new Map(
    (selectedRows || [])
      .filter((item) => item && item.symbol)
      .map((item) => ({ symbol: item.symbol, currentPrice: Number(item.currentPrice) }))
      .filter((item) => Number.isFinite(item.currentPrice) && item.currentPrice > 0)
      .map((item) => [item.symbol, item.currentPrice]),
  );

  const body = document.getElementById('activeTradesTable');
  if (!body) {
    return;
  }

  if (!openPositions || openPositions.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="10" class="muted">No active trades.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = openPositions
    .map((position) => {
      const symbol = position?.symbol;
      const side = String(position?.side || 'LONG');
      const entryPrice = toNumber(position?.entryPrice);
      const livePrice = livePriceBySymbol.get(symbol);
      const units = toNumber(position?.remainingUnits ?? position?.units);
      const isShort = side === 'SHORT';
      const hasValidLivePrice = Number.isFinite(livePrice) && livePrice > 0;

      const pnlPerUnit = hasValidLivePrice
        ? (isShort ? entryPrice - livePrice : livePrice - entryPrice)
        : 0;
      const totalPnl = pnlPerUnit * units;

      return `
      <tr>
        <td>${symbol || '-'}</td>
        <td>${position?.strategyId || '-'}</td>
        <td>${side}</td>
        <td class="money-col">${formatAmount(entryPrice)}</td>
        <td class="money-col ${hasValidLivePrice ? valueClass(pnlPerUnit) : 'neu'}">${hasValidLivePrice ? formatAmount(livePrice) : '-'}</td>
        <td class="money-col">${formatAmount(units)}</td>
        <td class="money-col ${valueClass(pnlPerUnit)}">${hasValidLivePrice ? formatSignedAmount(pnlPerUnit) : '-'}</td>
        <td class="money-col ${valueClass(totalPnl)}">${hasValidLivePrice ? formatSignedAmount(totalPnl) : '-'}</td>
        <td>${formatTime(position?.entryTime)}</td>
        <td><button class="sell-trade-btn" data-symbol="${symbol || ''}">Sell</button></td>
      </tr>
    `;
    })
    .join('');
}

function renderSummary(state) {
  const summary = state?.summary || {};
  const selected = state?.selected || [];
  const openPositions = state?.openPositions || [];

  const livePriceBySymbol = new Map(
    selected
      .filter((item) => item && item.symbol)
      .map((item) => [item.symbol, toNumber(item.currentPrice)]),
  );

  const fallbackUnrealizedPnl = openPositions.reduce((sum, position) => {
    const currentPrice = livePriceBySymbol.get(position.symbol);
    if (!Number.isFinite(currentPrice)) {
      return sum;
    }

    const entryPrice = toNumber(position.entryPrice);
    const remainingUnits = toNumber(position.remainingUnits);
    const sideMultiplier = position.side === 'SHORT' ? -1 : 1;
    return sum + ((currentPrice - entryPrice) * remainingUnits * sideMultiplier);
  }, 0);

  const fallbackTradedAmount = (state?.trades || []).reduce((sum, trade) => {
    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  const realizedPnl = toNumber(summary.realizedPnl);
  const unrealizedPnl = summary.unrealizedPnl !== undefined
    ? toNumber(summary.unrealizedPnl)
    : fallbackUnrealizedPnl;
  const totalPnl = summary.totalPnl !== undefined
    ? toNumber(summary.totalPnl)
    : realizedPnl + unrealizedPnl;
  const totalCapital = toNumber(state?.config?.totalCapital);
  const realizedPnlPercent = totalCapital > 0 ? (realizedPnl / totalCapital) * 100 : 0;
  const totalPnlPercent = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;
  const tradedAmount = summary.tradedAmount !== undefined
    ? toNumber(summary.tradedAmount)
    : fallbackTradedAmount;
  const fallbackTodayInvestedAmount = (state?.trades || []).reduce((sum, trade) => {
    const isEntryTrade = trade?.action === 'BUY' || trade?.action === 'SELL_SHORT';
    if (!isEntryTrade) {
      return sum;
    }

    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);
  const todayInvestedAmount = summary.todayInvestedAmount !== undefined
    ? toNumber(summary.todayInvestedAmount)
    : fallbackTodayInvestedAmount;

  document.getElementById('totalTrades').textContent = summary.totalTrades;
  document.getElementById('openPositions').textContent = summary.openPositions;
  document.getElementById('realizedPnl').textContent = `${formatAmount(realizedPnl)} (${toPercentText(realizedPnlPercent)})`;
  document.getElementById('tradedAmount').textContent = formatAmount(tradedAmount);
  document.getElementById('totalPnl').textContent = `${formatAmount(totalPnl)} (${toPercentText(totalPnlPercent)})`;
  document.getElementById('todayInvestedAmount').textContent = formatAmount(todayInvestedAmount);

  latestLiveRealizedPnl = realizedPnl;
  applyValueClass('realizedPnl', latestLiveRealizedPnl);
  applyValueClass('totalPnl', totalPnl);
  applyValueClass('todayInvestedAmount', totalPnl);
  applyAutoTheme();
}

function destroyCharts(chartMap) {
  for (const entry of chartMap.values()) {
    if (entry?.chart && typeof entry.chart.remove === 'function') {
      entry.chart.remove();
    }
  }
  chartMap.clear();
}

function buildOneMinuteCandles(pricePoints, livePrice, snapshotTime) {
  const bucketMap = new Map();

  pricePoints.forEach((point) => {
    const timestampMs = new Date(point.time).getTime();
    const price = toNumber(point.price);
    if (!Number.isFinite(timestampMs) || price <= 0) {
      return;
    }

    const bucketSec = Math.floor(timestampMs / 60000) * 60;
    const existing = bucketMap.get(bucketSec);
    if (!existing) {
      bucketMap.set(bucketSec, {
        time: bucketSec,
        open: price,
        high: price,
        low: price,
        close: price,
      });
      return;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
  });

  const candles = Array.from(bucketMap.values()).sort((a, b) => a.time - b.time);

  if (candles.length === 0 && livePrice > 0) {
    const nowMs = snapshotTime ? new Date(snapshotTime).getTime() : Date.now();
    const latestBucket = Math.floor(nowMs / 60000) * 60;
    return [
      { time: latestBucket - 60, open: livePrice, high: livePrice, low: livePrice, close: livePrice },
      { time: latestBucket, open: livePrice, high: livePrice, low: livePrice, close: livePrice },
    ];
  }

  if (candles.length === 1) {
    const only = candles[0];
    candles.unshift({
      time: only.time - 60,
      open: only.open,
      high: only.high,
      low: only.low,
      close: only.close,
    });
  }

  return candles;
}

function formatLocalChartTime(timeValue) {
  if (typeof timeValue === 'number') {
    return new Date(timeValue * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (timeValue && typeof timeValue === 'object' && 'year' in timeValue) {
    const date = new Date(timeValue.year, timeValue.month - 1, timeValue.day);
    return date.toLocaleDateString();
  }

  return '';
}

function addCandlestickSeriesCompat(chart) {
  const options = {
    upColor: '#16a34a',
    downColor: '#dc2626',
    borderVisible: false,
    wickUpColor: '#16a34a',
    wickDownColor: '#dc2626',
  };

  if (typeof chart.addCandlestickSeries === 'function') {
    return chart.addCandlestickSeries(options);
  }

  if (
    typeof chart.addSeries === 'function'
    && window.LightweightCharts
    && window.LightweightCharts.CandlestickSeries
  ) {
    return chart.addSeries(window.LightweightCharts.CandlestickSeries, options);
  }

  throw new Error('Candlestick series API not available');
}

function addLineSeriesCompat(chart) {
  const options = {
    color: '#2563eb',
    lineWidth: 2,
    crosshairMarkerVisible: false,
    lastValueVisible: true,
    priceLineVisible: true,
  };

  if (typeof chart.addLineSeries === 'function') {
    return chart.addLineSeries(options);
  }

  if (
    typeof chart.addSeries === 'function'
    && window.LightweightCharts
    && window.LightweightCharts.LineSeries
  ) {
    return chart.addSeries(window.LightweightCharts.LineSeries, options);
  }

  throw new Error('Line series API not available');
}

function renderSymbolCharts(containerId, chartMap, rows, chartResolver, snapshotTime) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  if (!window.LightweightCharts || !window.LightweightCharts.createChart) {
    container.innerHTML = '<div class="muted">Chart library not loaded.</div>';
    return;
  }

  container.innerHTML = '';
  destroyCharts(chartMap);

  const orderedRows = [...(rows || [])].sort((left, right) => {
    const leftCount = toNumber(left?.tradeCount);
    const rightCount = toNumber(right?.tradeCount);
    if (rightCount !== leftCount) {
      return rightCount - leftCount;
    }
    return String(left?.symbol || '').localeCompare(String(right?.symbol || ''));
  });

  if (orderedRows.length === 0) {
    container.innerHTML = '<div class="muted">No selected symbols for chart.</div>';
    return;
  }

  orderedRows.forEach((row) => {
    try {
    const chartData = chartResolver(row) || { prices: [], buyMarkers: [], sellMarkers: [] };
    const symbol = row.symbol;
    const pricePoints = [...(chartData.prices || [])];
    const livePrice = toNumber(row.currentPrice);

    if (livePrice > 0) {
      const lastPoint = pricePoints.length > 0 ? pricePoints[pricePoints.length - 1] : null;
      const lastPrice = lastPoint ? toNumber(lastPoint.price) : 0;
      const pointTime = snapshotTime || new Date().toISOString();

      if (!lastPoint) {
        pricePoints.push({ time: pointTime, price: livePrice });
      } else if (Math.abs(lastPrice - livePrice) > 0.000001) {
        pricePoints.push({ time: pointTime, price: livePrice });
      }
    }

    if (pricePoints.length === 1) {
      const firstPoint = pricePoints[0];
      const fallbackTime = new Date(new Date(firstPoint.time).getTime() - 60 * 1000).toISOString();
      pricePoints.unshift({ time: fallbackTime, price: toNumber(firstPoint.price) });
    }

    const firstPrice = pricePoints.length > 0 ? toNumber(pricePoints[0].price) : 0;
    const latestChartPrice = pricePoints.length > 0 ? toNumber(pricePoints[pricePoints.length - 1].price) : 0;
    const displayPrice = livePrice > 0 ? livePrice : latestChartPrice;
    const changePercent = firstPrice > 0 ? ((displayPrice - firstPrice) / firstPrice) * 100 : 0;
    const changePrefix = changePercent > 0 ? '+' : '';

    const chartBox = document.createElement('div');
    chartBox.className = 'chart-box';

    const header = document.createElement('div');
    header.className = 'chart-header';

    const title = document.createElement('h3');
    title.className = 'chart-title';
    title.classList.add(valueClass(changePercent));
    title.textContent = `${symbol} | ${displayPrice.toFixed(2)} (${changePrefix}${changePercent.toFixed(2)}%)`;
    header.appendChild(title);

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.innerHTML = `
      <span class="chart-legend-item"><span class="chart-legend-color" style="background:#7c3aed;"></span>Move</span>
      <span class="chart-legend-item"><span class="chart-legend-color" style="background:#16a34a;"></span>Buy</span>
      <span class="chart-legend-item"><span class="chart-legend-color" style="background:#dc2626;"></span>Sell</span>
      <span class="chart-legend-item"><span class="chart-legend-color" style="background:#2563eb;"></span>Price</span>
    `;
    header.appendChild(legend);
    chartBox.appendChild(header);

    const widget = document.createElement('div');
    widget.className = 'candle-widget';
    chartBox.appendChild(widget);
    container.appendChild(chartBox);

    const chart = window.LightweightCharts.createChart(widget, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#334155',
        fontSize: 6.6,
      },
      localization: {
        locale: (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-IN',
        timeFormatter: (time) => formatLocalChartTime(time),
      },
      rightPriceScale: {
        borderColor: '#e5e7eb',
      },
      timeScale: {
        borderColor: '#e5e7eb',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time) => formatLocalChartTime(time),
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      width: widget.clientWidth || 500,
      height: 150,
    });

    const candleSeries = addCandlestickSeriesCompat(chart);

    const candleData = buildOneMinuteCandles(pricePoints, livePrice, snapshotTime);
    candleSeries.setData(candleData);

    const markers = [
      ...(chartData.buyMarkers || []).map((point) => ({
        time: Math.floor(new Date(point.time).getTime() / 1000),
        position: 'belowBar',
        color: '#16a34a',
        shape: 'arrowUp',
        text: 'BUY',
      })),
      ...(chartData.sellMarkers || []).map((point) => ({
        time: Math.floor(new Date(point.time).getTime() / 1000),
        position: 'aboveBar',
        color: '#dc2626',
        shape: 'arrowDown',
        text: 'SELL',
      })),
    ].sort((a, b) => a.time - b.time);
    if (typeof candleSeries.setMarkers === 'function') {
      candleSeries.setMarkers(markers);
    } else if (window.LightweightCharts.createSeriesMarkers) {
      window.LightweightCharts.createSeriesMarkers(candleSeries, markers);
    }

    chart.timeScale().fitContent();
    chartMap.set(symbol, { chart, series: candleSeries });
    } catch (error) {
      const errorRow = document.createElement('div');
      errorRow.className = 'muted';
      errorRow.textContent = `${row.symbol}: chart render failed (${error.message})`;
      container.appendChild(errorRow);
    }
  });
}

function renderLiveCharts(selected, chartsBySymbol, snapshotTime, trades = []) {
  const tradeCountBySymbol = (trades || []).reduce((map, trade) => {
    if (!trade?.symbol) {
      return map;
    }
    map.set(trade.symbol, (map.get(trade.symbol) || 0) + 1);
    return map;
  }, new Map());

  const sortedRows = [...(selected || [])].sort((left, right) => {
    const leftCount = tradeCountBySymbol.get(left.symbol) || 0;
    const rightCount = tradeCountBySymbol.get(right.symbol) || 0;
    if (rightCount !== leftCount) {
      return rightCount - leftCount;
    }
    return String(left.symbol).localeCompare(String(right.symbol));
  }).map((row) => ({
    ...row,
    tradeCount: tradeCountBySymbol.get(row.symbol) || 0,
  }));

  renderSymbolCharts('chartsContainer', liveChartInstances, sortedRows, (row) => chartsBySymbol[row.symbol], snapshotTime);
}

function renderTodayTradedCharts(trial) {
  const perSymbol = trial?.perSymbol || [];
  const tradedSymbols = perSymbol.filter((item) => (item?.trades || []).length > 0);
  const symbolsForCharts = (tradedSymbols.length > 0 ? tradedSymbols : perSymbol.slice(0, 5))
    .sort((left, right) => {
      const leftCount = (left?.trades || []).length;
      const rightCount = (right?.trades || []).length;
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }
      return String(left?.symbol || '').localeCompare(String(right?.symbol || ''));
    });

  const rows = symbolsForCharts.map((item) => {
    const prices = item?.chart?.prices || [];
    const latestPoint = prices.length > 0 ? prices[prices.length - 1] : null;

    return {
      symbol: item.symbol,
      currentPrice: latestPoint ? toNumber(latestPoint.price) : 0,
      tradeCount: (item?.trades || []).length,
    };
  });

  const latestChartTimeMs = symbolsForCharts
    .flatMap((item) => item?.chart?.prices || [])
    .map((point) => new Date(point.time).getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((maxValue, current) => Math.max(maxValue, current), 0);

  const snapshotTime = latestChartTimeMs > 0 ? new Date(latestChartTimeMs).toISOString() : null;

  renderSymbolCharts(
    'todayTradedChartsContainer',
    todayTradedChartInstances,
    rows,
    (row) => symbolsForCharts.find((item) => item.symbol === row.symbol)?.chart,
    snapshotTime,
  );
}

function getMovePercentByMinutesFromPrices(prices, minutes) {
  if (!prices || prices.length < 2) {
    return 0;
  }

  const latest = prices[prices.length - 1];
  const latestTimeMs = new Date(latest.time).getTime();
  const targetMs = latestTimeMs - (minutes * 60 * 1000);

  let basePoint = null;
  for (let index = prices.length - 1; index >= 0; index -= 1) {
    const point = prices[index];
    if (!point) {
      continue;
    }

    const pointTimeMs = new Date(point.time).getTime();
    if (pointTimeMs <= targetMs) {
      basePoint = point;
      break;
    }
  }

  if (!basePoint) {
    return 0;
  }

  const basePrice = toNumber(basePoint.price);
  const latestPrice = toNumber(latest.price);
  if (basePrice <= 0 || latestPrice <= 0) {
    return 0;
  }

  return ((latestPrice - basePrice) / basePrice) * 100;
}

function buildDashboardStateFromTrial(trial) {
  const perSymbol = trial?.perSymbol || [];
  const trades = trial?.trades || [];
  const config = trial?.config || { totalCapital: 0 };

  const selected = perSymbol.map((item) => {
    const prices = item?.chart?.prices || [];
    const latestPoint = prices.length > 0 ? prices[prices.length - 1] : null;
    const openPosition = item?.openPosition;

    return {
      symbol: item.symbol,
      currentPrice: latestPoint ? toNumber(latestPoint.price) : null,
      move1mPercent: Number(getMovePercentByMinutesFromPrices(prices, 1).toFixed(2)),
      move3mPercent: Number(getMovePercentByMinutesFromPrices(prices, 3).toFixed(2)),
      move6mPercent: Number(getMovePercentByMinutesFromPrices(prices, 6).toFixed(2)),
      move10mPercent: Number(getMovePercentByMinutesFromPrices(prices, 10).toFixed(2)),
      hasOpenPosition: Boolean(openPosition),
      positionSide: openPosition ? openPosition.side : null,
      entryPrice: openPosition ? toNumber(openPosition.entryPrice) : null,
      remainingUnits: openPosition ? toNumber(openPosition.remainingUnits) : 0,
    };
  });

  const charts = Object.fromEntries(
    perSymbol.map((item) => [
      item.symbol,
      item?.chart || { prices: [], buyMarkers: [], sellMarkers: [] },
    ]),
  );

  const openPositions = perSymbol
    .filter((item) => item?.openPosition)
    .map((item) => ({
      symbol: item.openPosition.symbol,
      entryPrice: toNumber(item.openPosition.entryPrice),
      remainingUnits: toNumber(item.openPosition.remainingUnits),
      side: item.openPosition.side,
      entryTime: item.openPosition.entryTime,
    }));

  const tradedAmount = trades.reduce((sum, trade) => {
    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  const todayInvestedAmount = trades.reduce((sum, trade) => {
    const isEntryTrade = trade?.action === 'BUY' || trade?.action === 'SELL_SHORT';
    if (!isEntryTrade) {
      return sum;
    }

    const price = toNumber(trade?.price);
    const units = toNumber(trade?.units);
    return sum + Math.abs(price * units);
  }, 0);

  const latestChartTimeMs = Object.values(charts)
    .flatMap((chart) => chart?.prices || [])
    .map((point) => new Date(point.time).getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((maxValue, current) => Math.max(maxValue, current), 0);

  const lastRun = latestChartTimeMs > 0 ? new Date(latestChartTimeMs).toISOString() : null;

  return {
    config,
    status: {
      lastRun,
      cycleCount: 0,
      lastError: null,
      marketSource: 'history',
      marketUniverseSize: trial?.summary?.symbolsTested || selected.length,
    },
    selected,
    charts,
    openPositions,
    trades: trades.slice().reverse(),
    summary: {
      totalTrades: trial?.summary?.totalTrades ?? trades.length,
      openPositions: openPositions.length,
      realizedPnl: toNumber(trial?.summary?.totalRealizedPnl),
      unrealizedPnl: toNumber(trial?.summary?.totalUnrealizedPnl),
      totalPnl: toNumber(trial?.summary?.totalPnl),
      tradedAmount,
      todayInvestedAmount,
    },
  };
}

function renderDashboardFromTrial(trial) {
  const state = buildDashboardStateFromTrial(trial);
  renderSummary(state);
  renderSelected(state.selected);
  renderActiveTrades(state.openPositions, state.selected);
  renderTrades(state.trades, state.selected);
  renderLiveCharts(state.selected, state.charts || {}, state.status?.lastRun, state.trades || []);
  renderChartActiveTime(state);
  updateBotThinkingTicker(state, 'history');

  document.getElementById('lastUpdated').textContent = `History date: ${trial.date} | Symbols: ${trial.summary.symbolsTested} | Trades: ${trial.summary.totalTrades}`;
}

function renderChartActiveTime(state) {
  const element = document.getElementById('chartActiveTime');
  if (!element) {
    return;
  }

  const chartsBySymbol = state?.charts || {};
  const latestChartTimeMs = Object.values(chartsBySymbol)
    .flatMap((chart) => chart?.prices || [])
    .map((point) => new Date(point.time).getTime())
    .filter((value) => Number.isFinite(value))
    .reduce((maxValue, current) => Math.max(maxValue, current), 0);

  if (latestChartTimeMs > 0) {
    element.textContent = `Chart active time: ${new Date(latestChartTimeMs).toLocaleTimeString()}`;
    return;
  }

  if (state?.status?.lastRun) {
    element.textContent = `Chart active time: ${formatTime(state.status.lastRun)}`;
    return;
  }

  element.textContent = 'Chart active time: -';
}

function renderTrialSummary(trial) {
  const summary = trial?.summary || {};
  const trialCapital = toNumber(trial?.config?.totalCapital) || 10000;
  const trialRealizedPnl = toNumber(summary.totalRealizedPnl);
  const trialUnrealizedPnl = toNumber(summary.totalUnrealizedPnl);
  const trialTotalPnl = toNumber(summary.totalPnl);
  const trialRealizedPnlPercent = trialCapital > 0 ? (trialRealizedPnl / trialCapital) * 100 : 0;
  const trialUnrealizedPnlPercent = trialCapital > 0 ? (trialUnrealizedPnl / trialCapital) * 100 : 0;
  const trialPnlPercent = trialCapital > 0 ? (trialTotalPnl / trialCapital) * 100 : 0;

  const trialTotalTradesElement = document.getElementById('trialTotalTrades');
  const trialRealizedElement = document.getElementById('trialRealizedPnl');
  const trialUnrealizedElement = document.getElementById('trialUnrealizedPnl');
  const trialTotalPnlElement = document.getElementById('trialTotalPnl');

  if (trialTotalTradesElement) {
    trialTotalTradesElement.textContent = summary.totalTrades;
  }
  if (trialRealizedElement) {
    trialRealizedElement.textContent = `${formatAmount(trialRealizedPnl)} (${toPercentText(trialRealizedPnlPercent)})`;
  }
  if (trialUnrealizedElement) {
    trialUnrealizedElement.textContent = `${formatAmount(trialUnrealizedPnl)} (${toPercentText(trialUnrealizedPnlPercent)})`;
  }
  if (trialTotalPnlElement) {
    trialTotalPnlElement.textContent = `${formatAmount(trialTotalPnl)} (${toPercentText(trialPnlPercent)})`;
  }
  applyValueClass('trialRealizedPnl', toNumber(summary.totalRealizedPnl));
  applyValueClass('trialUnrealizedPnl', toNumber(summary.totalUnrealizedPnl));
  latestTrialTotalPnl = toNumber(summary.totalPnl);
  applyValueClass('trialTotalPnl', latestTrialTotalPnl);
  applyAutoTheme();
}

function renderTrialSymbols(perSymbol) {
  const body = document.getElementById('trialSymbolsTable');
  body.innerHTML = perSymbol
    .map(
      (item) => `
      <tr>
        <td>${item.symbol}</td>
        <td class="money-col ${valueClass(toNumber(item.realizedPnl))}">${item.realizedPnl}</td>
        <td class="money-col ${valueClass(toNumber(item.unrealizedPnl))}">${item.unrealizedPnl}</td>
        <td class="money-col ${valueClass(toNumber(item.totalPnl))}">${item.totalPnl}</td>
        <td class="money-col">${item.trades.length}</td>
      </tr>
    `,
    )
    .join('');
}

function renderTrialTrades(trades) {
  const body = document.getElementById('trialTradesTable');
  if (!body) {
    return;
  }
  const rows = trades || [];

  if (rows.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="8" class="muted">No trades found for selected date with current strategy.</td>
      </tr>
      <tr class="summary-row">
        <td>Summary</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>0.00</td>
        <td>0.00</td>
        <td>Trades: 0</td>
        <td class="neu">0.00</td>
      </tr>
    `;
    return;
  }

  const totalUnits = rows.reduce((sum, trade) => sum + toNumber(trade?.units), 0);
  const totalInvestedAmount = rows.reduce(
    (sum, trade) => sum + Math.abs(toNumber(trade?.price) * toNumber(trade?.units)),
    0,
  );
  const totalPnl = rows.reduce((sum, trade) => sum + toNumber(trade?.pnl), 0);

  body.innerHTML = rows
    .map(
      (trade) => {
        const investedAmount = Math.abs(toNumber(trade?.price) * toNumber(trade?.units));
        return `
      <tr>
        <td>${formatTime(trade.time)}</td>
        <td class="${trade.action === 'BUY' || trade.action === 'COVER' ? 'buy' : 'sell'}">${trade.action}</td>
        <td>${trade.symbol}</td>
        <td class="money-col">${trade.price}</td>
        <td class="money-col">${trade.units}</td>
        <td class="money-col">${formatAmount(investedAmount)}</td>
        <td>${trade.reason}</td>
        <td class="money-col ${valueClass(toNumber(trade.pnl))}">${trade.pnl ?? '-'}</td>
      </tr>
    `;
      },
    )
    .join('')
    + `
      <tr class="summary-row">
        <td>Summary</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td class="money-col">${formatAmount(totalUnits)}</td>
        <td class="money-col">${formatAmount(totalInvestedAmount)}</td>
        <td>Trades: ${rows.length}</td>
        <td class="money-col ${valueClass(totalPnl)}">${formatAmount(totalPnl)}</td>
      </tr>
    `;
}

function renderPremarketShortlist(data) {
  const longBody = document.getElementById('premarketLongTable');
  const shortBody = document.getElementById('premarketShortTable');
  const info = document.getElementById('premarketInfo');

  longBody.innerHTML = (data.longCandidates || [])
    .map((item) => `
      <tr>
        <td>${item.symbol}</td>
        <td class="${valueClass(toNumber(item.dayChangePercent))}">${item.dayChangePercent}%</td>
        <td>${item.longScore}</td>
      </tr>
    `)
    .join('');

  shortBody.innerHTML = (data.shortCandidates || [])
    .map((item) => `
      <tr>
        <td>${item.symbol}</td>
        <td class="${valueClass(toNumber(item.dayChangePercent))}">${item.dayChangePercent}%</td>
        <td>${item.shortScore}</td>
      </tr>
    `)
    .join('');

  info.textContent = `Date: ${data.date} | Source: ${data.source} | Universe: ${data.universeSize} | Evaluated: ${data.evaluated}`;
}

async function refreshPremarketIfDue() {
  if (premarketFetchInProgress) {
    return;
  }

  const now = Date.now();
  if (lastPremarketFetchAt !== 0 && now - lastPremarketFetchAt < PREMARKET_REFRESH_MS) {
    return;
  }

  premarketFetchInProgress = true;
  try {
    const premarket = await fetchPremarketShortlist();
    renderPremarketShortlist(premarket);
    lastPremarketFetchAt = Date.now();
  } catch (premarketError) {
    const premarketInfo = document.getElementById('premarketInfo');
    if (premarketInfo) {
      const suffix = premarketInfo.textContent ? ` | ${premarketInfo.textContent}` : '';
      premarketInfo.textContent = `Pre-market refresh failed: ${premarketError.message}${suffix}`;
    }
  } finally {
    premarketFetchInProgress = false;
  }
}

async function analyzeTomorrowShortlist() {
  const analyzeButton = document.getElementById('analyzeTomorrowBtn');
  const premarketInfo = document.getElementById('premarketInfo');
  const baseDate = getSelectedDashboardDate();
  const targetDate = addDays(baseDate, 1);

  if (analyzeButton) {
    analyzeButton.disabled = true;
    analyzeButton.textContent = 'Analyzing...';
  }

  if (premarketInfo) {
    premarketInfo.textContent = `Analyzing tomorrow (${targetDate}) candidates using ${baseDate} market data...`;
  }

  try {
    const premarket = await fetchPremarketShortlist(baseDate);
    renderPremarketShortlist(premarket);

    if (premarketInfo) {
      premarketInfo.textContent = `Tomorrow (${targetDate}) analysis | Based on: ${premarket.date} | Source: ${premarket.source} | Universe: ${premarket.universeSize} | Evaluated: ${premarket.evaluated}`;
    }
  } catch (error) {
    if (premarketInfo) {
      premarketInfo.textContent = `Tomorrow analysis failed: ${error.message}`;
    }
  } finally {
    if (analyzeButton) {
      analyzeButton.disabled = false;
      analyzeButton.textContent = 'Analyze Tomorrow Stocks';
    }
  }
}

async function runTrialFromDateInput(silent = false) {
  const trialDate = document.getElementById('trialDate').value;
  const trialStatus = document.getElementById('trialStatus');
  const trialTradesInfo = document.getElementById('trialTradesInfo');

  try {
    if (!silent) {
      trialStatus.textContent = 'Running trial...';
    }
    const trial = await fetchTrial(trialDate);
    await ensureChartLibraryLoaded().catch(() => false);

    renderDashboardFromTrial(trial);
    renderTrialSummary(trial);
    renderTrialSymbols(trial.perSymbol);
    renderTrialTrades(trial.trades);
    renderTodayTradedCharts(trial);

    trialStatus.textContent = `Trial date: ${trial.date} | Symbols: ${trial.summary.symbolsTested} | Trades: ${trial.summary.totalTrades}`;
    document.getElementById('trialDate').value = trial.date;
    if (trialTradesInfo) {
      trialTradesInfo.textContent = `Showing trade history for ${trial.date}`;
    }
  } catch (error) {
    trialStatus.textContent = `Trial error: ${error.message}`;
    if (trialTradesInfo) {
      trialTradesInfo.textContent = `Trade history error: ${error.message}`;
    }
  }
}

async function refresh() {
  if (refreshInProgress) {
    refreshQueued = true;
    return;
  }

  refreshInProgress = true;

  try {
    if (!isTodaySelectedDate()) {
      await runTrialFromDateInput(true);
      return;
    }

    const state = await fetchState();
    await ensureChartLibraryLoaded().catch(() => false);

    const viewStrategyId = dashboardViewStrategyId || state?.status?.activeStrategyId || '';
    let viewState = buildViewStateByStrategy(state, viewStrategyId);

    if (viewStrategyId && viewStrategyId !== state?.status?.activeStrategyId) {
      try {
        const monitor = await fetchStrategyMonitor();
        const monitorRow = (monitor?.results || []).find((row) => row?.strategyId === viewStrategyId);
        viewState = buildViewStateFromMonitorStrategy(state, monitorRow, viewStrategyId);
      } catch (monitorError) {
        // keep fallback live-state-based view
      }
    }

    if ((state?.selected || []).length === 0 && (state?.trades || []).length === 0 && isTodaySelectedDate()) {
      const trial = await fetchTrial(todayDateValue());
      renderDashboardFromTrial(trial);
      renderTrialSummary(trial);
      renderTrialSymbols(trial.perSymbol);
      renderTrialTrades(trial.trades);
      renderTodayTradedCharts(trial);
      document.getElementById('trialStatus').textContent = `Trial date: ${trial.date} | Symbols: ${trial.summary.symbolsTested} | Trades: ${trial.summary.totalTrades}`;
      const trialTradesInfo = document.getElementById('trialTradesInfo');
      if (trialTradesInfo) {
        trialTradesInfo.textContent = `Showing trade history for ${trial.date}`;
      }
      return;
    }

    renderSummary(viewState);
    renderSelected(viewState.selected);
    renderActiveTrades(viewState.openPositions, viewState.selected);
    renderTrades(viewState.trades, viewState.selected);
    renderLiveCharts(viewState.selected, viewState.charts || {}, viewState.status?.lastRun, viewState.trades || []);
    renderChartActiveTime(viewState);
    updateBotThinkingTicker(viewState, 'live');
    refreshPremarketIfDue();

    const info = state.status.lastError
      ? `Last run: ${formatTime(state.status.lastRun)} | Error: ${state.status.lastError}`
      : `Last run: ${formatTime(state.status.lastRun)} | Cycles: ${state.status.cycleCount} | Source: ${state.status.marketSource || '-'} (${state.status.marketUniverseSize || 0})`;
    document.getElementById('lastUpdated').textContent = info;

    const strategySelect = document.getElementById('strategySelect');
    const strategyStatus = document.getElementById('strategyStatus');
    if (strategySelect) {
      if (!dashboardViewStrategyId) {
        dashboardViewStrategyId = state?.status?.activeStrategyId || strategySelect.value || '';
        persistViewStrategyId(dashboardViewStrategyId);
      }
      strategySelect.value = dashboardViewStrategyId;
      updateStrategyInfoLine(dashboardViewStrategyId, strategyPresetById.get(dashboardViewStrategyId)?.config);
      if (strategyStatus) {
        const sourceText = viewState?.status?.monitorSource ? ` | Source: ${viewState.status.monitorSource}` : '';
        strategyStatus.textContent = `Engine active: ${state?.status?.activeStrategyId || '-'} | Viewing: ${dashboardViewStrategyId || '-'}${sourceText}`;
      }
    }
  } catch (error) {
    document.getElementById('lastUpdated').textContent = `Error: ${error.message}`;
  } finally {
    refreshInProgress = false;
    if (refreshQueued) {
      refreshQueued = false;
      refresh();
    }
  }
}

document.getElementById('runNowBtn').addEventListener('click', async () => {
  await fetch('/api/run-now', { method: 'POST' });
  await refresh();
});

document.getElementById('activeTradesTable').addEventListener('click', async (event) => {
  const button = event.target?.closest?.('.sell-trade-btn');
  if (!button) {
    return;
  }

  const symbol = String(button.getAttribute('data-symbol') || '').trim();
  const strategyStatus = document.getElementById('strategyStatus');

  if (!symbol) {
    return;
  }

  if (!window.confirm(`Sell active trade for ${symbol}?`)) {
    return;
  }

  try {
    button.disabled = true;
    button.textContent = 'Selling...';
    if (strategyStatus) {
      strategyStatus.textContent = `Selling ${symbol}...`;
    }

    const result = await sellTradeBySymbol(symbol);
    const sold = Boolean(result?.action?.sold);
    const actionReason = result?.action?.reason ? String(result.action.reason) : '';

    if (strategyStatus) {
      strategyStatus.textContent = sold
        ? `${symbol} sold successfully`
        : `${symbol} not sold${actionReason ? `: ${actionReason}` : ''}`;
    }

    nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
    await refresh();
  } catch (error) {
    if (strategyStatus) {
      strategyStatus.textContent = `Sell failed for ${symbol}: ${error.message}`;
    }
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.textContent = 'Sell';
    }
  }
});

document.getElementById('refreshDataBtn').addEventListener('click', async () => {
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  await refresh();
});

document.getElementById('runTrialBtn').addEventListener('click', async () => {
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  await refresh();
});

document.getElementById('trialDate').addEventListener('change', async () => {
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  await refresh();
});

document.getElementById('downloadTrialCsvBtn').addEventListener('click', () => {
  const trialDate = document.getElementById('trialDate').value;
  const query = trialDate ? `?date=${encodeURIComponent(trialDate)}` : '';
  window.open(`/api/trial-csv${query}`, '_blank');
});

document.getElementById('openComparisonBtn').addEventListener('click', () => {
  const trialDate = document.getElementById('trialDate').value;
  const query = trialDate ? `?date=${encodeURIComponent(trialDate)}` : '';
  window.open(`/comparison.html${query}`, '_blank');
});

document.getElementById('applyStrategyBtn').addEventListener('click', async () => {
  const strategySelect = document.getElementById('strategySelect');
  const strategyStatus = document.getElementById('strategyStatus');
  const selectedStrategyId = strategySelect?.value;
  if (!selectedStrategyId) {
    return;
  }

  dashboardViewStrategyId = selectedStrategyId;
  persistViewStrategyId(dashboardViewStrategyId);
  if (strategyStatus) {
    strategyStatus.textContent = `Viewing strategy: ${dashboardViewStrategyId}`;
  }

  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  await refresh();
});

document.getElementById('strategySelect').addEventListener('change', (event) => {
  const selectedStrategyId = event?.target?.value;
  dashboardViewStrategyId = selectedStrategyId || dashboardViewStrategyId;
  persistViewStrategyId(dashboardViewStrategyId);
  updateStrategyInfoLine(selectedStrategyId);
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  refresh();
});

document.getElementById('strategySelect').addEventListener('mouseenter', (event) => {
  const selectedStrategyId = event?.target?.value;
  updateStrategyInfoLine(selectedStrategyId);
  setStrategyInfoVisibility(true);
});

document.getElementById('strategySelect').addEventListener('mouseleave', () => {
  setStrategyInfoVisibility(false);
});

document.getElementById('strategySelect').addEventListener('focus', (event) => {
  const selectedStrategyId = event?.target?.value;
  updateStrategyInfoLine(selectedStrategyId);
  setStrategyInfoVisibility(true);
});

document.getElementById('strategySelect').addEventListener('blur', () => {
  setStrategyInfoVisibility(false);
});

document.getElementById('trialDate').value = todayDateValue();
const trialTradesInfo = document.getElementById('trialTradesInfo');
if (trialTradesInfo) {
  trialTradesInfo.textContent = `Showing trade history for ${todayDateValue()}`;
}

initStrategySelector();
refresh();
runTrialFromDateInput(true);
setInterval(() => {
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  refresh();
}, REFRESH_INTERVAL_MS);
updateClockAndRefreshTimer();
setInterval(updateClockAndRefreshTimer, 1000);
