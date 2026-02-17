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

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`Groww paper-trading app running on http://localhost:${PORT}`);
  notifierState.lastNotifiedTradeCount = getSnapshot()?.summary?.totalTrades || 0;
  await startEngine(10000, async ({ snapshot }) => {
    await sendNotificationsForLatestCycle(snapshot, "auto-cycle");
  });
});
