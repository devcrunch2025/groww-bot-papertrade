require('dotenv').config();
const priceFeed = require('./services/priceFeed');
const mqttControl = require('./services/mqttControl');
const mailer = require('./services/mailer');
const strategy = require('./services/strategy');

let paused = false;

mqttControl.onControl((cmd) => {
    if (cmd === 'pause') paused = true;
    if (cmd === 'resume') paused = false;
    console.log("Bot state:", paused ? "PAUSED" : "RUNNING");
});

priceFeed.onPrice((data) => {
    if (paused) return;
    try {
        const result = strategy.process(data);
        if (result) {
            mailer.send("Trade Signal", JSON.stringify(result));
        }
    } catch (err) {
        mailer.send("Bot Error", err.message);
    }
});
