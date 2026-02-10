function EMA(values, period) {
    const k = 2 / (period + 1);
    let ema = values[0];
    return values.map(v => {
        ema = v * k + ema * (1 - k);
        return ema;
    });
}

function RSI(values, period = 14) {
    let gains = 0, losses = 0;
    const rsis = Array(values.length).fill(null);

    for (let i = 1; i <= period; i++) {
        const diff = values[i] - values[i - 1];
        diff >= 0 ? gains += diff : losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsis[period] = 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < values.length; i++) {
        const diff = values[i] - values[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
        rsis[i] = 100 - 100 / (1 + avgGain / avgLoss);
    }

    return rsis;
}

module.exports = { EMA, RSI };
