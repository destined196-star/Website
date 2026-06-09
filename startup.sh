#!/bin/bash
set -e
echo "[startup] Installing dependencies..."
npm install --production
echo "[startup] Starting server..."
node server.js
