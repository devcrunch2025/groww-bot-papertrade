const socket = io();

// ---------- CHART ----------
const chart = LightweightCharts.createChart(
    document.getElementById('chart'),
    {
        layout: {
            backgroundColor: '#0f172a',
            textColor: '#e5e7eb',
            fontSize: 13
        },
        grid: {
            vertLines: { color: '#1f2937' },
            horzLines: { color: '#1f2937' }
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false
        },
        localization: {
            timeFormatter: (time) =>
                new Date(time * 1000).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Kolkata'
                })
        }
    }
);

const candleSeries = chart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444'
});

// ---------- MARKERS ----------
function buildMarkers(signals) {
    return signals.map(s => ({
        time: Math.floor(new Date(s.Timestamp).getTime() / 1000),
        position: s.Signal.includes('BUY') ? 'belowBar' : 'aboveBar',
        color: s.Signal.includes('BUY') ? '#22c55e' : '#ef4444',
        shape: s.Signal.includes('BUY') ? 'arrowUp' : 'arrowDown',
        text: s.Signal
    }));
}

// ---------- TABLE ----------
function updateSignalTable(signals) {
    const tbody = document.querySelector('#signal-table tbody');
    tbody.innerHTML = '';

    signals.slice().reverse().forEach(s => {
        const tr = document.createElement('tr');
        tr.style.color = s.Signal.includes('BUY') ? '#22c55e' : '#ef4444';

        tr.innerHTML = `
            <td>${new Date(s.Timestamp).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit'
            })}</td>
            <td>${s.Signal}</td>
            <td>${s.Price}</td>
            <td>${s.ProfitOrLoss || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ---------- LOAD DATA ----------
function loadData(date, symbol) {
    fetch(`/api/history?date=${date}&symbol=${symbol}`)
        .then(r => r.json())
        .then(d => {
            document.getElementById('symbolLabel').innerText = d.symbol;

            candleSeries.setData(
                d.candles.map(c => ({
                    time: Math.floor(new Date(c.time).getTime() / 1000),
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close
                }))
            );

            candleSeries.setMarkers(buildMarkers(d.signals));
            updateSignalTable(d.signals);
            chart.timeScale().fitContent();
        });
}

// ---------- INIT ----------
const datePicker = document.getElementById('datePicker');
const symbolSelect = document.getElementById('symbolSelect');
const loadBtn = document.getElementById('loadData');

const todayStr = new Date().toISOString().split('T')[0];
datePicker.value = todayStr;

loadData(todayStr, symbolSelect.value);

loadBtn.addEventListener('click', () =>
    loadData(datePicker.value, symbolSelect.value)
);

// ---------- LIVE UPDATES (ONLY TODAY + DEFAULT SYMBOL) ----------
socket.on('update', d => {
    const selectedDate = datePicker.value;
    const selectedSymbol = symbolSelect.value;
    const todayStr = new Date().toISOString().split('T')[0];

    if (selectedDate !== todayStr) return;
    if (selectedSymbol !== d.symbol) return;

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

    candleSeries.setMarkers(buildMarkers(d.signals));
    updateSignalTable(d.signals);
});
