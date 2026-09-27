#!/bin/sh
set -eu

target="${TARGET_CONTAINER:?TARGET_CONTAINER is required}"
interval="${CHECK_INTERVAL_SECONDS:-15}"
cooldown="${RESTART_COOLDOWN_SECONDS:-90}"
max_restarts="${MAX_RESTARTS_PER_WINDOW:-3}"
window="${RESTART_WINDOW_SECONDS:-900}"
restart_log="/state/restarts.log"
last_suppressed_log="/state/last-suppressed.log"

mkdir -p /state
touch "$restart_log"

log() {
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

prune_restart_log() {
  now="$1"
  cutoff=$((now - window))
  current_log="${restart_log}.current"
  : > "$current_log"
  while IFS= read -r timestamp; do
    case "$timestamp" in
      ''|*[!0-9]*) continue ;;
    esac
    if [ "$timestamp" -ge "$cutoff" ]; then
      printf '%s\n' "$timestamp" >> "$current_log"
    fi
  done < "$restart_log"
  mv "$current_log" "$restart_log"
}

log "Watching $target; limit is $max_restarts unhealthy restarts per $window seconds."

while true; do
  container_state="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$target" 2>/dev/null || printf 'missing|missing')"
  runtime_status="${container_state%%|*}"
  health="${container_state#*|}"
  now="$(date +%s)"
  prune_restart_log "$now"

  if [ "$runtime_status" = "running" ] && [ "$health" = "unhealthy" ]; then
    restart_count="$(wc -l < "$restart_log" | tr -d ' ')"
    if [ "$restart_count" -ge "$max_restarts" ]; then
      last_logged="$(cat "$last_suppressed_log" 2>/dev/null || printf '0')"
      if [ $((now - last_logged)) -ge 60 ]; then
        log "$target is unhealthy, but restart is suppressed after $restart_count attempts in the current window."
        docker inspect --format 'Health history: {{json .State.Health.Log}}' "$target" 2>&1 || true
        printf '%s\n' "$now" > "$last_suppressed_log"
      fi
    else
      log "$target is unhealthy; restarting it (attempt $((restart_count + 1))/$max_restarts)."
      docker inspect --format 'Health history: {{json .State.Health.Log}}' "$target" 2>&1 || true
      printf '%s\n' "$now" >> "$restart_log"
      if docker restart "$target" >/dev/null; then
        log "$target restart command completed; waiting $cooldown seconds before another recovery attempt."
      else
        log "$target restart command failed."
      fi
      sleep "$cooldown"
      continue
    fi
  elif [ "$runtime_status" = "missing" ]; then
    log "$target is not present; Compose must create the application service."
  fi

  sleep "$interval"
done
