const fs = require('fs');
const path = require('path');

module.exports = function (app) {

  app.get('/api/strategy/simple', (req, res) => {

    try {

      const { date, symbol } = req.query;

      if (!date || !symbol) {
        return res.status(400).json({ error: 'date and symbol required' });
      }

      const LOG_DIR = path.join(__dirname, '..', 'logs');
      const logFile = path.join(LOG_DIR, `${date}_${symbol}.log`);

      if (!fs.existsSync(logFile)) {
        return res.status(404).json({ error: 'Log file not found' });
      }

      // --------------------------------------------------
      // 1️⃣ READ TICKS FROM LOG (IST TIME)
      // --------------------------------------------------
      const lines = fs.readFileSync(logFile, 'utf8').split('\n');
      const ticks = [];

      for (const line of lines) {
        const m = line.match(/\[(.*?)\]\s*Price:\s*([\d.]+)/);
        if (!m) continue;

        ticks.push({
          time: new Date(m[1]).getTime(),  // already IST
          price: parseFloat(m[2])
        });
      }

      if (ticks.length === 0) {
        return res.json({ candles: [], signals: [] });
      }

      // --------------------------------------------------
      // 2️⃣ BUILD 1-MINUTE CANDLES
      // --------------------------------------------------
      const candleMap = new Map();

      for (const t of ticks) {

        const minuteBucket = Math.floor(t.time / 60000) * 60000+(4*3600000); // 1-minute bucket + IST correction;

        if (!candleMap.has(minuteBucket)) {

          

          candleMap.set(minuteBucket, {
            time: new Date(minuteBucket).toISOString().slice(0, 19),
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price
          });

        } else {

          const c = candleMap.get(minuteBucket);

          c.high = Math.max(c.high, t.price);
          c.low  = Math.min(c.low, t.price);
          c.close = t.price;
        }
      }

      const candles = [...candleMap.values()]
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      // --------------------------------------------------
      // 3️⃣ SIMPLE STRATEGY
      // BUY: Previous 5 candles up + 6th candle up
      // SELL: 1 bearish candle
      // --------------------------------------------------
      const signals = generateSimpleSignals(candles);

      res.json({
        candles,
        signals
      });

    } catch (err) {
      console.error('Strategy error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};



// --------------------------------------------------
// SIMPLE STRATEGY FUNCTION
// --------------------------------------------------
function generateSimpleSignals(candles) {

  const signals = [];
  let position = null;

  for (let i = 3; i < candles.length; i++) {

    const last6 = candles.slice(i - 3, i + 1);

    const allUp = last6.every(c => c.close > c.open);

    // ---------------- BUY ----------------
    if (!position && allUp) {

      position = {
        entryPrice: candles[i].close
      };

      signals.push({
        Timestamp: candles[i].time,
        Signal: "BUY_SIMPLE",
        Price: candles[i].close
      });
    }

    // ---------------- SELL ----------------
    if (position) {

      const current = candles[i];

      if (current.close < current.open) {

        const pnl = current.close - position.entryPrice;

        signals.push({
          Timestamp: current.time,
          Signal: "SELL_SIMPLE",
          Price: current.close,
          ProfitOrLoss: pnl.toFixed(2)
        });

        position = null;
      }
    }
  }

  return signals;
}
