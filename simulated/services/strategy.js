let lastPrice = null;

function process(data) {
    if (!lastPrice) {
        lastPrice = data.price;
        return null;
    }

    const change = ((data.price - lastPrice) / lastPrice) * 100;

    let action = null;
    if (change >= 1) action = "BUY";
    if (change <= -1) action = "SELL";

    lastPrice = data.price;

    if (action) {
        return {
            symbol: data.symbol,
            action,
            price: data.price,
            time: data.time
        };
    }
    return null;
}

module.exports = { process };