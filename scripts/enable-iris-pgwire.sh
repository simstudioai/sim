#!/usr/bin/env bash
set -euo pipefail

ready=false
for attempt in {1..30}; do
  if docker compose -f docker-compose.test.yml exec -T iris iris session IRIS -U %SYS "write 1" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

if [ "${ready}" != "true" ]; then
  echo "IRIS did not become ready for session access" >&2
  exit 1
fi

docker compose -f docker-compose.test.yml exec -T iris bash -c "/usr/irissys/bin/irispython -m pip install iris-pgwire && /usr/irissys/bin/irispython -m iris_pgwire.installer"

docker compose -f docker-compose.test.yml exec -T iris iris session IRIS -U USER <<'EOF'
do ##class(IrisPGWire.Service).Start()
halt
EOF

# Wait for pgwire port
for attempt in {1..30}; do
  if bash -lc "timeout 1 bash -c '</dev/tcp/localhost/5435'" >/dev/null 2>&1; then
    echo "IRIS pgwire is ready on port 5435"
    exit 0
  fi
  sleep 2
done

echo "IRIS pgwire did not become ready on port 5435" >&2
exit 1
