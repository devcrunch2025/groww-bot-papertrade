const WebSocket = require('ws');
const EventEmitter = require('events');
const emitter = new EventEmitter();
const { GROWW_TOKEN, SYMBOL } = require('../config');

let ws;

function connect() {
    const url = `wss://api.groww.in/ws?token=${GROWW_TOKEN}&symbols=${SYMBOL}`;
    ws = new WebSocket(url);

    ws.on('open', () => {
        console.log("Connected to Groww live feed for", SYMBOL);
    });

    ws.on('message', (data) => {
        try {
            const tick = JSON.parse(data);
            const price = tick.price || tick.lastPrice;
            const volume = tick.volume || tick.lastVolume || 0;
            emitter.emit('price', { symbol: SYMBOL, price, volume, time: new Date() });
        } catch (err) {
            emitter.emit('error', err);
        }
    });

    ws.on('close', () => {
        console.log("WebSocket closed, reconnecting in 5s...");
        setTimeout(connect, 5000);
    });

    ws.on('error', (err) => {
        console.log("WebSocket error:", err.message);
        emitter.emit('error', err);
        ws.close();
    });
}

connect();

module.exports = {
    onPrice: (cb) => emitter.on('price', cb),
    onError: (cb) => emitter.on('error', cb)
};
