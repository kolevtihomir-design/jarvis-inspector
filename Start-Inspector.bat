@echo off
title Jarvis Inspector Server
color 0A
echo.
echo  ==========================================
echo   JARVIS INSPECTOR  --  Standalone Server
echo   Port: 3002
echo  ==========================================
echo.
cd /d "%~dp0"
npx tsx inspector-server.ts
pause
