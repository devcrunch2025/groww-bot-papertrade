const EventEmitter = require('events');
const emitter = new EventEmitter();

function randomPrice() {
    return 100 + Math.random() * 5;
}

setInterval(() => {
    emitter.emit('price', {
        symbol: "BHEL",
        price: randomPrice(),
        volume: Math.floor(Math.random() * 10000),
        time: new Date()
    });
}, 5000);

module.exports = {
    onPrice: (cb) => emitter.on('price', cb)
};