@echo off
title Study Grove
cd /d "%~dp0"
echo Starting Study Grove at http://localhost:5173 (only this computer can open it)
echo Keep this window open while you use the app. Close it to stop.
start "" http://localhost:5173
npx --yes serve@14.2.4 -l tcp://127.0.0.1:5173 .
