#!/bin/sh
# Generate js/core/Config.js before nginx starts.
#
# The official nginx image runs every executable /docker-entrypoint.d/*.sh in
# name order and only then execs nginx, so by the time the first request is
# served the config file exists.
#
# WHY AT RUNTIME RATHER THAN BUILD TIME
# docker-compose bind-mounts ./js over /usr/share/nginx/html/js, which would
# shadow anything baked into the image at that path. Generating here writes into
# the mount, so what nginx serves and what you see in the repo are the same
# file. It also means SERVER_BASE_URL is an environment variable you can change
# with a restart instead of a rebuild.
#
# Config.js is gitignored, so writing it into the repo is expected, not a
# surprise -- generate_config.sh has always done exactly this.

set -eu

ROOT=/usr/share/nginx/html

if [ ! -w "$ROOT/js/core" ]; then
    echo "[cem-config] $ROOT/js/core is not writable." >&2
    echo "[cem-config] The ./js bind mount must be read-write for the generated" >&2
    echo "[cem-config] Config.js. Drop the ':ro' in docker-compose.yml." >&2
    # Not fatal if a config already exists -- an older one still serves.
    [ -f "$ROOT/js/core/Config.js" ] || exit 1
    exit 0
fi

cd "$ROOT"
SERVER_BASE_URL="${SERVER_BASE_URL:-http://localhost:8002}" \
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
PICKER_API_KEY="${PICKER_API_KEY:-}" \
AIRFLOW_TRIGGER_URL="${AIRFLOW_TRIGGER_URL:-}" \
CORS_PROXY_URL="${CORS_PROXY_URL:-https://cem-proxy.cem-cors.workers.dev}" \
ANALYSIS_REPO_URL="${ANALYSIS_REPO_URL:-}" \
    sh "$ROOT/generate_config.sh"
