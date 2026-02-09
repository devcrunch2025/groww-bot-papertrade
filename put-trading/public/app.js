const socket = io();

// ---------------- CHART ----------------
const chart = LightweightCharts.createChart(
    document.getElementById('chart'),
    {
        layout: {
            backgroundColor: '#0f172a',
            textColor: '#e5e7eb',
            fontSize: 20

        },

        grid: {
            vertLines: { color: '#1f2937' },
            horzLines: { color: '#1f2937' }
        },

        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: '#374151'
        },

        /* 🔥 THIS CONTROLS X-AXIS HEIGHT */
        rightPriceScale: {
            scaleMargins: {
                top: 0.05,
                bottom: 0.35   // ⬅️ increases X-axis display area
            }
        },

        localization: {
            timeFormatter: (time) => {
                const d = new Date(time * 1000);
                return d.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        }
    }
);

// chart.applyOptions({
//     layout: {
//         fontSize: 20    // ⬅️ makes time labels taller
//     },
//     timeScale: {
//         timeVisible: true,
//         secondsVisible: false,
//         barSpacing: 20   // ⬅️ spreads labels vertically & horizontally
//     }
// });



// ✅ v3 API (STABLE)
const candleSeries = chart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444'
});

// ---------------- MARKERS ----------------
function buildMarkers(signals) {
    return signals.map(s => ({
        time: Math.floor(new Date(s.Timestamp).getTime() / 1000),
        position: s.Signal.includes('BUY') ? 'belowBar' : 'aboveBar',
        color: s.Signal.includes('BUY') ? '#22c55e' : '#ef4444',
        shape: s.Signal.includes('BUY') ? 'arrowUp' : 'arrowDown',
        text: s.Signal
    }));
}

// ---------------- TABLE ----------------
function updateSignalTable(signals) {
    const tbody = document.querySelector('#signal-table tbody');
    tbody.innerHTML = '';

    signals.slice().reverse().forEach(s => {
        const tr = document.createElement('tr');
        tr.style.color = s.Signal.includes('BUY') ? '#22c55e' : '#ef4444';

        tr.innerHTML = `
            <td>${new Date(s.Timestamp).toLocaleTimeString()}</td>
            <td>${s.Signal}</td>
            <td>${s.Price}</td>
            <td>${s.ProfitOrLoss || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---------------- LOAD HISTORY ----------------
fetch('/api/history')
    .then(r => r.json())
    .then(d => {
        candleSeries.setData(
            d.candles.map(c => ({
                time: Math.floor(new Date(c.time).getTime() / 1000),
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }))
        );

        // ✅ THIS WORKS IN v3
        candleSeries.setMarkers(buildMarkers(d.signals));

        updateSignalTable(d.signals);
        chart.timeScale().fitContent();
    });

// ---------------- LIVE UPDATES ----------------
socket.on('update', d => {

    document.getElementById('symbol').innerText = d.symbol;
    document.getElementById('price').innerText = d.lastPrice ?? '--';

    if (d.candles.length) {
        const c = d.candles[d.candles.length - 1];
        candleSeries.update({
            time: Math.floor(new Date(c.time).getTime() / 1000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        });
    }

    // ✅ BUY / SELL ARROWS ON GRAPH
    candleSeries.setMarkers(buildMarkers(d.signals));

    // ✅ TABLE
    updateSignalTable(d.signals);
});
