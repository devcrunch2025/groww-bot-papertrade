require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- SETTINGS ---
const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;
const STOCK = 'NSE_RELIANCE';

const FETCH_INTERVAL = 10 * 1000;       // 10 sec
const CANDLE_INTERVAL = 3 * 60 * 1000;  // 3 minutes

// --- LOG DIRECTORY ---
const LOG_DIR = 'logs';
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
}

// --- FILE NAME HELPERS ---
function getDate() {
    return new Date().toISOString().split('T')[0];
}

function getTickFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}_ticks.json`);
}

function getCandleFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}_candles.json`);
}

function getTimeFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}_time.json`);
}

function getLogFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}.log`);
}

// --- DEBUG LOG ---
function logDebug(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(getLogFile(), line);
    console.log(msg);
}

// --- INIT FILES ---
function initFiles() {
    const tickFile = getTickFile();
    const candleFile = getCandleFile();
    const timeFile = getTimeFile();

    if (!fs.existsSync(tickFile)) {
        fs.writeFileSync(tickFile, JSON.stringify([]));
    }

    if (!fs.existsSync(candleFile)) {
        fs.writeFileSync(candleFile, JSON.stringify([]));
    }

    if (!fs.existsSync(timeFile)) {
        fs.writeFileSync(timeFile, JSON.stringify({ time: Date.now() }));
    }
}

// --- FILE HELPERS ---
function readJSON(file) {
    return JSON.parse(fs.readFileSync(file));
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// --- API FETCH ---
async function fetchLivePrice() {
    try {
        const symbol = STOCK.replace('NSE_', '');
        const url = `https://api.groww.in/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=${symbol}`;

        //logDebug(`API REQUEST → ${url}`);

        const response = await axios.get(url, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'X-API-VERSION': '1.0'
            }
        });

        //logDebug(`API RESPONSE → ${JSON.stringify(response.data)}`);

        if (response.data.status !== 'SUCCESS') {
            logDebug('API returned error status');
            return;
        }

        const price = response.data.payload.last_price;
        logDebug(`Live price: ${price}`);

        const tickFile = getTickFile();
        let ticks = readJSON(tickFile);

        ticks.push({
            time: new Date().toISOString(),
            price: price
        });

        writeJSON(tickFile, ticks);

        checkCandle();

    } catch (err) {
        logDebug(`API error ❌ ${err.message}`);
    }
}

// --- CANDLE CREATION ---
function checkCandle() {
    const now = Date.now();
    const timeFile = getTimeFile();
    const tickFile = getTickFile();
    const candleFile = getCandleFile();

    const lastTime = readJSON(timeFile).time;
    const ticks = readJSON(tickFile);

    if (now - lastTime >= CANDLE_INTERVAL && ticks.length > 0) {
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

        logDebug(`New 3-min candle → ${JSON.stringify(candle)}`);

        let candles = readJSON(candleFile);
        candles.push(candle);
        writeJSON(candleFile, candles);

        // reset ticks
        writeJSON(tickFile, []);
        writeJSON(timeFile, { time: now });
    }
}

// --- START ---
console.log("Live JSON Candle Bot Started...");
initFiles();
fetchLivePrice(); // immediate fetch
setInterval(fetchLivePrice, FETCH_INTERVAL);
