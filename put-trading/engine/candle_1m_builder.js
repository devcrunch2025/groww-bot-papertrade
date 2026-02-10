let ticks = [];
let candles = [];
let currentMinute = null;

function onTick(price, timestamp = Date.now()) {
    const minute = Math.floor(timestamp / 60000); // 1-minute bucket

    if (currentMinute === null) {
        currentMinute = minute;
    }

    // Same minute → collect ticks
    if (minute === currentMinute) {
        ticks.push(price);
        return null;
    }

    // Minute changed → build candle
    const candle = {
        time: new Date(currentMinute * 60000).toISOString(),
        open: ticks[0],
        high: Math.max(...ticks),
        low: Math.min(...ticks),
        close: ticks[ticks.length - 1]
    };

    candles.push(candle);

    // reset for new minute
    ticks = [price];
    currentMinute = minute;

    return candle;
}

function getCandles() {
    return candles;
}

function reset() {
    ticks = [];
    candles = [];
    currentMinute = null;
}

module.exports = {
    onTick,
    getCandles,
    reset
};
function build1mCandlesFromTicks(ticks) {
    const buckets = new Map();

    ticks.forEach(t => {
        const ts = new Date(t.time).getTime();
        const minute = Math.floor(ts / 60000) * 60000;

        if (!buckets.has(minute)) {
            buckets.set(minute, []);
        }
        buckets.get(minute).push(t.price);
    });

    const candles = [];

    [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .forEach(([minute, prices]) => {
            candles.push({
                time: new Date(minute).toISOString(),
                open: prices[0],
                high: Math.max(...prices),
                low: Math.min(...prices),
                close: prices[prices.length - 1]
            });
        });

    return candles;
}

module.exports = { build1mCandlesFromTicks };
