#!/bin/sh
set -eu
case "$(printf '%s' "${DEBUG:-false}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    1|true|yes|on) debug_enabled=true ;;
    *) debug_enabled=false ;;
esac
# Outside the read-only source mounts; only a boolean reaches the browser.
printf 'globalThis.CEM_DEBUG = %s;\n' "$debug_enabled" > /usr/share/nginx/html/runtime-debug.js

