const fs = require('fs');
const path = require('path');

module.exports = function (app) {

  app.get('/api/strategy/edge', (req, res) => {
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
      // 1️⃣ READ TICKS FROM LOG
      // --------------------------------------------------
      const lines = fs.readFileSync(logFile, 'utf8').split('\n');

      const ticks = [];
      for (const line of lines) {
        const m = line.match(/\[(.*?)\]\s*Price:\s*([\d.]+)/);
        if (!m) continue;


         const ms = new Date(m[1]).toISOString().slice(0, 19);;

    // subtract 5 hours 30 minutes
    const corrected = ms ;
        console.log('Parsed tick:', { time: m[1], price: m[2], corrected: new Date(corrected).toISOString() });
     
        ticks.push({
          time:  new Date(m[1]).getTime() ,
          price: parseFloat(m[2])
        });
      }

      if (ticks.length === 0) {
        return res.json({ candles: [] });
      }

      // --------------------------------------------------
      // 2️⃣ BUILD 1-MINUTE CANDLES
      // --------------------------------------------------
      const candleMap = new Map();

      for (const t of ticks) {
        const minuteTs = Math.floor(t.time / 60000) * 60000+(4*3600000); // 1-minute bucket + IST correction

        if (!candleMap.has(minuteTs)) {
          candleMap.set(minuteTs, {
            time: new Date(minuteTs).toISOString().slice(0, 19),
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price
          });
        } else {
          const c = candleMap.get(minuteTs);
          c.high = Math.max(c.high, t.price);
          c.low  = Math.min(c.low, t.price);
          c.close = t.price;
        }
      }

      const candles = [...candleMap.values()]
        .sort((a, b) => new Date(a.time) - new Date(b.time));

      // --------------------------------------------------
      // 3️⃣ RETURN ONLY CANDLES
      // --------------------------------------------------
     // res.json({ candles });

    
function generateEdgeSignals(candles) {
  const signals = [];

  let edgePos = null;
  let pubPos  = null;

  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];

    // =========================
    // EDGE STRATEGY
    // =========================

    // BUY_EDGE → 3 higher closes
    if (
      !edgePos &&
      c0.close < c1.close &&
      c1.close < c2.close
    ) {
      edgePos = {
        entry: c2.close,
        time: c2.time
      };

      signals.push({
        Timestamp: c2.time,
        Signal: 'BUY_EDGE',
        Strategy: 'EDGE',
        Price: c2.close
      });
    }

    // SELL_EDGE → lower close
    else if (
      edgePos &&
      c2.close < c1.close
    ) {
      const pnl = +(c2.close - edgePos.entry).toFixed(2);

      signals.push({
        Timestamp: c2.time,
        Signal: 'SELL_EDGE',
        Strategy: 'EDGE',
        Price: c2.close,
        ProfitOrLoss: pnl
      });

      edgePos = null;
    }

    // =========================
    // PUB STRATEGY
    // =========================

    // BUY_PUB → breakout of previous high
    if (
      !pubPos &&
      c2.high > c1.high
    ) {
      pubPos = {
        entry: c2.close,
        stop: c2.low,
        time: c2.time
      };

      signals.push({
        Timestamp: c2.time,
        Signal: 'BUY_PUB',
        Strategy: 'PUB',
        Price: c2.close
      });
    }

    // SELL_PUB → close below entry candle low
    else if (
      pubPos &&
      c2.close < pubPos.stop
    ) {
      const pnl = +(c2.close - pubPos.entry).toFixed(2);

      signals.push({
        Timestamp: c2.time,
        Signal: 'SELL_PUB',
        Strategy: 'PUB',
        Price: c2.close,
        ProfitOrLoss: pnl
      });

      pubPos = null;
    }
  }

  return signals;
}

const signals = generateEdgeSignals(candles);
res.json({ candles, signals });

} catch (err) {
      console.error('1m candle error:', err);
      res.status(500).json({ error: err.message });
    }
  });

};
