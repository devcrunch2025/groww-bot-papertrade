const mqtt = require('mqtt');
const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://test.mosquitto.org');

function onControl(callback) {
    client.on('connect', () => {
        client.subscribe('bot/control');
    });

    client.on('message', (topic, message) => {
        callback(message.toString());
    });
}

module.exports = { onControl };