#!/bin/sh
set -e
# bind mount ./data dibuat root; container perlu bisa menulis (SQLite + artefak)
mkdir -p /app/data/db /app/data/artefacts /app/data/media /app/data/wa /app/data/logs
chown -R node:node /app/data 2>/dev/null || true
exec su-exec node:node "$@"
