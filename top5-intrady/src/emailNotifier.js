const nodemailer = require("nodemailer");

const EMAIL_NOTIFY_ENABLED = String(process.env.EMAIL_NOTIFY_ENABLED || "false").toLowerCase() === "true";
const EMAIL_CYCLE_UPDATES_ENABLED = String(process.env.EMAIL_CYCLE_UPDATES_ENABLED || "true").toLowerCase() === "true";
const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS || "";
const GMAIL_TO = process.env.GMAIL_TO || GMAIL_USER;

let transport = null;

function isConfigured() {
  return EMAIL_NOTIFY_ENABLED && Boolean(GMAIL_USER) && Boolean(GMAIL_APP_PASS) && Boolean(GMAIL_TO);
}

function getTransport() {
  if (!isConfigured()) {
    return null;
  }

  if (!transport) {
    transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASS,
      },
    });
  }

  return transport;
}

function toLocalTimeString(value) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(value ? new Date(value) : new Date());
}

async function sendMail(subject, text) {
  const client = getTransport();
  if (!client) {
    return false;
  }

  await client.sendMail({
    from: GMAIL_USER,
    to: GMAIL_TO,
    subject,
    text,
  });

  return true;
}

function formatTrade(trade) {
  const pnlText = typeof trade.pnl === "number" ? ` | PnL: ₹${trade.pnl.toFixed(2)}` : "";
  return [
    `${trade.action} ${trade.symbol}`,
    `Price: ₹${trade.price}`,
    `Units: ${trade.units}`,
    `Time: ${toLocalTimeString(trade.time)}`,
    `Reason: ${trade.reason}`,
  ].join(" | ") + pnlText;
}

async function sendTradeNotifications(trades = [], snapshot) {
  if (!isConfigured() || !Array.isArray(trades) || trades.length === 0) {
    return;
  }

  for (const trade of trades) {
    const subject = `[PaperTrade] ${trade.action} ${trade.symbol} @ ₹${trade.price}`;
    const text = [
      "Trade alert",
      "",
      formatTrade(trade),
      "",
      `Total Trades: ${snapshot?.summary?.totalTrades ?? "-"}`,
      `Open Positions: ${snapshot?.summary?.openPositions ?? "-"}`,
      `Realized PnL: ₹${snapshot?.summary?.realizedPnl ?? "-"}`,
    ].join("\n");

    try {
      await sendMail(subject, text);
    } catch (error) {
      console.error("Trade notification email failed:", error.message || String(error));
    }
  }
}

async function sendCycleHeartbeat(snapshot, context = "auto") {
  if (!isConfigured() || !EMAIL_CYCLE_UPDATES_ENABLED) {
    return;
  }

  const subject = `[PaperTrade] Cycle update (${context})`;
  const text = [
    "Cycle heartbeat",
    "",
    `Run Time (IST): ${toLocalTimeString(snapshot?.status?.lastRun)}`,
    `Cycle Count: ${snapshot?.status?.cycleCount ?? "-"}`,
    `Daily Loss Cutoff Hit: ${snapshot?.status?.dailyLossCutoffHit ? "Yes" : "No"}`,
    `Selected Symbols: ${(snapshot?.selected || []).map((item) => item.symbol).join(", ") || "-"}`,
    `Open Positions: ${snapshot?.summary?.openPositions ?? "-"}`,
    `Realized PnL: ₹${snapshot?.summary?.realizedPnl ?? "-"}`,
    `Last Error: ${snapshot?.status?.lastError || "None"}`,
  ].join("\n");

  try {
    await sendMail(subject, text);
  } catch (error) {
    console.error("Cycle heartbeat email failed:", error.message || String(error));
  }
}

async function sendTestEmail(message = "Test email from paper-trading bot") {
  if (!isConfigured()) {
    throw new Error("Email notifier is not configured. Check EMAIL_NOTIFY_ENABLED, GMAIL_USER, GMAIL_APP_PASS, GMAIL_TO");
  }

  const subject = "[PaperTrade] Test Email";
  const text = [
    "Gmail integration test successful.",
    "",
    `Message: ${message}`,
    `Time (IST): ${toLocalTimeString(new Date())}`,
  ].join("\n");

  await sendMail(subject, text);
  return true;
}

function getNotificationConfig() {
  return {
    enabled: EMAIL_NOTIFY_ENABLED,
    cycleUpdatesEnabled: EMAIL_CYCLE_UPDATES_ENABLED,
    configured: isConfigured(),
    to: GMAIL_TO || null,
  };
}

module.exports = {
  getNotificationConfig,
  sendTradeNotifications,
  sendCycleHeartbeat,
  sendTestEmail,
};
