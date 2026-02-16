async function fetchState() {
  const response = await fetch('/api/state');
  if (!response.ok) {
    throw new Error('Failed to fetch state');
  }
  return response.json();
}

async function fetchTrial(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`/api/trial${query}`);
  if (!response.ok) {
    throw new Error('Failed to fetch trial data');
  }
  return response.json();
}

async function fetchPremarketShortlist(date) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`/api/premarket-shortlist${query}`);
  if (!response.ok) {
    throw new Error('Failed to fetch pre-market shortlist');
  }
  return response.json();
}

const liveChartInstances = new Map();
const trialChartInstances = new Map();
let latestLiveRealizedPnl = 0;
let latestTrialTotalPnl = 0;

function formatTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatChartTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString();
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
    .map(
      (row) => `
      <tr>
        <td>${row.symbol}</td>
        <td>${row.currentPrice ?? '-'}</td>
        <td class="${valueClass(toNumber(row.minuteMovePercent))}">${row.minuteMovePercent}%</td>
        <td><span class="tag">${row.uptrend10m ? 'Yes' : 'No'}</span></td>
        <td>${row.hasOpenPosition ? `${row.positionSide} ${row.remainingUnits} @ ${row.entryPrice}` : '-'}</td>
      </tr>
    `,
    )
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
    const lastPrice = pricePoints.length > 0 ? toNumber(pricePoints[pricePoints.length - 1].price) : 0;
    const changePercent = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    const changePrefix = changePercent > 0 ? '+' : '';

    const title = document.createElement('h3');
    title.className = 'chart-title';
    title.textContent = `${symbol} (${changePrefix}${changePercent.toFixed(2)}%)`;
    chartBox.appendChild(title);

    const canvas = document.createElement('canvas');
    canvas.className = 'chart-canvas';
    chartBox.appendChild(canvas);
    container.appendChild(chartBox);

    const priceSeries = chartData.prices.map((point) => ({ x: formatChartTime(point.time), y: point.price }));
    const buySeries = chartData.buyMarkers.map((point) => ({ x: formatChartTime(point.time), y: point.price }));
    const sellSeries = chartData.sellMarkers.map((point) => ({ x: formatChartTime(point.time), y: point.price }));

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
            type: 'category',
          },
        },
        plugins: {
          legend: {
            display: true,
          },
          tooltip: {
            callbacks: {
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
  try {
    const state = await fetchState();
    const premarket = await fetchPremarketShortlist();
    renderSummary(state.summary);
    renderSelected(state.selected);
    renderTrades(state.trades);
    renderLiveCharts(state.selected, state.charts || {});
    renderPremarketShortlist(premarket);

    const info = state.status.lastError
      ? `Last run: ${formatTime(state.status.lastRun)} | Error: ${state.status.lastError}`
      : `Last run: ${formatTime(state.status.lastRun)} | Cycles: ${state.status.cycleCount} | Source: ${state.status.marketSource || '-'} (${state.status.marketUniverseSize || 0})`;
    document.getElementById('lastUpdated').textContent = info;
  } catch (error) {
    document.getElementById('lastUpdated').textContent = `Error: ${error.message}`;
  }
}

document.getElementById('runNowBtn').addEventListener('click', async () => {
  await fetch('/api/run-now', { method: 'POST' });
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
setInterval(refresh, 10000);
