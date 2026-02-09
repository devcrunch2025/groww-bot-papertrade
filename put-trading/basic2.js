require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createObjectCsvWriter } = require('csv-writer');

// --- SETTINGS ---
const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;
const STOCK = 'NSE_RELIANCE';
const FETCH_INTERVAL = 10 * 1000;
const CANDLE_INTERVAL = 3 * 60 * 1000;

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

// --- FILE HELPERS ---
function getDate() { return new Date().toISOString().split('T')[0]; }
function getTickFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_ticks.json`); }
function getCandleFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_candles.json`); }
function getTimeFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_time.json`); }
function getLogFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}.log`); }
function getCSVFile() { return path.join(LOG_DIR, `${getDate()}_${STOCK}_signals.csv`); }

function logDebug(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(getLogFile(), line);
    console.log(msg);
}

// --- EMAIL ---
function sendEmail(subject, body) {
    transporter.sendMail({
        from: EMAIL_USER,
        to: EMAIL_TO,
        subject,
        text: body
    }, (err) => {
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

// --- TRADING STATE ---
let position = null; // { entryPrice, qty }

// --- INIT ---
function initFiles() {
    if (!fs.existsSync(getTickFile())) writeJSON(getTickFile(), []);
    if (!fs.existsSync(getCandleFile())) writeJSON(getCandleFile(), []);
    if (!fs.existsSync(getTimeFile())) writeJSON(getTimeFile(), { time: Date.now() });
    if (!fs.existsSync(getCSVFile())) fs.writeFileSync(getCSVFile(), '');
}

function readJSON(file) { return JSON.parse(fs.readFileSync(file)); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function logCSV(signal, price, profitOrLoss = '') {
    csvWriter.writeRecords([{
        timestamp: new Date().toISOString(),
        signal,
        price,
        profitOrLoss
    }]).catch(err => logDebug(`CSV write error ❌ ${err.message}`));
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
        sendEmail('API ERROR', err.message);
    }
}

// --- CANDLE + TRADING LOGIC ---
function checkCandle() {
    const now = Date.now();
    const lastTime = readJSON(getTimeFile()).time;
    const ticks = readJSON(getTickFile());

    if (now - lastTime >= CANDLE_INTERVAL && ticks.length > 0) {
        const prices = ticks.map(t => t.price);
        const close = prices[prices.length - 1];

        const candle = {
            time: new Date().toISOString(),
            close
        };

        const candleFile = getCandleFile();
        const candles = readJSON(candleFile);
        candles.push(candle);
        writeJSON(candleFile, candles);

        logDebug(`New candle → ${JSON.stringify(candle)}`);

        // --- SIGNAL LOGIC ---
        if (candles.length >= 3) {
            const [c1, c2, c3] = candles.slice(-3);

            // BUY: two rising candles
            if (!position && c1.close < c2.close && c2.close < c3.close) {
                position = { entryPrice: c3.close, qty: 1 };
                logDebug(`BUY @ ${c3.close}`);
                logCSV('BUY', c3.close);
                sendEmail('BUY SIGNAL', `BUY at ${c3.close}`);
            }

            // If position open
            if (position) {
                const diff = c3.close - position.entryPrice;

                // Partial profit
                if (diff >= position.entryPrice * 0.05 && position.qty === 1) {
                    position.qty = 0.5;
                    logDebug(`PARTIAL SELL @ ${c3.close}`);
                    logCSV('PARTIAL_SELL', c3.close, diff.toFixed(2));
                }

                // Stop loss OR falling candle
                if (diff <= -0.5 || c2.close > c3.close) {
                    const pnl = diff.toFixed(2);
                    logDebug(`SELL @ ${c3.close} | P/L: ${pnl}`);
                    logCSV('SELL', c3.close, pnl);
                    sendEmail('SELL SIGNAL', `SELL at ${c3.close} | P/L: ${pnl}`);
                    position = null;
                }
            }
        }

        // reset ticks
        writeJSON(getTickFile(), []);
        writeJSON(getTimeFile(), { time: now });
    }
}

// --- HOURLY CSV ---
function sendCSVHourly() {
    const csvFile = getCSVFile();
    if (!fs.existsSync(csvFile)) return;

    transporter.sendMail({
        from: EMAIL_USER,
        to: EMAIL_TO,
        subject: `Paper Trading Report - ${STOCK}`,
        text: 'Hourly report attached',
        attachments: [{ path: csvFile }]
    });
}

// --- START ---
console.log("Trading bot started...");
initFiles();
fetchLivePrice();
setInterval(fetchLivePrice, FETCH_INTERVAL);
setInterval(sendCSVHourly, 60 * 60 * 1000);
