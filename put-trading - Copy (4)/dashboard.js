const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const STOCK = 'NSE_RELIANCE';
const LOG_DIR = path.join(__dirname, 'logs');

function getDate() {
    return new Date().toISOString().split('T')[0];
}

function getTickFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}_ticks.json`);
}

function getCandleFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}_candles.json`);
}

function getCSVFile() {
    return path.join(LOG_DIR, `${getDate()}_${STOCK}_signals.csv`);
}

// Serve static UI
app.use(express.static('public'));

// Read JSON safely
function readJSON(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file));
    } catch {
        return [];
    }
}

// Read CSV signals
function readCSV(file, callback) {
    const results = [];
    if (!fs.existsSync(file)) return callback(results);

    fs.createReadStream(file)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => callback(results));
}

// Send data every 5 seconds
setInterval(() => {
    const ticks = readJSON(getTickFile());
    const candles = readJSON(getCandleFile());

    readCSV(getCSVFile(), (signals) => {
        io.emit('update', {
            lastPrice: ticks.length ? ticks[ticks.length - 1].price : null,
            candles: candles.slice(-10),
            signals: signals.slice(-10)
        });
    });

}, 5000);

io.on('connection', () => {
    console.log('Dashboard connected');
});

server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
});
