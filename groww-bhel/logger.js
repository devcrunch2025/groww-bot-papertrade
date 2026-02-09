const fs = require('fs');
const path = require('path');

// Get daily debug log file
function getDebugLogFile() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2,'0');
    const month = String(now.getMonth()+1).padStart(2,'0');
    const year = now.getFullYear();
    return path.join(__dirname, `${day}-${month}-${year}-debug.log`);
}

// Log a message with timestamp
function log(message, type="INFO") {
    const timestamp = new Date().toISOString();
    const row = `[${timestamp}] [${type}] ${message}`;
    console.log(row); // Also print to console
    fs.appendFileSync(getDebugLogFile(), row + "\n");
}

module.exports = { log };
