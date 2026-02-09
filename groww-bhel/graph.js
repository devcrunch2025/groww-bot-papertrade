const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');
const { getDailyLogFile } = require('./utils');

const width = 1000, height = 600;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

async function generateDailyGraph(symbol) {
    const logFile = getDailyLogFile(symbol);
    if(!fs.existsSync(logFile)) {
        console.log("No log file for today:", logFile);
        return;
    }

    const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l);
    const trades = lines.map(line => {
        const [timestamp, sym, type, price, qty, cash, profit] = line.split(',');
        return {
            time: new Date(timestamp).toLocaleTimeString(),
            type,
            price: parseFloat(price)
        };
    });

    const labels = trades.map(t => t.time);
    const priceData = trades.map(t => t.price);
    const buyData = trades.map(t => t.type === 'BUY' ? t.price : null);
    const sellData = trades.map(t => t.type === 'SELL' ? t.price : null);

    const config = {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Premium', data: priceData, borderColor: 'blue', fill: false },
                { label: 'BUY', data: buyData, borderColor: 'green', pointStyle: 'triangle', pointRadius: 8 },
                { label: 'SELL', data: sellData, borderColor: 'red', pointStyle: 'rectRot', pointRadius: 8 }
            ]
        },
        options: {
            plugins: {
                title: { display: true, text: `BHEL PUT Paper Trading - ${new Date().toLocaleDateString()}` }
            }
        }
    };

    const buffer = await chartJSNodeCanvas.renderToBuffer(config);
    const filePath = path.join('.', `trading_graph_${symbol}.png`);
    fs.writeFileSync(filePath, buffer);
    console.log("Graph saved as:", filePath);
}

module.exports = { generateDailyGraph };
