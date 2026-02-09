require('dotenv').config();

const priceFeed = require('./services/growwLiveFeed');
const { handleOption } = require('./tradeLogic');
const { generateDailyGraph } = require('./graph');
const mailer = require('./email');
const mqtt = require('mqtt');
const { MQTT_BROKER, MQTT_TOPIC, SYMBOL } = require('./config');
const cron = require('node-cron');
 
let paused = false;
const client = mqtt.connect(MQTT_BROKER);

client.on('connect', () => client.subscribe(MQTT_TOPIC));
client.on('message', (topic, message) => {
    const msg = message.toString().toLowerCase();
    paused = msg === 'pause' ? true : msg === 'resume' ? false : paused;
});

// Real-time Groww feed
priceFeed.onPrice(async (tick) => {
    if(!paused){
        try {
            await handleOption(tick.price, tick.volume, paused);
        } catch(err) {
            await mailer.sendEmail("Bot Error", err.message);

            
        }
    }
});

// Handle feed errors
priceFeed.onError(async (err) => {
    await mailer.sendEmail("Feed Error", err.message);
});

// Daily graph at 3:00 PM IST
cron.schedule('0 15 * * *', async () => {
    console.log("Generating daily graph...");
    await generateDailyGraph(SYMBOL);
});
