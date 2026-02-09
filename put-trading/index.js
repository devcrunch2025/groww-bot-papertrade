require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

// --- SETTINGS ---
const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;
const STOCK = 'NSE_RELIANCE';

const FETCH_INTERVAL = 10 * 1000;      // 10 sec
const CANDLE_INTERVAL = 3 * 60 * 1000; // 3 minutes

// --- FILE NAME HELPERS ---
function getDate() {
    return new Date().toISOString().split('T')[0];
}

function getTickFile() {
    return `${getDate()}_${STOCK}_ticks.json`;
}

function getTimeFile() {
    return `${getDate()}_${STOCK}_time.json`;
}

// --- INIT FILES ---
function initFiles() {
    const tickFile = getTickFile();
    const timeFile = getTimeFile();

    if (!fs.existsSync(tickFile)) {
        fs.writeFileSync(tickFile, JSON.stringify([]));
    }

    if (!fs.existsSync(timeFile)) {
        fs.writeFileSync(timeFile, JSON.stringify({ time: Date.now() }));
    }
}

// --- FILE HELPERS ---
function readTicks() {
    return JSON.parse(fs.readFileSync(getTickFile()));
}

function writeTicks(data) {
    fs.writeFileSync(getTickFile(), JSON.stringify(data));
}

function getLastCandleTime() {
    return JSON.parse(fs.readFileSync(getTimeFile())).time;
}

function setLastCandleTime(time) {
    fs.writeFileSync(getTimeFile(), JSON.stringify({ time }));
}

// --- API FETCH ---
async function fetchLivePrice() {
    try {
        const symbol = STOCK.replace('NSE_', '');

        const url = `https://api.groww.in/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=${symbol}`;

        const response = await axios.get(url, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'X-API-VERSION': '1.0'
            }
        });

        if (response.data.status !== 'SUCCESS') {
            console.log('API error:', response.data);
            return;
        }

        const price = response.data.payload.last_price;
        console.log("Live price:", price);

        let ticks = readTicks();
        ticks.push({
            time: new Date().toISOString(),
            price: price
        });
        writeTicks(ticks);

        checkCandle();

    } catch (err) {
        console.log("API error:", err.message);
    }
}

// --- CANDLE CREATION ---
function checkCandle() {
    const now = Date.now();
    const lastCandleTime = getLastCandleTime();
    const ticks = readTicks();

    if (now - lastCandleTime >= CANDLE_INTERVAL && ticks.length > 0) {
        const prices = ticks.map(t => t.price);

        const open = prices[0];
        const close = prices[prices.length - 1];
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

        const candle = {
            time: new Date().toISOString(),
            open,
            high,
            low,
            close,
            average: avg.toFixed(2)
        };

        console.log("New 3-min candle:", candle);

        // reset ticks
        writeTicks([]);
        setLastCandleTime(now);
    }
}

// --- START ---
console.log("Live JSON Candle Bot Started...");
initFiles();
fetchLivePrice(); // first fetch
setInterval(fetchLivePrice, FETCH_INTERVAL);
