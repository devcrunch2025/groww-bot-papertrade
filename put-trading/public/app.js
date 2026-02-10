const socket = io();
let historyLoaded = false;

// ---------------- DEBUG SOCKET ----------------
socket.on('connect', () => console.log('✅ Socket connected'));
socket.on('disconnect', () => console.log('❌ Socket disconnected'));

// ---------------- TIME LOGIC (UNCHANGED) ----------------
// ⚠️ DO NOT MODIFY – kept exactly as you had
function istToUnixSeconds(ist) {
    const [d, t] = ist.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm, ss = 0] = t.split(':').map(Number);

    // ✅ ADD +5:30 hours (330 minutes)
    return Math.floor(
        Date.UTC(y, m - 1, day, hh + 0, mm + 0, ss) / 1000
    );
}


// ---------------- CHART ----------------
const chart = LightweightCharts.createChart(
    document.getElementById('chart'),
    {
        layout: {
            backgroundColor: '#0f172a',
            textColor: '#e5e7eb'
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5
        }
    }
);

chart.timeScale().applyOptions({ barSpacing: 12 });

const candleSeries = chart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444'
});

// ---------------- MARKERS ----------------
function buildMarkers(signals) {
    return signals.map(s => ({
        time: istToUnixSeconds(s.Timestamp), // unchanged
        position: s.Signal.includes('BUY') ? 'belowBar' : 'aboveBar',
        shape: s.Signal.includes('BUY') ? 'arrowUp' : 'arrowDown',
        color: s.Signal.includes('BUY') ? '#22c55e' : '#ef4444',
        text: s.Signal
    }));
}

// ---------------- TRADE SIGNAL TABLE ----------------
function updateSignalTable(signals) {
    const tbody = document.querySelector('#signal-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    signals.slice().reverse().forEach(s => {
        const tr = document.createElement('tr');

        tr.style.color = s.Signal.includes('BUY')
            ? '#22c55e'
            : '#ef4444';

        tr.innerHTML = `
            <td>${s.Timestamp}</td>
            <td>${s.Signal}</td>
            <td>${s.Price}</td>
            <td>${s.ProfitOrLoss || ''}</td>
        `;

        tbody.appendChild(tr);
    });
}

// ---------------- DOM ELEMENTS ----------------
const datePicker   = document.getElementById('datePicker');
const symbolSelect = document.getElementById('symbolSelect');
const symbolLabel  = document.getElementById('symbolLabel');
const livePriceEl  = document.getElementById('livePrice');

// ---------------- DEFAULT TODAY DATE ----------------
const todayStr = new Date().toISOString().split('T')[0];
if (!datePicker.value) {
    datePicker.value = todayStr;
}

// Reset history when filters change
datePicker.addEventListener('change', () => historyLoaded = false);
symbolSelect.addEventListener('change', () => historyLoaded = false);

// ---------------- SOCKET UPDATE ----------------
socket.on('update', d => {
    const selectedDate = datePicker.value;
    const selectedSymbol = symbolSelect.value;

    if (selectedDate !== todayStr) return;
    if (selectedSymbol !== d.symbol) return;

    symbolLabel.innerText = d.symbol;

    // ----- LIVE PRICE -----
    if (d.lastPrice !== null) {
        livePriceEl.innerText = d.lastPrice.toFixed(2);
    }

    if (!d.candles || !d.candles.length) return;

    // ----- LOAD FULL DAY HISTORY ONCE -----
    if (!historyLoaded) {
        candleSeries.setData(
            d.candles.map(c => ({
                time: istToUnixSeconds(c.time), // unchanged
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            }))
        );

        candleSeries.setMarkers(buildMarkers(d.signals));
        updateSignalTable(d.signals);   // 🔥 FIX: populate table

        chart.timeScale().fitContent();
        historyLoaded = true;
        return;
    }

    // ----- LIVE CANDLE UPDATE -----
    const c = d.candles[d.candles.length - 1];

    candleSeries.update({
        time: istToUnixSeconds(c.time), // unchanged
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
    });

    candleSeries.setMarkers(buildMarkers(d.signals));
    updateSignalTable(d.signals);       // 🔥 FIX: keep table updated

    chart.timeScale().scrollToRealTime();
});
