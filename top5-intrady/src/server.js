
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const {
  startEngine,
  runCycle,
  getSnapshot,
  runTodayHistoryTrial,
  runHistoryTrialForDate,
  runPremarketShortlist,
  getStrategyPresets,
  getActiveStrategy,
  applyStrategyPreset,
  getStrategyComparisonForDate,
  getStrategyMonitorForDate,
  forceSellAllActiveTrades,
  forceSellActiveTradeBySymbol,
} = require("./strategyEngine");
const {
  getNotificationConfig,
  sendTradeNotifications,
  sendCycleHeartbeat,
  sendTestEmail,
} = require("./emailNotifier");

const app = express();
const PORT = process.env.PORT || 3000;
const notifierState = {
  lastNotifiedTradeCount: 0,
};

const strategyMonitorState = {
  data: null,
  lastUpdated: null,
  lastError: null,
  inProgress: false,
};

const fs = require('fs/promises');
const SYMBOLS_FILE = path.join(__dirname, '..', 'data', 'selected-symbols.json');
const yahooFinance = require('yahoo-finance2').default;

// Middleware: CORS, JSON body parser and static must be registered before routes
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Get current stocks (symbols) for paper trading
app.get("/api/symbols", async (req, res) => {
  try {
    console.log('/api/symbols called');
    // Prefer the persisted symbols file (user-managed)
    let symbols = [];
    try {
      console.log('Attempting to read symbols file:', SYMBOLS_FILE);
      const raw = await fs.readFile(SYMBOLS_FILE, 'utf8');
      console.log('Symbols file raw length:', raw ? raw.length : 0);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        symbols = parsed.map(s => String(s).trim().toUpperCase()).filter(Boolean);
      } else if (parsed && Array.isArray(parsed.symbols)) {
        symbols = parsed.symbols.map(s => String(s).trim().toUpperCase()).filter(Boolean);
      }
    } catch (err) {
      console.warn('Failed to read/parse symbols file, will fallback to snapshot:', err && err.message);
      // file missing or parse error -> fallback to snapshot
    }

    if (!symbols || symbols.length === 0) {
      const snapshot = getSnapshot();
      const selected = snapshot && Array.isArray(snapshot.selected) ? snapshot.selected : [];
      symbols = selected.map((s) => (s && s.symbol) ? s.symbol : null).filter(Boolean);
    }

    res.json({ ok: true, symbols });
  } catch (err) {
    console.error('Error in /api/symbols:', err);
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
});
// Add stocks (symbols) for paper trading
app.post("/api/add-symbols", async (req, res) => {
  try {
    console.log('POST /api/add-symbols headers:', req.headers);
    console.log('POST /api/add-symbols rawBody:', req.rawBody);
    console.log('POST /api/add-symbols parsed body:', req.body);
    const symbols = Array.isArray(req.body?.symbols)
      ? req.body.symbols.map(s => String(s).trim().toUpperCase()).filter(Boolean)
      : [];
    if (!symbols.length) {
      const debug = { ok: false, message: 'No symbols provided' };
      try { debug.headers = req.headers; } catch (e) {}
      try { debug.rawBody = req.rawBody; } catch (e) {}
      try { debug.body = req.body; } catch (e) {}
      return res.status(400).json(debug);
    }
    // enforce maximum number of symbols based on active strategy config (topN)
    try {
      const active = getActiveStrategy();
      const max = active?.config?.topN ? Number(active.config.topN) : 5;
      if (Number.isFinite(max) && max > 0 && symbols.length > max) {
        const originalCount = symbols.length;
        const trimmed = symbols.slice(0, max);
        console.warn(`Trimming symbols from ${originalCount} to max ${max}`);
        // persist trimmed list instead
        try {
          await fs.mkdir(path.dirname(SYMBOLS_FILE), { recursive: true });
          await fs.writeFile(SYMBOLS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
          console.log(`Saved ${trimmed.length} symbols to ${SYMBOLS_FILE} (trimmed)`);
        } catch (fsErr) {
          console.error('Failed to persist trimmed symbols file:', fsErr);
        }

        return res.json({ ok: true, message: `Trimmed symbols to max ${max}`, originalCount, savedCount: trimmed.length, symbols: trimmed });
      }
    } catch (e) {
      console.warn('Could not enforce max symbol limit:', e && e.message);
    }
    // Persist to disk for durability (user-managed file)
    try {
      await fs.mkdir(path.dirname(SYMBOLS_FILE), { recursive: true });
      await fs.writeFile(SYMBOLS_FILE, JSON.stringify(symbols, null, 2), 'utf8');
      console.log(`Saved ${symbols.length} symbols to ${SYMBOLS_FILE}`);
    } catch (fsErr) {
      console.error('Failed to persist symbols file:', fsErr);
    }

    console.log('Updated symbols via API:', symbols);
    res.json({ ok: true, message: `Added ${symbols.length} symbols for paper trading`, symbols });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
});

async function refreshStrategyMonitor(dateString) {
  if (strategyMonitorState.inProgress) {
    return strategyMonitorState.data;
  }

  strategyMonitorState.inProgress = true;
  try {
    const data = await getStrategyMonitorForDate(dateString);
    strategyMonitorState.data = data;
    strategyMonitorState.lastUpdated = new Date().toISOString();
    strategyMonitorState.lastError = null;
    return data;
  } catch (error) {
    strategyMonitorState.lastError = error.message || String(error);
    return strategyMonitorState.data;
  } finally {
    strategyMonitorState.inProgress = false;
  }
}

async function sendNotificationsForLatestCycle(snapshot, context) {
  const totalTrades = snapshot?.summary?.totalTrades || 0;
  const trades = snapshot?.trades || [];
  const newTradeCount = Math.max(0, totalTrades - notifierState.lastNotifiedTradeCount);
  const newTradesChronological = trades
    .slice(0, newTradeCount)
    .reverse();

  notifierState.lastNotifiedTradeCount = totalTrades;

  await sendTradeNotifications(newTradesChronological, snapshot);
  await sendCycleHeartbeat(snapshot, context);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    notifications: getNotificationConfig(),
    strategy: getActiveStrategy(),
  });
});

app.get("/api/strategies", (req, res) => {
  res.json({
    active: getActiveStrategy(),
    presets: getStrategyPresets(),
  });
});

app.get("/api/strategy-comparison", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const result = await getStrategyComparisonForDate(date);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to generate strategy comparison",
      error: error.message || String(error),
    });
  }
});

app.get("/api/strategy-monitor", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    let data = null;

    if (date) {
      data = await getStrategyMonitorForDate(date);
    } else {
      data = await refreshStrategyMonitor();
      if (!data) {
        data = await getStrategyMonitorForDate();
      }
    }

    res.json({
      ok: true,
      background: !date,
      lastUpdated: strategyMonitorState.lastUpdated,
      lastError: strategyMonitorState.lastError,
      ...data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to load strategy monitor",
      error: error.message || String(error),
    });
  }
});

app.post("/api/strategies/select", async (req, res) => {
  try {
    const strategyId = req.body?.id ? String(req.body.id) : "";
    const active = applyStrategyPreset(strategyId);
    const snapshot = getSnapshot();
    res.json({ ok: true, active, snapshot });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error.message || String(error),
    });
  }
});

app.get("/api/state", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.json(getSnapshot());
});

app.post("/api/run-now", async (req, res) => {
  const success = await runCycle();
  const snapshot = getSnapshot();
  await sendNotificationsForLatestCycle(snapshot, "manual-run");
  res.status(success ? 200 : 500).json(snapshot);
});

app.post("/api/sell-active-trades", async (req, res) => {
  try {
    const reason = req.body?.reason ? String(req.body.reason) : "Manual sell: user booked profit";
    const action = await forceSellAllActiveTrades(reason);
    const snapshot = getSnapshot();
    await sendNotificationsForLatestCycle(snapshot, "manual-sell-all");
    res.json({ ok: true, action, snapshot });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to sell active trades",
      error: error.message || String(error),
    });
  }
});

app.post("/api/sell-trade", async (req, res) => {
  try {
    const symbol = req.body?.symbol ? String(req.body.symbol) : "";
    const reason = req.body?.reason ? String(req.body.reason) : "Manual sell: user booked profit";

    if (!symbol) {
      res.status(400).json({
        ok: false,
        message: "Symbol is required",
      });
      return;
    }

    const action = await forceSellActiveTradeBySymbol(symbol, reason);
    const snapshot = getSnapshot();
    await sendNotificationsForLatestCycle(snapshot, "manual-sell-one");
    res.json({ ok: true, action, snapshot });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to sell active trade",
      error: error.message || String(error),
    });
  }
});

app.post("/api/test-email", async (req, res) => {
  try {
    const message = req.body?.message ? String(req.body.message) : "Manual test from API";
    await sendTestEmail(message);
    res.json({ ok: true, message: "Test email sent" });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to send test email",
      error: error.message || String(error),
    });
  }
});

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildTrialCsv(result) {
  const summaryLines = [
    ["Date", result.date],
    ["Symbols Tested", result.summary.symbolsTested],
    ["Total Trades", result.summary.totalTrades],
    ["Total Realized PnL", result.summary.totalRealizedPnl],
    ["Total Unrealized PnL", result.summary.totalUnrealizedPnl],
    ["Total PnL", result.summary.totalPnl],
  ].map((row) => row.map(escapeCsv).join(","));

  const perSymbolHeader = ["symbol", "realizedPnl", "unrealizedPnl", "totalPnl", "trades"].map(escapeCsv).join(",");
  const perSymbolRows = result.perSymbol.map((item) =>
    [item.symbol, item.realizedPnl, item.unrealizedPnl, item.totalPnl, item.trades.length].map(escapeCsv).join(",")
  );

  const tradeHeader = ["time", "action", "symbol", "price", "units", "reason", "pnl"].map(escapeCsv).join(",");
  const tradeRows = result.trades.map((trade) =>
    [trade.time, trade.action, trade.symbol, trade.price, trade.units, trade.reason, trade.pnl ?? ""]
      .map(escapeCsv)
      .join(",")
  );

  return [
    "Summary",
    ...summaryLines,
    "",
    "Per Symbol",
    perSymbolHeader,
    ...perSymbolRows,
    "",
    "Trades",
    tradeHeader,
    ...tradeRows,
  ].join("\n");
}

app.get("/api/trial-today", async (req, res) => {
  try {
    const result = await runTodayHistoryTrial();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to run today history trial",
      error: error.message || String(error),
    });
  }
});

app.get("/api/trial", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const result = await runHistoryTrialForDate(date);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to run date-wise trial",
      error: error.message || String(error),
    });
  }
});

app.get("/api/trial-csv", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const result = await runHistoryTrialForDate(date);
    const csv = buildTrialCsv(result);
    const fileName = `trial-${result.date}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({
      message: "Failed to export trial CSV",
      error: error.message || String(error),
    });
  }
});

app.get("/api/premarket-shortlist", async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const result = await runPremarketShortlist(date);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to build pre-market shortlist",
      error: error.message || String(error),
    });
  }
});

// Debug: expose persisted symbols file and engine snapshot for troubleshooting
app.get("/api/debug-symbols", async (req, res) => {
  try {
    let fileContents = null;
    try {
      const raw = await fs.readFile(SYMBOLS_FILE, "utf8");
      fileContents = JSON.parse(raw);
    } catch (e) {
      fileContents = { error: e.message || String(e) };
    }

    let snapshot = null;
    try {
      snapshot = getSnapshot();
    } catch (e) {
      snapshot = { error: e.message || String(e) };
    }

    res.json({ ok: true, file: fileContents, snapshot });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
});

// Get recent quotes and minute-move percentages for given symbols
app.get('/api/quotes', async (req, res) => {
  try {
    const q = req.query.symbols || req.query.s || '';
    const symbols = String(q).split(',').map(x => x && x.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) return res.json({ ok: true, quotes: [] });

    const results = await Promise.all(symbols.map(async (symbol) => {
      try {
        const chart = await yahooFinance.chart(symbol, { period: '1d', interval: '1m' });
        const timestamps = (chart?.timestamp || []).map(t => Number(t));
        const closeArr = (chart?.indicators?.quote && chart.indicators.quote[0] && chart.indicators.quote[0].close) || [];
        if (!timestamps.length || !closeArr.length) {
          const q = await yahooFinance.quote(symbol);
          return { symbol, price: q?.regularMarketPrice ?? null, move1m: null, move3m: null, move6m: null, move10m: null, prices: [] };
        }

        const latestIndex = timestamps.length - 1;
        const latestTs = timestamps[latestIndex];
        const latestPrice = Number(closeArr[latestIndex]);

        // build prices array as { time: ISOString, price }
        const prices = timestamps.map((ts, idx) => {
          const price = Number(closeArr[idx]);
          if (!Number.isFinite(price)) return null;
          // timestamps from yahoo-finance2 are seconds since epoch
          const ms = Number(ts) * 1000;
          return { time: new Date(ms).toISOString(), price };
        }).filter(Boolean);

        function pctSince(minutes) {
          const target = latestTs - minutes * 60;
          // find index with timestamp <= target
          for (let i = latestIndex; i >= 0; i--) {
            if (timestamps[i] <= target) {
              const past = Number(closeArr[i]);
              if (!past || !Number.isFinite(past) || past === 0) return null;
              return ((latestPrice - past) / past) * 100;
            }
          }
          return null;
        }

        return {
          symbol,
          price: latestPrice,
          move1m: pctSince(1),
          move3m: pctSince(3),
          move6m: pctSince(6),
          move10m: pctSince(10),
          prices,
        };
      } catch (e) {
        return { symbol, price: null, move1m: null, move3m: null, move6m: null, move10m: null };
      }
    }));

    res.json({ ok: true, quotes: results });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
});

// Return top candidates from premarket shortlist (NSE / BSE selectors)
app.get('/api/top-nse', async (req, res) => {
  try {
    const n = req.query.n ? Number(req.query.n) : 10;
    const data = await runPremarketShortlist();
    const symbols = (data?.longCandidates || []).map(c => c.symbol).filter(Boolean).slice(0, n);
    res.json({ ok: true, source: 'premarket.longCandidates', symbols });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
});

app.get('/api/top-bse', async (req, res) => {
  try {
    const n = req.query.n ? Number(req.query.n) : 10;
    const data = await runPremarketShortlist();
    // use shortCandidates as a proxy for alternate list
    const symbols = (data?.shortCandidates || []).map(c => c.symbol).filter(Boolean).slice(0, n);
    res.json({ ok: true, source: 'premarket.shortCandidates', symbols });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || String(err) });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`Groww paper-trading app running on http://localhost:${PORT}`);
  notifierState.lastNotifiedTradeCount = getSnapshot()?.summary?.totalTrades || 0;
  await refreshStrategyMonitor();
  await startEngine(10000, async ({ snapshot }) => {
    await sendNotificationsForLatestCycle(snapshot, "auto-cycle");
  });


  // Auto square-off window: attempt to sell profitable open positions before market close
  // Runs every minute between 14:00 and 15:00 IST by default (one hour prior to market close)
  setInterval(async () => {
    try {
      const now = new Date();
      const hours = now.getHours();
      if (hours >= 14 && hours < 15) {
        const snapshot = getSnapshot();
        const openPositions = Array.isArray(snapshot?.openPositions) ? snapshot.openPositions : [];
        const chartMap = snapshot?.charts || {};
        const selectedMap = (Array.isArray(snapshot?.selected) ? snapshot.selected : []).reduce((m, item) => {
          if (item && item.symbol) m[item.symbol] = item;
          return m;
        }, {});

        const sold = [];
        for (const pos of openPositions) {
          try {
            const symbol = pos.symbol;
            const entryPrice = Number(pos.entryPrice || 0);
            const remainingUnits = Number(pos.remainingUnits || pos.units || 0);
            const sideMultiplier = String(pos.side || 'LONG') === 'SHORT' ? -1 : 1;
            if (!symbol || !Number.isFinite(entryPrice) || !Number.isFinite(remainingUnits) || remainingUnits <= 0) {
              continue;
            }

            // determine current price from snapshot charts or selected list
            let currentPrice = null;
            const chart = chartMap[symbol];
            if (chart && Array.isArray(chart.prices) && chart.prices.length > 0) {
              const last = chart.prices[chart.prices.length - 1];
              currentPrice = Number(last?.price);
            }
            if ((!Number.isFinite(currentPrice) || currentPrice <= 0) && selectedMap[symbol]) {
              currentPrice = Number(selectedMap[symbol].currentPrice);
            }

            if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
              continue;
            }

            const pnl = (currentPrice - entryPrice) * remainingUnits * sideMultiplier;
            if (pnl > 0) {
              await forceSellActiveTradeBySymbol(symbol, "Auto square-off: exiting profitable position before market close");
              sold.push({ symbol, pnl: round2(pnl) });
            }
          } catch (inner) {
            console.warn('Failed to evaluate/sell position during auto-squareoff:', inner && inner.message ? inner.message : inner);
          }
        }

        if (sold.length > 0) {
          await sendNotificationsForLatestCycle(getSnapshot(), "auto-squareoff-profitable");
        }
      }
    } catch (err) {
      console.error("Error in auto square-off:", err);
    }
  }, 60000); // check every minute

  setInterval(() => {
    refreshStrategyMonitor().catch(() => {
      // handled in state
    });
  }, 30000);
});
