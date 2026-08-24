#!/usr/bin/env bash
set -euo pipefail

postgres_data=/tmp/keystone-postgres
redis_data=/tmp/keystone-redis
ready_directory=/tmp/keystone-ready
postgres_log="$postgres_data/postgres.log"
bootstrap_log="$ready_directory/bootstrap.log"
shutdown_started=false

log() {
  printf '%s\n' "$(node -e 'process.stdout.write(JSON.stringify({at:new Date().toISOString(),service:"keystone-demo",event:process.argv[1]}))' "$1")"
}

show_failure_logs() {
  [[ -f "$postgres_log" ]] && tail -n 80 "$postgres_log" >&2 || true
  [[ -f "$ready_directory/init.log" ]] && tail -n 80 "$ready_directory/init.log" >&2 || true
  [[ -f "$bootstrap_log" ]] && tail -n 80 "$bootstrap_log" >&2 || true
}

shutdown() {
  [[ "$shutdown_started" == false ]] || return
  shutdown_started=true
  rm -f "$READINESS_SENTINEL_PATH" 2>/dev/null || true
  kill -TERM "${api_pid:-}" "${worker_pid:-}" "${redis_pid:-}" "${postgres_pid:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}

fail() {
  log "startup.failed"
  show_failure_logs
  exit 1
}

trap shutdown TERM INT EXIT

rm -rf "$postgres_data" "$redis_data" "$ready_directory"
mkdir -p "$postgres_data" "$redis_data" "$ready_directory"

initdb --pgdata="$postgres_data" --username=keystone_owner --auth=trust --no-locale --encoding=UTF8 >/dev/null
cat >>"$postgres_data/postgresql.conf" <<'EOF'
listen_addresses = '127.0.0.1'
unix_socket_directories = '/tmp/keystone-postgres'
shared_buffers = '128MB'
max_connections = 30
dynamic_shared_memory_type = mmap
EOF

postgres -D "$postgres_data" >"$postgres_log" 2>&1 &
postgres_pid=$!
for _attempt in {1..150}; do
  pg_isready --host=127.0.0.1 --username=keystone_owner >/dev/null 2>&1 && break
  kill -0 "$postgres_pid" 2>/dev/null || fail
  sleep 0.2
done
pg_isready --host=127.0.0.1 --username=keystone_owner >/dev/null 2>&1 || fail
createdb --host=127.0.0.1 --username=keystone_owner --maintenance-db=postgres keystone || fail

redis-server --bind 127.0.0.1 --port 6379 --dir "$redis_data" --appendonly no --save '' >"$redis_data/redis.log" 2>&1 &
redis_pid=$!
for _attempt in {1..150}; do
  redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG && break
  kill -0 "$redis_pid" 2>/dev/null || fail
  sleep 0.2
done
redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -q PONG || fail

node /opt/keystone/api/dist/cli/init.js >"$ready_directory/init.log" 2>&1 || fail

node /opt/keystone/api/dist/server.js &
api_pid=$!
node /opt/keystone/api/dist/worker/main.js &
worker_pid=$!

for _attempt in {1..180}; do
  api_ready=false
  worker_ready=false
  node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && api_ready=true || true
  node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && worker_ready=true || true
  [[ "$api_ready" == true && "$worker_ready" == true ]] && break
  kill -0 "$api_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null || fail
  sleep 0.25
done
[[ "$api_ready" == true && "$worker_ready" == true ]] || fail

API_BASE_URL=http://127.0.0.1:8080 node /opt/keystone/api/dist/cli/bootstrap-demo.js >"$bootstrap_log" 2>&1 || fail
printf 'ready\n' >"$READINESS_SENTINEL_PATH"
log "startup.ready"

wait "$api_pid"
