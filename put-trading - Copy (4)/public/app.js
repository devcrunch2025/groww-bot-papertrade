const socket = io();
let currentStock = 'NSE_RELIANCE';

// Chart setup
const chart = LightweightCharts.createChart(
    document.getElementById('chart'),
    {
        layout: {
            background: { color: '#0f172a' },
            textColor: '#d1d5db'
        },
        grid: {
            vertLines: { color: '#1f2937' },
            horzLines: { color: '#1f2937' }
        }
    }
);

const candleSeries = chart.addCandlestickSeries();

// Stock selector
document.getElementById('stockSelector').addEventListener('change', e => {
    currentStock = e.target.value;
});

// Update UI
socket.on('update', data => {

    // Price
    document.getElementById('price').innerText =
        data.lastPrice || '--';

    // Candles
    const chartData = data.candles.map(c => ({
        time: Math.floor(new Date(c.time).getTime() / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
    }));

    candleSeries.setData(chartData);

    // Signals
    const table = document.getElementById('signalTable');
    table.innerHTML = '';

    data.signals.slice(-10).reverse().forEach(s => {
        const row = document.createElement('tr');
        row.className = s.Signal.includes('BUY') ? 'buy' : 'sell';

        row.innerHTML = `
            <td>${new Date(s.Timestamp).toLocaleTimeString()}</td>
            <td>${s.Signal}</td>
            <td>${s.Price}</td>
        `;

        table.appendChild(row);
    });

    // Position display
    const lastSignal = data.signals[data.signals.length - 1];
    if (lastSignal && lastSignal.Signal === 'BUY') {
        document.getElementById('position').innerText =
            `Long @ ${lastSignal.Price}`;
    }
});
