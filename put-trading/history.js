require('dotenv').config();
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;

// PREFER ISO FORMAT or encode spaces
const exchange = "NSE";
const segment = "CASH";
const symbol = "NSE-WIPRO";
const startTime = "2025-09-24 10:56:00";
const endTime = "2025-09-24 15:21:00";
const interval = "5minute";

// CSV setup
const outFile = `${symbol}_historical_5min.csv`;
const csvWriter = createCsvWriter({
    path: outFile,
    header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'open', title: 'Open' },
        { id: 'high', title: 'High' },
        { id: 'low', title: 'Low' },
        { id: 'close', title: 'Close' },
        { id: 'volume', title: 'Volume' }
    ]
});

async function fetchHistorical() {
    try {
        const baseURL = "https://api.groww.in/v1/historical/candles";
        const url = `${baseURL}?exchange=${exchange}` + 
                    `&segment=${segment}` +
                    `&groww_symbol=${encodeURIComponent(symbol)}` +
                    `&start_time=${encodeURIComponent(startTime)}` +
                    `&end_time=${encodeURIComponent(endTime)}` +
                    `&candle_interval=${interval}`;

        console.log(`Fetching: ${url}`);

        const response = await axios.get(url, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "X-API-VERSION": "1.0"
            }
        });

        if (response.status !== 200 || !response.data.payload) {
            console.error("No data or unexpected response:", response.data);
            return;
        }

        const payload = response.data.payload;
        const candles = payload[symbol] || [];

        if (!candles.length) {
            console.log("No candle data returned for range.");
            return;
        }

        const records = candles.map(c => ({
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume
        }));

        await csvWriter.writeRecords(records);
        console.log(`Saved ${records.length} candles to ${outFile}`);

    } catch (err) {
        console.error("Error fetching historical candles:", err.message);
    }
}

fetchHistorical();
