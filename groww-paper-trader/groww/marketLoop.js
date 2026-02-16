
require("dotenv").config();
const { fetchOHLC } = require("./growwClient");
const { normalize } = require("./normalize");
const strategy = require("../strategy/simpleScalp");
const paper = require("../paper/paperExecutor");

const SYMBOLS = ["NSE_NIFTY50"];

async function loop() {
  try {
    const data = await fetchOHLC(SYMBOLS);
    SYMBOLS.forEach(sym => {
      const candle = normalize(data[sym]);
      const signal = strategy.check(candle);
      if (signal) {
        paper.execute({
          symbol: sym,
          entry: signal.entry,
          exit: signal.exit,
          score: signal.score,
          candles: [candle]
        });
      }
    });
  } catch (e) {
    console.error("Groww error:", e.message);
  }
}

setInterval(loop, 60000);
