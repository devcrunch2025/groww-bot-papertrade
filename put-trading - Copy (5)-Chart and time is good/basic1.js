require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createObjectCsvWriter } = require('csv-writer');

// --- SETTINGS ---
const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;
const STOCK = 'NSE_TATASTEEL'; // Change this to your desired stock symbol
const FETCH_INTERVAL = 10 * 1000;       // 10 sec
const CANDLE_INTERVAL = 3 * 60 * 1000;  // 3 minutes

// --- EMAIL SETTINGS ---
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;
const EMAIL_TO = process.env.EMAIL_RECIPIENT;

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// --- LOG DIRECTORY ---
const LOG_DIR = 'logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

// --- FILE NAME HELPERS ---
function getDate() { return new Date().toISOString().split('T')[0]; }
function getTickFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_ticks.json`); }
function getCandleFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_candles.json`); }
function getTimeFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_time.json`); }
function getLogFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}.log`); }
function getCSVFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_signals.csv`); }

// --- DEBUG LOG ---
function logDebug(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(getLogFile(), line);
    console.log(msg);
}

// --- EMAIL ALERT ---
function sendEmail(subject, body) {
    const mailOptions = { from: EMAIL_USER, to: EMAIL_TO, subject, text: body };
    transporter.sendMail(mailOptions, (err) => {
        if (err) logDebug(`Email Error ❌ ${err.message}`);
        else logDebug(`Email sent ✅ | ${subject}`);
    });
}

// --- CSV WRITER ---
const csvWriter = createObjectCsvWriter({
    path: getCSVFile(),
    header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'signal', title: 'Signal' },
        { id: 'price', title: 'Price' },
        { id: 'profitOrLoss', title: 'ProfitOrLoss' }
    ],
    append: fs.existsSync(getCSVFile())
});

// --- PAPER TRADING STATE ---
let lastBuyPrice = null;

// --- INIT FILES ---
function initFiles() {
    if (!fs.existsSync(getTickFile())) writeJSON(getTickFile(), []);
    if (!fs.existsSync(getCandleFile())) writeJSON(getCandleFile(), []);
    if (!fs.existsSync(getTimeFile())) writeJSON(getTimeFile(), { time: Date.now() });
    if (!fs.existsSync(getCSVFile())) fs.writeFileSync(getCSVFile(), '');
}

// --- FILE HELPERS ---
function readJSON(file) { return JSON.parse(fs.readFileSync(file)); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// --- LOG SIGNAL TO CSV ---
function logCSV(signal, price, profitOrLoss = '') {
    csvWriter.writeRecords([{ timestamp: new Date().toISOString(), signal, price, profitOrLoss }])
        .catch(err => logDebug(`CSV write error ❌ ${err.message}`));
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
            logDebug('API returned error status');
            sendEmail('API ERROR', `API returned error status for ${STOCK}`);
            return;
        }

        const price = response.data.payload.last_price;
        logDebug(`Live price: ${price}`);

        const ticks = readJSON(getTickFile());
        ticks.push({ time: new Date().toISOString(), price });
        writeJSON(getTickFile(), ticks);

        checkCandle();

    } catch (err) {
        logDebug(`API error ❌ ${err.message}`);
        sendEmail('API ERROR', `Error fetching price for ${STOCK}: ${err.message}`);
    }
}

// --- CANDLE CREATION AND SIGNALS ---
function checkCandle() {
    const now = Date.now();
    const lastTime = readJSON(getTimeFile()).time;
    const ticks = readJSON(getTickFile());

    if (now - lastTime >= CANDLE_INTERVAL && ticks.length > 0) {
        const prices = ticks.map(t => t.price);
        const open = prices[0];
        const close = prices[prices.length - 1];
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

        const candle = { time: new Date().toISOString(), open, high, low, close, average: avg.toFixed(2) };
        logDebug(`New 3-min candle → ${JSON.stringify(candle)}`);

        const candleFile = getCandleFile();
        const candles = readJSON(candleFile);
        candles.push(candle);
        writeJSON(candleFile, candles);

        // --- BUY / SELL SIGNAL ---
        if (candles.length >= 3) {
            const last3 = candles.slice(-3);
            const prevClose1 = last3[0].close;
            const prevClose2 = last3[1].close;
            const currClose = last3[2].close;

            // BUY: last 2 candles rising
            if (prevClose1 < prevClose2 && prevClose2 < currClose) {
                logDebug(`BUY SIGNAL | Last 2 candles rising`);
                sendEmail('BUY SIGNAL', `BUY signal for ${STOCK} at price ${currClose}`);
                lastBuyPrice = currClose; // store buy price for P&L
                logCSV('BUY', currClose);
            }

            // SELL: last candle falling
            if (prevClose2 > currClose && lastBuyPrice !== null) {
                const profit = (currClose - lastBuyPrice).toFixed(2);
                logDebug(`SELL SIGNAL | Last candle fell | Profit/Loss: ${profit}`);
                sendEmail('SELL SIGNAL', `SELL signal for ${STOCK} at price ${currClose} | P/L: ${profit}`);
                logCSV('SELL', currClose, profit);
                lastBuyPrice = null; // reset after sell
            }
        }

        // reset ticks
        writeJSON(getTickFile(), []);
        writeJSON(getTimeFile(), { time: now });
    }
}

// --- SEND HOURLY CSV REPORT ---
function sendCSVHourly() {
    const csvFile = getCSVFile();
    if (!fs.existsSync(csvFile)) {
        logDebug('CSV file not found for hourly email.');
        return;
    }

    const subject = `Paper Trading Report - ${STOCK} - ${getDate()}`;
    const body = `Attached is the paper trading CSV for ${STOCK} as of ${new Date().toISOString()}.`;

    transporter.sendMail({
        from: EMAIL_USER,
        to: EMAIL_TO,
        subject,
        text: body,
        attachments: [{ filename: path.basename(csvFile), path: csvFile }]
    }, (err) => {
        if (err) logDebug(`Hourly CSV email failed ❌ ${err.message}`);
        else logDebug('Hourly CSV email sent ✅');
    });
}

// --- START BOT ---
console.log("Live JSON Candle Bot with BUY/SELL + P&L CSV + Hourly Email Started...");
initFiles();
fetchLivePrice(); // first fetch immediately
setInterval(fetchLivePrice, FETCH_INTERVAL);

// --- Schedule hourly CSV email ---
setInterval(sendCSVHourly, 60 * 60 * 1000); // every 1 hour
