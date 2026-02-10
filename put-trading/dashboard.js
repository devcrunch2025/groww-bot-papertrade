require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------------- CONFIG ----------------
const PORT = 3000;
const LOG_DIR = 'logs';
const SYMBOL = 'NSE_TATASTEEL';

// ---------------- MIDDLEWARE ----------------
app.use(express.static('public'));

// ---------------- HELPERS ----------------
const today = () => new Date().toISOString().split('T')[0];

function readCandles(date, symbol) {
    const file = path.join(LOG_DIR, `${date}_${symbol}_candles.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
}

function readSignals(date, symbol) {
    const file = path.join(LOG_DIR, `${date}_${symbol}_signals.csv`);
    if (!fs.existsSync(file)) return [];

    return fs.readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .slice(1)
        .map(l => {
            const [Timestamp, Signal, Price, ProfitOrLoss] =
                l.split(',').map(v => v.trim());
            return { Timestamp, Signal, Price, ProfitOrLoss };
        });
}

// ---------------- SOCKET ----------------
io.on('connection', socket => {
    console.log('✅ Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
    });
});

// ---------------- REALTIME EMIT ----------------
setInterval(() => {
    try {
        const date = today();
        const candles = readCandles(date, SYMBOL);
        const signals = readSignals(date, SYMBOL);

        io.emit('update', {
            symbol: SYMBOL,
            candles,
            signals,
            lastPrice: candles.length
                ? candles[candles.length - 1].close
                : null
        });

        console.log(`📡 Emitted ${candles.length} candles, ${signals.length} signals`);

    } catch (err) {
        console.error('Socket emit error:', err.message);
    }
}, 3000);

// ---------------- API (HISTORY LOAD) ----------------
app.get('/api/history', (req, res) => {
    const date = req.query.date || today();
    const symbol = req.query.symbol || SYMBOL;

    res.json({
        symbol,
        candles: readCandles(date, symbol),
        signals: readSignals(date, symbol)
    });
});

// ---------------- START ----------------
server.listen(PORT, () => {
    console.log(`🚀 Dashboard running at http://localhost:${PORT}`);
});
