@echo off
title Study Grove (Wi-Fi)
cd /d "%~dp0"
echo Study Grove is now reachable from other devices on this Wi-Fi network.
echo Use this only on a network you trust (home, not cafe or campus Wi-Fi).
echo On your phone, open http://YOUR-LAPTOP-IP:5173  (find the IP with: ipconfig)
echo Close this window to stop sharing.
npx --yes serve@14.2.4 -l tcp://0.0.0.0:5173 .
