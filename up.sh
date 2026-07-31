#!/usr/bin/env bash
# Bring the survival testbed up. Always run from this script's directory so the
# relative build contexts (../battleofgeniuses/*) resolve.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env.testbed"
SRC_REPO="../battleofgeniuses"

[ -f "$ENV_FILE" ] || { echo "❌ $ENV_FILE not found in $(pwd)"; exit 1; }
[ -d "$SRC_REPO" ] || { echo "❌ $SRC_REPO not found — the services are built from there"; exit 1; }
[ -f "$SRC_REPO/main-server/keys/auth.key" ] || { echo "❌ $SRC_REPO/main-server/keys/auth.key missing"; exit 1; }
for p in question_server fight_server survival_server tournament_server academy_server; do
  [ -f "$SRC_REPO/proto/$p.proto" ] || { echo "❌ $SRC_REPO/proto/$p.proto missing"; exit 1; }
done

# Safety net: refuse to start if any *value* in the env file points outside this
# machine. The source repo's .env.dev has a REMOTE mongo in it. Comment lines are
# skipped on purpose — the header names those hosts so they stay recognisable.
if sed -e 's/[[:space:]]*#.*$//' "$ENV_FILE" |
   grep -nE '165\.227\.143\.145|176\.9\.78\.228|95\.216\.114\.174|battleofgeniuses\.com'; then
  echo "❌ $ENV_FILE assigns a REMOTE host (see above). Refusing to start."
  exit 1
fi

echo "🛠  Building & starting the survival testbed..."
docker compose --env-file "$ENV_FILE" up -d --build "$@"

echo
docker compose --env-file "$ENV_FILE" ps
echo
echo "✅ Up. Ports:"
echo "   mongo           127.0.0.1:27077"
echo "   questions-api   http://127.0.0.1:3001   (gRPC 5556)"
echo "   main-server     127.0.0.1:7000  (also 127.0.0.1:7010)"
echo "   fight-server    127.0.0.1:7777"
echo "   survival-server 127.0.0.1:4001  (gRPC 5010)"
echo
echo "👉 Logs: docker compose --env-file $ENV_FILE logs -f survival-server"
echo "👉 Stop: ./down.sh"
