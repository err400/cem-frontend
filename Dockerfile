# CEM Frontend - static SPA served by nginx.
# Code is not baked in for local/dev use: docker-compose mounts the repo over
# /usr/share/nginx/html so a restart (no rebuild) picks up new code, matching
# the backend's bind-mount pattern. The COPY below only matters for a
# standalone image build (e.g. pushing to a registry) with no compose mount.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/15-debug.sh /docker-entrypoint.d/15-debug.sh
RUN chmod +x /docker-entrypoint.d/15-debug.sh
COPY runtime-debug.js /usr/share/nginx/html/runtime-debug.js

# js/core/Config.js is generated when the container starts, not baked in --
# docker-compose bind-mounts ./js over the image's copy, so anything written
# here at build time would be shadowed. The official nginx entrypoint runs
# /docker-entrypoint.d/*.sh before exec'ing nginx.
COPY generate_config.sh /usr/share/nginx/html/generate_config.sh
COPY docker-entrypoint.d/10-cem-config.sh /docker-entrypoint.d/10-cem-config.sh
RUN chmod +x /docker-entrypoint.d/10-cem-config.sh /usr/share/nginx/html/generate_config.sh

COPY index.html /usr/share/nginx/html/index.html
COPY js /usr/share/nginx/html/js
COPY styles /usr/share/nginx/html/styles
COPY leaflet /usr/share/nginx/html/leaflet
COPY images /usr/share/nginx/html/images
COPY watcher.py /usr/share/nginx/html/watcher.py

EXPOSE 80
