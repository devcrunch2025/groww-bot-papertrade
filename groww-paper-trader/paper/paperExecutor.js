
const logger = require("./logger");
let tradeId = 1;

module.exports.execute = trade => {
  trade.tradeId = tradeId++;
  trade.date = new Date().toISOString().slice(0,10);
  trade.pnl = trade.exit - trade.entry;
  trade.result = trade.pnl > 0 ? "WIN" : "LOSS";
  logger.logTrade(trade);
};
