#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /app/data
  chown -R node:node /app/data
  rm -f /tmp/triptracker-health-failure-test
  exec su-exec node "$@"
fi

exec "$@"
