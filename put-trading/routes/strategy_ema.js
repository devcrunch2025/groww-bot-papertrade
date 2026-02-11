const fs = require('fs');
const path = require('path');

module.exports = function (app) {

  app.get('/api/strategy/ema', (req, res) => {

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
      // 1️⃣ READ TICKS (IST – NO TIME SHIFT)
      // --------------------------------------------------
      const lines = fs.readFileSync(logFile, 'utf8').split('\n');
      const ticks = [];

      for (const line of lines) {
        const m = line.match(/\[(.*?)\]\s*Price:\s*([\d.]+)/);
        if (!m) continue;

        ticks.push({
          time: new Date(m[1]).getTime(),  // DO NOT MODIFY TIME
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

        // const minuteBucket = Math.floor(t.time / 60000) * 60000;
        const minuteBucket = Math.floor(t.time / 60000) * 60000+(4*3600000); // 1-minute bucket + IST correction;


        if (!candleMap.has(minuteBucket)) {

          candleMap.set(minuteBucket, {
            time: new Date(minuteBucket).toISOString().slice(0, 19),
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price,
            volume: 1
          });

        } else {

          const c = candleMap.get(minuteBucket);
          c.high = Math.max(c.high, t.price);
          c.low = Math.min(c.low, t.price);
          c.close = t.price;
          c.volume += 1;   // tick count as volume
        }
      }

      const candles = [...candleMap.values()]
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      // --------------------------------------------------
      // 3️⃣ EMA STRATEGY
      // --------------------------------------------------
      const signals = generateEMAStrategy(candles);

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
// EMA STRATEGY (9 EMA / 20 EMA)
// --------------------------------------------------
function generateEMAStrategy(candles) {

  const signals = [];
  let position = null;

  const ema9 = calculateEMA(candles, 9);
  const ema20 = calculateEMA(candles, 20);

  const TARGET = 0.5; // adjust if needed

  for (let i = 21; i < candles.length; i++) {

    const prevFast = ema9[i - 1];
    const prevSlow = ema20[i - 1];
    const currFast = ema9[i];
    const currSlow = ema20[i];

    const price = candles[i].close;

    const volumeUp =
      candles[i].volume > candles[i - 1].volume;

    // ---------------- BUY ----------------
    if (
      !position &&
      prevFast <= prevSlow &&
      currFast > currSlow &&
      price > currFast &&
      price > currSlow &&
      volumeUp
    ) {
      position = {
        entryPrice: price
      };

      signals.push({
        Timestamp: candles[i].time,
        Signal: "BUY_SIMPLE",
        Price: price
      });

      continue;
    }

    // ---------------- SELL ----------------
    if (position) {

      const pnl = price - position.entryPrice;

      const crossDown =
        prevFast >= prevSlow &&
        currFast < currSlow;

      const targetHit = pnl >= TARGET;

      if (crossDown || targetHit) {

        signals.push({
          Timestamp: candles[i].time,
          Signal: "SELL_SIMPLE",
          Price: price,
          ProfitOrLoss: pnl.toFixed(2)
        });

        position = null;
      }
    }
  }

  return signals;
}



// --------------------------------------------------
// EMA CALCULATION
// --------------------------------------------------
function calculateEMA(candles, period) {

  const k = 2 / (period + 1);
  const ema = [];

  let prevEma = candles[0].close;
  ema.push(prevEma);

  for (let i = 1; i < candles.length; i++) {

    const close = candles[i].close;
    const currentEma = close * k + prevEma * (1 - k);

    ema.push(currentEma);
    prevEma = currentEma;
  }

  return ema;
}
