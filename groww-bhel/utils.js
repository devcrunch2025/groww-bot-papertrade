const fs = require("fs");

function isMarketOpen(startH, startM, endH, endM) {
    const now = new Date();
    const start = new Date();
    start.setHours(startH, startM, 0, 0);
    const end = new Date();
    end.setHours(endH, endM, 0, 0);
    return now >= start && now <= end;
}

function getDailyLogFile(symbol) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2,'0');
    const month = String(now.getMonth()+1).padStart(2,'0');
    const year = now.getFullYear();
    return `${day}-${month}-${year}-${symbol}.log`;
}

function logToCSV(symbol, row) {
    const file = getDailyLogFile(symbol);
    fs.appendFileSync(file, row + "\n");
}

module.exports = { isMarketOpen, logToCSV, getDailyLogFile };
