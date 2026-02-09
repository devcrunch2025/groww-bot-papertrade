require('dotenv').config();
const axios = require('axios');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fs = require('fs');

const ACCESS_TOKEN = process.env.GROW_ACCESS_TOKEN;

// Replace with your stock and date range
const exchange = 'NSE';
const segment = 'CASH';
const trading_symbol = 'NIFTY';
const start_time = '2026-02-01 09:15:00';
const end_time = '2026-02-05 15:15:00';

// CSV setup
const fileName = `${trading_symbol}_historical.csv`;
const csvWriter = createCsvWriter({
    path: fileName,
    header: [
        { id: 'timestamp', title: 'Timestamp' },
        { id: 'open', title: 'Open' },
        { id: 'high', title: 'High' },
        { id: 'low', title: 'Low' },
        { id: 'close', title: 'Close' },
        { id: 'volume', title: 'Volume' }
    ]
});

async function fetchHistoricalCandles() {
    try {
        const url = `https://api.groww.in/v1/historical/candle/range?exchange=${exchange}&segment=${segment}&trading_symbol=${trading_symbol}&start_time=${encodeURIComponent(start_time)}&end_time=${encodeURIComponent(end_time)}`;
        
        const response = await axios.get(url, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'X-API-VERSION': '1.0'
            }
        });

        if (response.data.status !== 'SUCCESS') {
            console.error('API error:', response.data);
            return;
        }

        const candles = response.data.payload[trading_symbol];

        if (!candles || !candles.length) {
            console.log('No historical data found.');
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
        console.log(`Historical candles saved to ${fileName}`);

    } catch (err) {
        console.error('Error fetching historical candles:', err.message);
    }
}

fetchHistoricalCandles();
