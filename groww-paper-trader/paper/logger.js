
const fs = require("fs");
const path = require("path");

module.exports.logTrade = trade => {
  const dir = path.join(__dirname, "../logs/trades", trade.date);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `trade_${trade.tradeId}.json`);
  fs.writeFileSync(file, JSON.stringify(trade, null, 2));
};
