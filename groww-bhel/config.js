module.exports = {
    SYMBOL: process.env.SYMBOL || "BHEL",
    GROWW_TOKEN: process.env.GROWW_TOKEN || "",
    EMAIL_TO: process.env.ALERT_EMAIL,
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_PASS: process.env.GMAIL_PASS,
    MQTT_BROKER: process.env.MQTT_URL || "mqtt://broker.hivemq.com",
    MQTT_TOPIC: "papertrading/control",
    TARGET_POINTS: 2,
    STOPLOSS_POINTS: 1,
    QUANTITY: 10,
    MARKET_START_HOUR: 9,
    MARKET_START_MIN: 30,
    MARKET_END_HOUR: 15,
    MARKET_END_MIN: 0
};
