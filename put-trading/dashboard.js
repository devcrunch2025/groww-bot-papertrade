require('dotenv').config();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const LOG_DIR = 'logs';
const DEFAULT_SYMBOL = 'NSE_RELIANCE';

app.use(express.static('public'));

const today = () => new Date().toISOString().split('T')[0];

// ---------- FILE HELPERS ----------
const candleFile = (date, symbol) =>
    path.join(LOG_DIR, `${date}_${symbol}_candles.json`);

const signalFile = (date, symbol) =>
    path.join(LOG_DIR, `${date}_${symbol}_signals.csv`);

function readCandles(date, symbol) {
    const f = candleFile(date, symbol);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : [];
}

function readSignals(date, symbol) {
    const f = signalFile(date, symbol);
    if (!fs.existsSync(f)) return [];

    const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    lines.shift(); // header

    return lines.map(l => {
        const [Timestamp, Signal, Price, ProfitOrLoss] = l.split(',');
        return { Timestamp, Signal, Price, ProfitOrLoss };
    });
}

// ---------- API ----------
app.get('/api/history', (req, res) => {
    const date = req.query.date || today();
    const symbol = req.query.symbol || DEFAULT_SYMBOL;

    res.json({
        symbol,
        candles: readCandles(date, symbol),
        signals: readSignals(date, symbol)
    });
});

// ---------- LIVE SOCKET (TODAY + DEFAULT SYMBOL ONLY) ----------
setInterval(() => {
    const d = today();
    const candles = readCandles(d, DEFAULT_SYMBOL);

    io.emit('update', {
        symbol: DEFAULT_SYMBOL,
        candles,
        signals: readSignals(d, DEFAULT_SYMBOL),
        lastPrice: candles.at(-1)?.close ?? null
    });
}, 2000);

server.listen(3000, () =>
    console.log('Dashboard running → http://localhost:3000')
);
