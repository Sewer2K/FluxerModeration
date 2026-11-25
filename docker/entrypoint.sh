#!/bin/sh
set -e

if [ "${WAIT_FOR_MONGO:-false}" = "true" ]; then
  host="${MONGO_HOST:-mongo}"
  port="${MONGO_PORT:-27017}"

  echo "waiting for mongo at ${host}:${port}..."
  until node -e "
const net = require('net');
const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
socket.setTimeout(2000);
socket.on('connect', () => { socket.end(); process.exit(0); });
socket.on('timeout', () => { socket.destroy(); process.exit(1); });
socket.on('error', () => process.exit(1));
" "$host" "$port"; do
    sleep 2
  done
fi

exec "$@"
