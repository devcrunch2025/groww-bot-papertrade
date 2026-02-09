require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

// --- SETTINGS ---
const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_RECIPIENT = process.env.EMAIL_RECIPIENT;
const PAPER_TRADING = process.env.PAPER_TRADING === 'true';

const STOCKS = ['NSE_RELIANCE', 'BSE_SENSEX'];
const FETCH_INTERVAL = 30 * 1000; // 30 seconds

// PUT Option parameters
const optionPremium = 5.0;
const targetPoints = 2.0;
const stopLossPoints = 1.0;

// --- Trade & history tracking ---
let activeTrade = null;
let priceHistory = {};
let volumeHistory = {};

// --- Gmail SMTP ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// --- DEBUG LOG ---
function logDebug(stock, msg) {
    const date = new Date().toISOString().split('T')[0];
    const logFile = `${date}_${stock}.log`;
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
}

// --- CSV LOG ---
function logCSV(stock, signal, value, timestamp) {
    const date = new Date().toISOString().split('T')[0];
    const fileName = `${date}_${stock}.csv`;
    const csvWriter = createCsvWriter({
        path: fileName,
        header: [
            { id: 'timestamp', title: 'Timestamp' },
            { id: 'signal', title: 'Signal' },
            { id: 'value', title: 'Value' }
        ],
        append: fs.existsSync(fileName)
    });
    csvWriter.writeRecords([{ timestamp, signal, value }])
        .catch(err => logDebug(stock, `CSV write error: ${err.message}`));
}

// --- EMAIL ---
function sendEmail(stock, signal, value, timestamp) {
    if (PAPER_TRADING) return; // skip normal emails in paper-trading
    transporter.sendMail({
        from: `"PUT Bot" <${EMAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Trading Signal: ${signal} - ${stock}`,
        text: `${timestamp} | ${signal} | ${stock} | Value: ${value}`
    }, (err) => {
        if (err) logDebug(stock, `Email failed: ${err.message}`);
        else logDebug(stock, `Email sent: ${signal} | ${stock}`);
    });
}

// --- ERROR EMAIL ---
function sendErrorEmail(stock, errorMsg) {
    transporter.sendMail({
        from: `"PUT Bot Error" <${EMAIL_USER}>`,
        to: EMAIL_RECIPIENT,
        subject: `Trading Bot ERROR - ${stock}`,
        text: `[${new Date().toISOString()}] ${errorMsg}`
    }, (err) => {
        if (err) logDebug(stock, `Error email failed: ${err.message}`);
        else logDebug(stock, `Error email sent: ${errorMsg}`);
    });
}

// --- MARKET HOURS ---
function isMarketOpen() {
    const now = new Date();
    const istOffset = 5.5 * 60;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utc + istOffset * 60000);
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    const currentTime = hours * 60 + minutes;
    return currentTime >= 9 * 60 + 15 && currentTime <= 15 * 60; // 9:15 - 15:00 IST
}

// --- RESET TRADES ---
let lastResetDate = null;
function resetTradesIfMarketOpen() {
    const now = new Date();
    const istOffset = 5.5 * 60;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utc + istOffset * 60000);
    const hours = ist.getHours();
    const minutes = ist.getMinutes();
    const currentTime = hours * 60 + minutes;
    const dateStr = ist.toISOString().split('T')[0];

    if (currentTime === 9 * 60 + 15 && lastResetDate !== dateStr) {
        activeTrade = null;
        lastResetDate = dateStr;
        STOCKS.forEach(stock => logDebug(stock, 'Market open - Active trades reset.'));
    }
}

// --- VERIFY API TOKEN ---
async function verifyAPIToken() {
    try {
        const response = await axios.get('https://api.groww.in/v1/live-data/ohlc', {
            params: { segment: 'CASH', exchange_symbols: STOCKS.join(',') },
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'X-API-VERSION': '1.0'
            }
        });
        if (response.data.status === 'SUCCESS') {
            STOCKS.forEach(stock => logDebug(stock, 'API Token Verified ✅'));
            return true;
        } else {
            const msg = `API Token Failed ❌ | Response: ${JSON.stringify(response.data)}`;
            STOCKS.forEach(stock => logDebug(stock, msg));
            STOCKS.forEach(stock => sendErrorEmail(stock, msg));
            return false;
        }
    } catch (err) {
        const msg = `API Token Error ❌ | ${err.message}`;
        STOCKS.forEach(stock => logDebug(stock, msg));
        STOCKS.forEach(stock => sendErrorEmail(stock, msg));
        return false;
    }
}

// --- FETCH LIVE DATA ---
async function fetchLiveData() {
    const timestamp = new Date().toISOString();
    try {
        const response = await axios.get('https://api.groww.in/v1/live-data/ohlc', {
            params: { segment: 'CASH', exchange_symbols: STOCKS.join(',') },
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'X-API-VERSION': '1.0'
            }
        });
        const data = response.data.payload;
        STOCKS.forEach(stock => {
            try {
                processStock(stock, JSON.parse(data[stock]), timestamp);
            } catch (err) {
                const msg = `Processing Error ❌ | ${err.message}`;
                logDebug(stock, msg);
                sendErrorEmail(stock, msg);
            }
        });
    } catch (err) {
        const msg = `API fetch error ❌ | ${err.message}`;
        STOCKS.forEach(stock => logDebug(stock, msg));
        STOCKS.forEach(stock => sendErrorEmail(stock, msg));
    }
}

// --- PROCESS STOCK DATA ---
function processStock(stock, ohlc, timestamp) {
    if (!priceHistory[stock]) priceHistory[stock] = [];
    if (!volumeHistory[stock]) volumeHistory[stock] = [];

    priceHistory[stock].push(ohlc.close);
    volumeHistory[stock].push(ohlc.volume || Math.floor(Math.random() * 5000));

    if (priceHistory[stock].length > 20) priceHistory[stock].shift();
    if (volumeHistory[stock].length > 20) volumeHistory[stock].shift();

    logDebug(stock, `Price: ${ohlc.close} | Volume: ${ohlc.volume}`);
    checkPUTSignal(stock, timestamp, ohlc.close);
    checkSignals(stock, timestamp);
}

// --- PUT ENTRY / EXIT ---
function checkPUTSignal(stock, timestamp, currentPrice) {
    try {
        const prices = priceHistory[stock];
        if (prices.length < 5) return;

        const last5 = prices.slice(-5);
        const priceDown = last5.every((p, i, arr) => i === 0 || p <= arr[i - 1]);

        if (!activeTrade && priceDown) {
            activeTrade = { entryTime: timestamp, stock, entryPremium: optionPremium };
            logDebug(stock, `PUT ENTRY | Premium: ${optionPremium}`);
            sendEmail(stock, 'PUT ENTRY', optionPremium, timestamp);
            logCSV(stock, 'PUT ENTRY', optionPremium, timestamp);
        }

        if (activeTrade && activeTrade.stock === stock) {
            const profit = optionPremium - activeTrade.entryPremium;
            if (profit >= targetPoints) {
                logDebug(stock, `PUT EXIT | TARGET HIT`);
                sendEmail(stock, 'PUT EXIT TARGET', optionPremium, timestamp);
                logCSV(stock, 'PUT EXIT TARGET', optionPremium, timestamp);
                activeTrade = null;
            } else if (profit <= -stopLossPoints) {
                logDebug(stock, `PUT EXIT | STOP LOSS`);
                sendEmail(stock, 'PUT EXIT STOP', optionPremium, timestamp);
                logCSV(stock, 'PUT EXIT STOP', optionPremium, timestamp);
                activeTrade = null;
            }
        }
    } catch (err) {
        const msg = `PUT Processing Error ❌ | ${err.message}`;
        logDebug(stock, msg);
        sendErrorEmail(stock, msg);
    }
}

// --- BUY/SELL CALL SIGNALS ---
function checkSignals(stock, timestamp) {
    try {
        const prices = priceHistory[stock];
        const volumes = volumeHistory[stock];
        if (prices.length < 2) return;

        const currentPrice = prices[prices.length - 1];
        const currentVol = volumes[volumes.length - 1];
        const maxVol = Math.max(...volumes);
        const minPriceLast10 = Math.min(...prices);

        // Volume signals
        if (currentVol >= maxVol) {
            logDebug(stock, `SELL_CALL | Volume: ${currentVol}`);
            sendEmail(stock, 'SELL_CALL', currentPrice, timestamp);
            logCSV(stock, 'SELL_CALL', currentPrice, timestamp);
        } else if (currentVol < maxVol && currentPrice > minPriceLast10) {
            logDebug(stock, `BUY_CALL | Volume: ${currentVol}`);
            sendEmail(stock, 'BUY_CALL', currentPrice, timestamp);
            logCSV(stock, 'BUY_CALL', currentPrice, timestamp);
        }

        // Price trend signals
        if (prices.length >= 10) {
            const last10 = prices.slice(-10);
            const increasing = last10.every((p, i, arr) => i === 0 || p >= arr[i - 1]);
            if (increasing) {
                logDebug(stock, `BUY_CALL | Price increasing 5 minutes`);
                sendEmail(stock, 'BUY_CALL', currentPrice, timestamp);
                logCSV(stock, 'BUY_CALL', currentPrice, timestamp);
            }
        }
        if (prices.length >= 4) {
            const last4 = prices.slice(-4);
            const decreasing = last4.every((p, i, arr) => i === 0 || p <= arr[i - 1]);
            if (decreasing) {
                logDebug(stock, `SELL_CALL | Price decreasing 2 minutes`);
                sendEmail(stock, 'SELL_CALL', currentPrice, timestamp);
                logCSV(stock, 'SELL_CALL', currentPrice, timestamp);
            }
        }
    } catch (err) {
        const msg = `Signal Processing Error ❌ | ${err.message}`;
        logDebug(stock, msg);
        sendErrorEmail(stock, msg);
    }
}

// --- RUN BOT ---
async function runBot() {
    resetTradesIfMarketOpen();
    if (isMarketOpen()) {
        fetchLiveData();
    } else {
        STOCKS.forEach(stock => logDebug(stock, 'Market closed - skipping fetch.'));
    }
}

// --- START BOT ONLY IF API IS WORKING ---
console.log('PUT + Volume Bot Starting...');
verifyAPIToken().then(valid => {
    if (valid) {
        console.log('API Token valid. Bot started.');
        runBot();
        setInterval(runBot, FETCH_INTERVAL);
    } else {
        console.log('API Token invalid. Check ACCESS_TOKEN. Bot not started.');
    }
});
