@echo off

REM Switch to Z: drive
Z:

REM Navigate to TradeFlow server directory
cd \Documents\Dev\tradeflow\server

REM Start the TradeFlow server
node TradeFlowServer.js

REM Keep the window open if the server exits or errors
pause
