const fs = require('fs');
const path = require('path');

module.exports = function (app) {

    app.get('/api/strategy/v2', (req, res) => {
        const { date, symbol } = req.query;

        if (!date || !symbol) {
            return res.status(400).json({ error: 'Missing date or symbol' });
        }

        const file = path.join(
            __dirname,
            `../logs/${date}_${symbol}_candles.json`
        );

        if (!fs.existsSync(file)) {
            return res.json({ candles: [], signals: [] });
        }

        const candles = JSON.parse(fs.readFileSync(file));

        // 🔥 APPLY NEW STRATEGY
        const signals = applyNewStrategy(candles);

        res.json({ candles, signals });
    });
};

function applyNewStrategy(candles) {
    const signals = [];
    let position = null;

    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];

        // BUY
        if (!position && curr.close > prev.high) {
            position = curr.close;
            signals.push({
                Timestamp: curr.time,
                Signal: 'BUY_V2',
                Price: curr.close
            });
        }

        // SELL
        if (position && curr.close < prev.low) {
            const pnl = (curr.close - position).toFixed(2);
            signals.push({
                Timestamp: curr.time,
                Signal: 'SELL_V2',
                Price: curr.close,
                ProfitOrLoss: pnl
            });
            position = null;
        }
    }

    return signals;
}
require('./routes/strategy_v2');

