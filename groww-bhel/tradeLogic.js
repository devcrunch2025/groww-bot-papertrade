const { sendEmail } = require("./email");
const { logToCSV, isMarketOpen } = require("./utils");
const { SYMBOL, TARGET_POINTS, STOPLOSS_POINTS, QUANTITY, MARKET_START_HOUR, MARKET_START_MIN, MARKET_END_HOUR, MARKET_END_MIN } = require("./config");

let holding = false;
let entryPremium = 0;
let cash = 100000;

async function handleOption(price, volume = 0, paused=false) {
    if(paused) return;
    if(!isMarketOpen(MARKET_START_HOUR, MARKET_START_MIN, MARKET_END_HOUR, MARKET_END_MIN)) return;

    // Simulate BUY
    if(!holding && Math.random() > 0.7) {
        entryPremium = price;
        holding = true;
        logToCSV(SYMBOL, `${new Date().toISOString()},${SYMBOL},BUY,${price},${QUANTITY},${cash}`);
        await sendEmail("PUT BUY", `BUY ${SYMBOL} @ ${price}`);
    }

    // Simulate SELL
    if(holding){
        const profit = (price - entryPremium) * QUANTITY;
        if(profit >= TARGET_POINTS*QUANTITY || profit <= -STOPLOSS_POINTS*QUANTITY){
            cash += profit;
            holding = false;
            logToCSV(SYMBOL, `${new Date().toISOString()},${SYMBOL},SELL,${price},${QUANTITY},${cash},PROFIT:${profit}`);
            await sendEmail("PUT SELL", `SELL ${SYMBOL} @ ${price} Profit: ${profit}`);
        }
    }
}

module.exports = { handleOption };
