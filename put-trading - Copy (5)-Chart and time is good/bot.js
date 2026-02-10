require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createObjectCsvWriter } = require('csv-writer');

// ---------------- CONFIG ----------------
const STOCK = 'NSE_TATASTEEL';
const FETCH_INTERVAL = 10_000;      // 10 sec
const CANDLE_INTERVAL = 180_000;    // 3 min
const STOP_LOSS = -0.5;
const PROFIT_PERCENT = 5;

// ---------------- IST TIME HELPERS ----------------
// Produces: 2026-02-10T09:30:00 (IST, ISO-safe)
function nowIST() {
    return new Date()
        .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
        .replace(' ', 'T');
}

// YYYY-MM-DD in IST
const todayIST = () => nowIST().split('T')[0];

// ---------------- PATHS ----------------
const LOG_DIR = 'logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const tickFile   = () => path.join(LOG_DIR, `${todayIST()}_${STOCK}_ticks.json`);
const candleFile = () => path.join(LOG_DIR, `${todayIST()}_${STOCK}_candles.json`);
const csvFile    = () => path.join(LOG_DIR, `${todayIST()}_${STOCK}_signals.csv`);
const timeFile   = () => path.join(LOG_DIR, `${todayIST()}_${STOCK}_time.json`);
const logFile    = () => path.join(LOG_DIR, `${todayIST()}_${STOCK}.log`);

// ---------------- EMAIL ----------------
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function sendMail(subject, text) {
    transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_RECIPIENT,
        subject,
        text
    });
}

// ---------------- CSV ----------------
const csvWriter = createObjectCsvWriter({
    path: csvFile(),
    header: [
        { id: 'time',   title: 'Timestamp' },
        { id: 'signal', title: 'Signal' },
        { id: 'price',  title: 'Price' },
        { id: 'pnl',    title: 'ProfitOrLoss' }
    ],
    append: fs.existsSync(csvFile())
});

// ---------------- STATE ----------------
let position = null;

// ---------------- HELPERS ----------------
const readJSON = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : []);
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

function log(msg) {
    console.log(msg);
    fs.appendFileSync(logFile(), `[${nowIST()}] ${msg}\n`);
}

// ---------------- FETCH LIVE PRICE ----------------
async function fetchPrice() {
    const symbol = STOCK.replace('NSE_', '');
    const url = `https://api.groww.in/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=${symbol}`;

    const r = await axios.get(url, {
        headers: {
            Authorization: `Bearer ${process.env.GROW_ACCESS_TOKEN}`,
            'X-API-VERSION': '1.0'
        }
    });

    return r.data.payload.last_price;
}

// ---------------- MAIN TICK LOOP ----------------
async function tick() {
    try {
        const price = await fetchPrice();
        log(`Price: ${price}`);

        const ticks = readJSON(tickFile());
        ticks.push({ time: nowIST(), price });
        writeJSON(tickFile(), ticks);

        const lastTime = readJSON(timeFile()).time || 0;
        if (Date.now() - lastTime >= CANDLE_INTERVAL) {
            buildCandle();
        }

    } catch (err) {
        log(`API ERROR: ${err.message}`);
        sendMail('API ERROR', err.message);
    }
}

// ---------------- BUILD 3-MIN CANDLE ----------------
function buildCandle() {
    const ticks = readJSON(tickFile());
    if (!ticks.length) return;

    const prices = ticks.map(t => t.price);

    const candle = {
        time: nowIST(),           // ✅ IST TIME
        open: prices[0],
        high: Math.max(...prices),
        low:  Math.min(...prices),
        close: prices.at(-1)
    };

    const candles = readJSON(candleFile());
    candles.push(candle);
    writeJSON(candleFile(), candles);

    writeJSON(tickFile(), []);
    writeJSON(timeFile(), { time: Date.now() });

    tradeLogic(candles);
}

// ---------------- STRATEGY ----------------
function tradeLogic(candles) {
    if (candles.length < 3) return;

    const [c1, c2, c3] = candles.slice(-3);

    // BUY: 2 rising candles
    if (!position && c1.close < c2.close && c2.close < c3.close) {
        position = { entry: c3.close, halfSold: false };

        log(`BUY @ ${c3.close}`);
        csvWriter.writeRecords([{
            time: nowIST(),
            signal: 'BUY',
            price: c3.close,
            pnl: ''
        }]);

        sendMail('BUY SIGNAL', `BUY ${STOCK} @ ${c3.close}`);
    }

    if (!position) return;

    const diff = c3.close - position.entry;
    const pct = (diff / position.entry) * 100;

    // PARTIAL PROFIT
    if (!position.halfSold && pct >= PROFIT_PERCENT) {
        position.halfSold = true;

        log(`SELL 50% @ ${c3.close}`);
        csvWriter.writeRecords([{
            time: nowIST(),
            signal: 'SELL_50%',
            price: c3.close,
            pnl: diff.toFixed(2)
        }]);
    }

    // STOP LOSS OR FINAL EXIT
    if (diff <= STOP_LOSS) {
        log(`SELL @ ${c3.close} | P/L ${diff.toFixed(2)}`);

        csvWriter.writeRecords([{
            time: nowIST(),
            signal: 'SELL',
            price: c3.close,
            pnl: diff.toFixed(2)
        }]);

        sendMail('SELL SIGNAL', `SELL ${STOCK} @ ${c3.close} | P/L ${diff.toFixed(2)}`);
        position = null;
    }
}

// ---------------- START ----------------
log('BOT STARTED');
setInterval(tick, FETCH_INTERVAL);
