#!/usr/bin/env bash
# Stop the survival testbed. Pass -v to also drop the mongo volume.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env.testbed"

echo "⛔ Stopping the survival testbed..."
docker compose --env-file "$ENV_FILE" down "$@"
echo "✅ Down."
if [[ " $* " != *" -v "* && " $* " != *" --volumes "* ]]; then
  echo "ℹ️  Mongo data kept in the survival-testbed_mongo-data volume (./down.sh -v to wipe it)."
fi
