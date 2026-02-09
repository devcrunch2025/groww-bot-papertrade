require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { createObjectCsvWriter } = require('csv-writer');

// ---------------- CONFIG ----------------
const STOCK = 'NSE_RELIANCE';
const FETCH_INTERVAL = 10_000;
const CANDLE_INTERVAL = 180_000;
const STOP_LOSS = -0.5;
const PROFIT_PERCENT = 5;

// ---------------- PATHS ----------------
const LOG_DIR = 'logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const date = () => new Date().toISOString().split('T')[0];
const tickFile = () => `${LOG_DIR}/${date()}_${STOCK}_ticks.json`;
const candleFile = () => `${LOG_DIR}/${date()}_${STOCK}_candles.json`;
const csvFile = () => `${LOG_DIR}/${date()}_${STOCK}_signals.csv`;
const timeFile = () => `${LOG_DIR}/${date()}_${STOCK}_time.json`;
const logFile = () => `${LOG_DIR}/${date()}_${STOCK}.log`;

// ---------------- EMAIL ----------------
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const mail = (sub, txt) =>
    transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_RECIPIENT,
        subject: sub,
        text: txt
    });

// ---------------- CSV ----------------
const csvWriter = createObjectCsvWriter({
    path: csvFile(),
    header: [
        { id: 'time', title: 'Timestamp' },
        { id: 'signal', title: 'Signal' },
        { id: 'price', title: 'Price' },
        { id: 'pnl', title: 'ProfitOrLoss' }
    ],
    append: fs.existsSync(csvFile())
});

// ---------------- STATE ----------------
let position = null;

// ---------------- HELPERS ----------------
const read = f => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : [];
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const log = m => {
    console.log(m);
    fs.appendFileSync(logFile(), `[${new Date().toISOString()}] ${m}\n`);
};

// ---------------- FETCH PRICE ----------------
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

// ---------------- MAIN LOOP ----------------
async function tick() {
    try {
        const price = await fetchPrice();
        log(`Price: ${price}`);

        const ticks = read(tickFile());
        ticks.push({ time: Date.now(), price });
        write(tickFile(), ticks);

        const last = read(timeFile()).time || 0;
        if (Date.now() - last >= CANDLE_INTERVAL) buildCandle();

    } catch (e) {
        log(`API ERROR ${e.message}`);
        mail('API ERROR', e.message);
    }
}

// ---------------- BUILD CANDLE ----------------
function buildCandle() {
    const ticks = read(tickFile());
    if (!ticks.length) return;

    const prices = ticks.map(t => t.price);
    const candle = {
        time: new Date().toISOString(),
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices.at(-1)
    };

    const candles = read(candleFile());
    candles.push(candle);
    write(candleFile(), candles);
    write(tickFile(), []);
    write(timeFile(), { time: Date.now() });

    tradeLogic(candles);
}

// ---------------- STRATEGY ----------------
async function tradeLogic(candles) {
    if (candles.length < 3) return;

    const [c1, c2, c3] = candles.slice(-3);

    // BUY
    if (!position && c1.close < c2.close && c2.close < c3.close) {
        position = { entry: c3.close, qty: 1, half: false };
        log(`BUY @ ${c3.close}`);
        csvWriter.writeRecords([{ time: new Date().toISOString(), signal: 'BUY', price: c3.close, pnl: '' }]);
        mail('BUY SIGNAL', `BUY @ ${c3.close}`);
    }

    if (!position) return;

    const diff = c3.close - position.entry;
    const pct = (diff / position.entry) * 100;

    // PARTIAL SELL
    if (!position.half && pct >= PROFIT_PERCENT) {
        position.half = true;
        log(`SELL 50% @ ${c3.close}`);
        csvWriter.writeRecords([{ time: new Date().toISOString(), signal: 'SELL_50%', price: c3.close, pnl: diff.toFixed(2) }]);
    }

    // STOP LOSS
    if (diff <= STOP_LOSS || (position.half && diff <= STOP_LOSS)) {
        log(`SELL @ ${c3.close} P/L ${diff.toFixed(2)}`);
        csvWriter.writeRecords([{ time: new Date().toISOString(), signal: 'SELL', price: c3.close, pnl: diff.toFixed(2) }]);
        mail('SELL SIGNAL', `SELL @ ${c3.close} | P/L ${diff.toFixed(2)}`);
        position = null;
    }
}

setInterval(tick, FETCH_INTERVAL);
log('BOT STARTED');
