// ---------------- EMA ----------------
function EMA(values, period) {
    const k = 2 / (period + 1);
    const ema = [];

    let prevEma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    ema[period - 1] = prevEma;

    for (let i = period; i < values.length; i++) {
        const current = values[i] * k + prevEma * (1 - k);
        ema[i] = current;
        prevEma = current;
    }

    return ema;
}

// ---------------- RSI ----------------
function RSI(values, period) {
    const rsi = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const diff = values[i] - values[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    rsi[period] = 100 - (100 / (1 + avgGain / avgLoss));

    for (let i = period + 1; i < values.length; i++) {
        const diff = values[i] - values[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        rsi[i] = avgLoss === 0
            ? 100
            : 100 - (100 / (1 + avgGain / avgLoss));
    }

    return rsi;
}

module.exports = { EMA, RSI };
