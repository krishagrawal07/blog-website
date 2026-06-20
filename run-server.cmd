@echo off
set PORT=4174
cd /d "%~dp0"
title Inkline Blog Server - localhost:4174
node server.js
