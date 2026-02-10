let edgeTicks = [];
let edgeCandles = [];
let lastCandleTime = null;

const EDGE_INTERVAL = 5 * 60 * 1000; // 5 min

function addTick(price, timestamp) {
    edgeTicks.push({ price, time: timestamp });
}

function buildEdgeCandle(now) {
    if (!edgeTicks.length) return null;

    const prices = edgeTicks.map(t => t.price);

    const candle = {
        time: new Date(now).toISOString(),
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1]
    };

    edgeCandles.push(candle);
    edgeTicks = [];
    lastCandleTime = now;

    return candle;
}

function onTick(price) {
    const now = Date.now();

    if (!lastCandleTime) lastCandleTime = now;

    addTick(price, now);

    if (now - lastCandleTime >= EDGE_INTERVAL) {
        return buildEdgeCandle(now);
    }

    return null;
}

module.exports = {
    onTick,
    getCandles: () => edgeCandles
};
