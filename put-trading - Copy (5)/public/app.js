const socket = io();
let historyLoaded = false;

// ---------------- DEBUG SOCKET ----------------
socket.on('connect', () => console.log('✅ Socket connected'));
socket.on('disconnect', () => console.log('❌ Socket disconnected'));

// ---------------- TIME LOGIC (UNCHANGED) ----------------
function istToUnixSeconds(ist) {
    const [d, t] = ist.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm, ss = 0] = t.split(':').map(Number);

    return Math.floor(
        Date.UTC(y, m - 1, day, hh + 0, mm + 0, ss) / 1000
    );
}

// ---------------- MAIN CHART ----------------
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

// ---------------- VOLUME ----------------
const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.75, bottom: 0 }
});

// ---------------- LIVE PRICE LINE ----------------
let lastPrice = null;
const livePriceLine = candleSeries.createPriceLine({
    price: 0,
    color: '#22c55e',
    lineWidth: 2,
    axisLabelVisible: true,
    title: 'LTP'
});

function buildMarkers(signals) {
    return signals.map(s => {
        let color, shape, position, size;

        if (s.Signal.includes('SELL_50')) {
            color = '#f59e0b';      // ORANGE
            shape = 'arrowDown';
            position = 'aboveBar';
            size = 1.5;
        } 
        else if (s.Signal.includes('SELL')) {
            color = '#ef4444';      // RED
            shape = 'arrowDown';
            position = 'aboveBar';
            size = 2;
        } 
        else {
            color = '#22c55e';      // GREEN
            shape = 'arrowUp';
            position = 'belowBar';
            size = 2;
        }

        return {
            time: istToUnixSeconds(s.Timestamp),
            position,
            shape,
            color,
            size,
            text: `${s.Signal} @ ${s.Price}`
        };
    });
}

// ---------------- TRADE SIGNAL TABLE ----------------
function updateSignalTable(signals) {
    const tbody = document.querySelector('#signal-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    signals.slice().reverse().forEach(s => {
        const tr = document.createElement('tr');
        tr.style.color = s.Signal.includes('BUY') ? '#22c55e' : '#ef4444';

        tr.innerHTML = `
            <td>${s.Timestamp}</td>
            <td>${s.Signal}</td>
            <td>${s.Price}</td>
            <td>${s.ProfitOrLoss || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}
 
// ---------------- DOM ----------------
const datePicker   = document.getElementById('datePicker');
const symbolSelect = document.getElementById('symbolSelect');
const symbolLabel  = document.getElementById('symbolLabel');
const livePriceEl  = document.getElementById('livePrice');

const todayStr = new Date().toISOString().split('T')[0];
if (!datePicker.value) datePicker.value = todayStr;

datePicker.addEventListener('change', () => historyLoaded = false);
symbolSelect.addEventListener('change', () => historyLoaded = false);

// ---------------- SOCKET UPDATE ----------------
socket.on('update', d => {
    if (datePicker.value !== todayStr) return;
    if (symbolSelect.value !== d.symbol) return;

    symbolLabel.innerText = d.symbol;

    // ----- LIVE PRICE + LINE -----
    if (d.lastPrice !== null) {
        livePriceEl.innerText = d.lastPrice.toFixed(2);

        livePriceLine.applyOptions({
            price: d.lastPrice,
            color: d.lastPrice >= (lastPrice ?? d.lastPrice)
                ? '#22c55e'
                : '#ef4444'
        });
        lastPrice = d.lastPrice;
    }

    if (!d.candles.length) return;

    // ----- LOAD HISTORY ONCE -----
    if (!historyLoaded) {
        candleSeries.setData(d.candles.map(c => ({
            time: istToUnixSeconds(c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        })));

        volumeSeries.setData(d.candles.map(c => ({
            time: istToUnixSeconds(c.time),
            value: c.volume || 0,
            color: c.close >= c.open ? '#22c55e' : '#ef4444'
        })));

        candleSeries.setMarkers(buildMarkers(d.signals));
        updateSignalTable(d.signals);

        chart.timeScale().fitContent();
        historyLoaded = true;
        return;
    }

    // ----- LIVE UPDATE -----
    const c = d.candles[d.candles.length - 1];

    candleSeries.update({
        time: istToUnixSeconds(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close
    });

    volumeSeries.update({
        time: istToUnixSeconds(c.time),
        value: c.volume || 0,
        color: c.close >= c.open ? '#22c55e' : '#ef4444'
    });

    candleSeries.setMarkers(buildMarkers(d.signals));
    updateSignalTable(d.signals);
 
});
