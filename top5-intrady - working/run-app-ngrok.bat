@echo off
REM Start the Groww paper-trading app and ngrok in parallel

REM Start the Node.js app (server)
start "Groww App" cmd /k node src\server.js

REM Start ngrok to tunnel localhost:3000 (change authtoken if needed)
start "ngrok" cmd /k ngrok http 3000

echo Both Groww app and ngrok are starting in separate terminals.
pause
