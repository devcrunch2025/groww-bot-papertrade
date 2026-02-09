require('dotenv').config();
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const STOCK = 'NSE_RELIANCE';
const LOG_DIR = 'logs';

app.use(express.static('public'));

const today = () => new Date().toISOString().split('T')[0];
const candleFile = () => path.join(LOG_DIR, `${today()}_${STOCK}_candles.json`);
const signalFile = () => path.join(LOG_DIR, `${today()}_${STOCK}_signals.csv`);

// -------- READ DATA --------
function readCandles() {
    return fs.existsSync(candleFile())
        ? JSON.parse(fs.readFileSync(candleFile()))
        : [];
}

function readSignals() {
    if (!fs.existsSync(signalFile())) return [];
    const lines = fs.readFileSync(signalFile(), 'utf8').trim().split('\n');
    lines.shift();
    return lines.map(l => {
        const [Timestamp, Signal, Price, ProfitOrLoss] = l.split(',');
        return { Timestamp, Signal, Price, ProfitOrLoss };
    });
}

// -------- API --------
app.get('/api/history', (req, res) => {
    res.json({
        candles: readCandles(),
        signals: readSignals()
    });
});

// -------- SOCKET --------
setInterval(() => {
    const candles = readCandles();
    const signals = readSignals();

    io.emit('update', {
        symbol: STOCK,
        candles,
        signals,
        lastPrice: candles.at(-1)?.close ?? null
    });
}, 2000);

server.listen(3000, () =>
    console.log('Dashboard → http://localhost:3000')
);
