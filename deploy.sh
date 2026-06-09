#!/bin/bash
# Kudu deployment script — runs on Azure during git/zip deploy
set -e

echo "[deploy] Node $(node -v) / npm $(npm -v)"

# Install & compile native modules (better-sqlite3 needs build tools)
npm install --build-from-source

echo "[deploy] Done."
