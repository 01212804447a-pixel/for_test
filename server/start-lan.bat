@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul || (echo Нужен Node.js 18+ : https://nodejs.org & pause & exit /b 1)
if not exist node_modules\ws call npm install --omit=dev --no-audit --no-fund
node server\server.mjs
pause
