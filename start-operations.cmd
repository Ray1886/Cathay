@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，請先安裝 Node.js 24.15.0 以上的 24.x 版本。
  pause
  exit /b 1
)
echo 正在啟動貴賓室運營中心。請保持此視窗開啟；按 Ctrl+C 可停止服務。
set "OPEN_OPERATIONS=1"
node server.js
if errorlevel 1 pause
