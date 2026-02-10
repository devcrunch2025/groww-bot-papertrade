const { EMA, RSI } = require('./indicators');

function runEdgeOnHistory(candles) {
    const signals = [];
    let position = null;

    if (candles.length < 120) return signals;

    const closes = candles.map(c => c.close);

    const ema21 = EMA(closes, 21);
    const ema50 = EMA(closes, 50);
    const ema100 = EMA(closes, 100);
    const rsi14 = RSI(closes, 14);

    for (let i = 100; i < candles.length; i++) {
        const c = candles[i];

        // BUY
        if (
            !position &&
            ema21[i] > ema50[i] &&
            c.close > ema100[i] &&
            rsi14[i] > 55 &&
            c.close > c.open
        ) {
            position = c.close;
            signals.push({
                Timestamp: c.time,
                Signal: 'BUY_EDGE',
                Price: c.close
            });
        }

        // SELL
        if (
            position &&
            (ema21[i] < ema50[i] || rsi14[i] < 45)
        ) {
            signals.push({
                Timestamp: c.time,
                Signal: 'SELL_EDGE',
                Price: c.close,
                ProfitOrLoss: (c.close - position).toFixed(2)
            });
            position = null;
        }
    }

    return signals;
}

module.exports = { runEdgeOnHistory };
