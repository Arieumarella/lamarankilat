#!/bin/sh
set -e
# bind mount ./data dibuat root; container perlu bisa menulis (SQLite + artefak)
mkdir -p /app/data/db /app/data/artefacts /app/data/media /app/data/wa /app/data/logs
chown -R node:node /app/data 2>/dev/null || true
if command -v gosu >/dev/null 2>&1; then
  exec gosu node:node "$@"
fi
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec node:node "$@"
fi
exec "$@"
