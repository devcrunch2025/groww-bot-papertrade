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

const liveChartInstances = new Map();
const trialChartInstances = new Map();
let latestLiveRealizedPnl = 0;
let latestTrialTotalPnl = 0;
let lastPremarketFetchAt = 0;
let refreshInProgress = false;
let refreshQueued = false;
let premarketFetchInProgress = false;
let nextAutoRefreshAt = Date.now() + 10000;

const PREMARKET_REFRESH_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 10000;

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

function todayDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
        <td>${row.currentPrice ?? '-'}</td>
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

function renderTrades(trades) {
  const body = document.getElementById('tradesTable');
  body.innerHTML = trades
    .map(
      (trade) => `
      <tr>
        <td>${formatTime(trade.time)}</td>
        <td class="${trade.action === 'BUY' || trade.action === 'COVER' ? 'buy' : 'sell'}">${trade.action}</td>
        <td>${trade.symbol}</td>
        <td>${trade.price}</td>
        <td>${trade.units}</td>
        <td>${trade.reason}</td>
        <td class="${valueClass(toNumber(trade.pnl))}">${trade.pnl ?? '-'}</td>
      </tr>
    `,
    )
    .join('');
}

function renderSummary(summary) {
  document.getElementById('totalTrades').textContent = summary.totalTrades;
  document.getElementById('openPositions').textContent = summary.openPositions;
  document.getElementById('realizedPnl').textContent = summary.realizedPnl;
  latestLiveRealizedPnl = toNumber(summary.realizedPnl);
  applyValueClass('realizedPnl', latestLiveRealizedPnl);
  applyAutoTheme();
}

function destroyCharts(chartMap) {
  for (const chart of chartMap.values()) {
    chart.destroy();
  }
  chartMap.clear();
}

function renderSymbolCharts(containerId, chartMap, rows, chartResolver) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  destroyCharts(chartMap);

  rows.forEach((row) => {
    const chartData = chartResolver(row) || { prices: [], buyMarkers: [], sellMarkers: [] };
    const symbol = row.symbol;

    const chartBox = document.createElement('div');
    chartBox.className = 'chart-box';

    const pricePoints = chartData.prices || [];
    const firstPrice = pricePoints.length > 0 ? toNumber(pricePoints[0].price) : 0;
    const latestChartPrice = pricePoints.length > 0 ? toNumber(pricePoints[pricePoints.length - 1].price) : 0;
    const livePrice = toNumber(row.currentPrice);
    const displayPrice = livePrice > 0 ? livePrice : latestChartPrice;
    const changePercent = firstPrice > 0 ? ((displayPrice - firstPrice) / firstPrice) * 100 : 0;
    const changePrefix = changePercent > 0 ? '+' : '';

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

    const canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    canvas.height = 120;
    chartBox.appendChild(canvas);
    container.appendChild(chartBox);

    const priceSeries = chartData.prices.map((point) => ({ x: new Date(point.time).getTime(), y: point.price }));
    const buySeries = chartData.buyMarkers.map((point) => ({ x: new Date(point.time).getTime(), y: point.price }));
    const sellSeries = chartData.sellMarkers.map((point) => ({ x: new Date(point.time).getTime(), y: point.price }));

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Price',
            data: priceSeries,
            borderColor: '#2563eb',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
          },
          {
            label: 'BUY',
            type: 'scatter',
            data: buySeries,
            pointRadius: 5,
            pointBackgroundColor: '#16a34a',
          },
          {
            label: 'SELL',
            type: 'scatter',
            data: sellSeries,
            pointRadius: 5,
            pointBackgroundColor: '#dc2626',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            ticks: {
              font: {
                size: 9,
              },
              callback(value) {
                return formatChartTime(value);
              },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
            },
          },
          y: {
            ticks: {
              font: {
                size: 9,
              },
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              title(items) {
                const xValue = items?.[0]?.parsed?.x;
                return formatChartTime(xValue);
              },
              label(context) {
                const value = toNumber(context.parsed.y);
                const pct = firstPrice > 0 ? ((value - firstPrice) / firstPrice) * 100 : 0;
                const pctPrefix = pct > 0 ? '+' : '';
                return `${context.dataset.label}: ${value.toFixed(2)} (${pctPrefix}${pct.toFixed(2)}%)`;
              },
            },
          },
        },
      },
    });

    chartMap.set(symbol, chart);
  });
}

function renderLiveCharts(selected, chartsBySymbol) {
  renderSymbolCharts('chartsContainer', liveChartInstances, selected, (row) => chartsBySymbol[row.symbol]);
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

function renderTrialSummary(summary) {
  document.getElementById('trialTotalTrades').textContent = summary.totalTrades;
  document.getElementById('trialRealizedPnl').textContent = summary.totalRealizedPnl;
  document.getElementById('trialUnrealizedPnl').textContent = summary.totalUnrealizedPnl;
  document.getElementById('trialTotalPnl').textContent = summary.totalPnl;
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
        <td class="${valueClass(toNumber(item.realizedPnl))}">${item.realizedPnl}</td>
        <td class="${valueClass(toNumber(item.unrealizedPnl))}">${item.unrealizedPnl}</td>
        <td class="${valueClass(toNumber(item.totalPnl))}">${item.totalPnl}</td>
        <td>${item.trades.length}</td>
      </tr>
    `,
    )
    .join('');
}

function renderTrialCharts(perSymbol) {
  renderSymbolCharts('trialChartsContainer', trialChartInstances, perSymbol, (row) => row.chart);
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

async function runTrialFromDateInput() {
  const trialDate = document.getElementById('trialDate').value;
  const trialStatus = document.getElementById('trialStatus');

  try {
    trialStatus.textContent = 'Running trial...';
    const trial = await fetchTrial(trialDate);

    renderTrialSummary(trial.summary);
    renderTrialSymbols(trial.perSymbol);
    renderTrialCharts(trial.perSymbol);

    trialStatus.textContent = `Trial date: ${trial.date} | Symbols: ${trial.summary.symbolsTested} | Trades: ${trial.summary.totalTrades}`;
    document.getElementById('trialDate').value = trial.date;
  } catch (error) {
    trialStatus.textContent = `Trial error: ${error.message}`;
  }
}

async function refresh() {
  if (refreshInProgress) {
    refreshQueued = true;
    return;
  }

  refreshInProgress = true;

  try {
    const state = await fetchState();
    renderSummary(state.summary);
    renderSelected(state.selected);
    renderTrades(state.trades);
    renderLiveCharts(state.selected, state.charts || {});
    renderChartActiveTime(state);
    refreshPremarketIfDue();

    const info = state.status.lastError
      ? `Last run: ${formatTime(state.status.lastRun)} | Error: ${state.status.lastError}`
      : `Last run: ${formatTime(state.status.lastRun)} | Cycles: ${state.status.cycleCount} | Source: ${state.status.marketSource || '-'} (${state.status.marketUniverseSize || 0})`;
    document.getElementById('lastUpdated').textContent = info;
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

document.getElementById('refreshDataBtn').addEventListener('click', async () => {
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  await refresh();
});

document.getElementById('runTrialBtn').addEventListener('click', async () => {
  await runTrialFromDateInput();
});

document.getElementById('downloadTrialCsvBtn').addEventListener('click', () => {
  const trialDate = document.getElementById('trialDate').value;
  const query = trialDate ? `?date=${encodeURIComponent(trialDate)}` : '';
  window.open(`/api/trial-csv${query}`, '_blank');
});

document.getElementById('trialDate').value = todayDateValue();

refresh();
runTrialFromDateInput();
setInterval(() => {
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
  refresh();
}, REFRESH_INTERVAL_MS);
updateClockAndRefreshTimer();
setInterval(updateClockAndRefreshTimer, 1000);
