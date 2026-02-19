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

async function sendMail(subject, text, html) {
  const client = getTransport();
  if (!client) {
    return false;
  }

  await client.sendMail({
    from: GMAIL_USER,
    to: GMAIL_TO,
    subject,
    text,
    html: html || text,
  });

  return true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTableHtml(title, rows) {
  const tableRows = rows
    .map(({ label, value }) => `
      <tr>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;background:#f8fafc;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:8px 10px;border:1px solid #e5e7eb;">${escapeHtml(value)}</td>
      </tr>
    `)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;font-size:13px;color:#111827;">
      <h2 style="margin:0 0 10px 0;font-size:16px;color:#111827;">${escapeHtml(title)}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:720px;">
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function formatTrade(trade) {
  const investedAmount = Number(trade?.price) * Number(trade?.units);
  const investedText = Number.isFinite(investedAmount) ? ` | Invested: ₹${investedAmount.toFixed(2)}` : "";
  const pnlText = typeof trade.pnl === "number" ? ` | PnL: ₹${trade.pnl.toFixed(2)}` : "";
  return [
    `${trade.action} ${trade.symbol}`,
    `Price: ₹${trade.price}`,
    `Units: ${trade.units}`,
    `Time: ${toLocalTimeString(trade.time)}`,
    `Reason: ${trade.reason}`,
  ].join(" | ") + investedText + pnlText;
}

function getStrategyLabel(snapshot) {
  return snapshot?.status?.activeStrategyId || "-";
}

async function sendTradeNotifications(trades = [], snapshot) {
  if (!isConfigured() || !Array.isArray(trades) || trades.length === 0) {
    return;
  }

  for (const trade of trades) {
    const investedAmount = Number(trade?.price) * Number(trade?.units);
    const investedAmountText = Number.isFinite(investedAmount) ? `₹${investedAmount.toFixed(2)}` : "-";
    const subject = `[PaperTrade] ${trade.action} ${trade.symbol} @ ₹${trade.price}`;
    const text = [
      "Trade alert",
      "",
      formatTrade(trade),
      "",
      `Strategy: ${getStrategyLabel(snapshot)}`,
      `Invested Amount: ${investedAmountText}`,
      `Total Trades: ${snapshot?.summary?.totalTrades ?? "-"}`,
      `Open Positions: ${snapshot?.summary?.openPositions ?? "-"}`,
      `Realized PnL: ₹${snapshot?.summary?.realizedPnl ?? "-"}`,
    ].join("\n");

    const html = buildTableHtml("Trade Alert", [
      { label: "Strategy", value: getStrategyLabel(snapshot) },
      { label: "Action", value: trade.action || "-" },
      { label: "Symbol", value: trade.symbol || "-" },
      { label: "Price", value: `₹${trade.price ?? "-"}` },
      { label: "Units", value: trade.units ?? "-" },
      { label: "Invested Amount", value: investedAmountText },
      { label: "Time (IST)", value: toLocalTimeString(trade.time) },
      { label: "Reason", value: trade.reason || "-" },
      { label: "Trade PnL", value: typeof trade.pnl === "number" ? `₹${trade.pnl.toFixed(2)}` : "-" },
      { label: "Total Trades", value: snapshot?.summary?.totalTrades ?? "-" },
      { label: "Open Positions", value: snapshot?.summary?.openPositions ?? "-" },
      { label: "Realized PnL", value: `₹${snapshot?.summary?.realizedPnl ?? "-"}` },
    ]);

    try {
      await sendMail(subject, text, html);
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
    `Strategy: ${getStrategyLabel(snapshot)}`,
    `Run Time (IST): ${toLocalTimeString(snapshot?.status?.lastRun)}`,
    `Cycle Count: ${snapshot?.status?.cycleCount ?? "-"}`,
    `Daily Loss Cutoff Hit: ${snapshot?.status?.dailyLossCutoffHit ? "Yes" : "No"}`,
    `Selected Symbols: ${(snapshot?.selected || []).map((item) => item.symbol).join(", ") || "-"}`,
    `Open Positions: ${snapshot?.summary?.openPositions ?? "-"}`,
    `Invested Amount: ₹${snapshot?.summary?.todayInvestedAmount ?? "-"}`,
    `Realized PnL: ₹${snapshot?.summary?.realizedPnl ?? "-"}`,
    `Last Error: ${snapshot?.status?.lastError || "None"}`,
  ].join("\n");

  const html = buildTableHtml(`Cycle Heartbeat (${context})`, [
    { label: "Strategy", value: getStrategyLabel(snapshot) },
    { label: "Run Time (IST)", value: toLocalTimeString(snapshot?.status?.lastRun) },
    { label: "Cycle Count", value: snapshot?.status?.cycleCount ?? "-" },
    { label: "Daily Loss Cutoff Hit", value: snapshot?.status?.dailyLossCutoffHit ? "Yes" : "No" },
    { label: "Selected Symbols", value: (snapshot?.selected || []).map((item) => item.symbol).join(", ") || "-" },
    { label: "Open Positions", value: snapshot?.summary?.openPositions ?? "-" },
    { label: "Invested Amount", value: `₹${snapshot?.summary?.todayInvestedAmount ?? "-"}` },
    { label: "Realized PnL", value: `₹${snapshot?.summary?.realizedPnl ?? "-"}` },
    { label: "Last Error", value: snapshot?.status?.lastError || "None" },
  ]);

  try {
    await sendMail(subject, text, html);
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

  const html = buildTableHtml("Gmail Integration Test", [
    { label: "Message", value: message },
    { label: "Time (IST)", value: toLocalTimeString(new Date()) },
    { label: "Status", value: "Successful" },
  ]);

  await sendMail(subject, text, html);
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
