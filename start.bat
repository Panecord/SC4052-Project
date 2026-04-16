@echo off
title CloneMe Server
cd /d "%~dp0"
set PYTHONUNBUFFERED=1
echo Starting CloneMe...
echo.
python app.py
pause
