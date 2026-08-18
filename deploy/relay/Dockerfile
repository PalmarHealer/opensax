# HTTP CONNECT relay for LernSax-bound traffic, to be run on the German
# Tailscale node. See README.md.
FROM alpine:3.21

RUN apk add --no-cache tinyproxy

# tinyproxy.conf is a template: docker-entrypoint.sh renders Listen/Allow from
# RELAY_LISTEN/RELAY_ALLOW at start-up, so the image carries no site-specific IPs.
COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf.template
COPY filter         /etc/tinyproxy/filter
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /run/tinyproxy \
 && chown tinyproxy:tinyproxy /run/tinyproxy

EXPOSE 8888

# tinyproxy drops to the tinyproxy user itself (User/Group in the config), so
# the entrypoint starts as root to bind and render the config.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
