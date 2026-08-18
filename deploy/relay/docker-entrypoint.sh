#!/bin/sh
# Renders tinyproxy.conf from the checked-in template, substituting the two
# values that are deployment-specific: which address to listen on, and who may
# connect. Everything else (the domain filter, ConnectPort 443, FilterDefaultDeny)
# is policy and stays in the template.
set -eu

: "${RELAY_LISTEN:?set RELAY_LISTEN to this node's Tailscale IP (tailscale ip -4)}"

TEMPLATE=/etc/tinyproxy/tinyproxy.conf.template
CONF=/tmp/tinyproxy.conf

# Drop the template's placeholder Listen/Allow lines; we regenerate both below.
sed -E '/^[[:space:]]*(Listen|Allow)[[:space:]]/d' "$TEMPLATE" > "$CONF"

echo "Listen $RELAY_LISTEN" >> "$CONF"

# RELAY_ALLOW is a comma-separated list of Tailscale IPs/CIDRs permitted to use
# the relay — normally just the Vienna node. Leaving it unset means tinyproxy
# allows any source that can reach the listening address; since that address is
# the tailnet interface, the tailnet remains the trust boundary either way.
if [ -n "${RELAY_ALLOW:-}" ]; then
  echo "$RELAY_ALLOW" | tr ',' '\n' | while read -r a; do
    a=$(echo "$a" | tr -d '[:space:]')
    [ -n "$a" ] && echo "Allow $a" >> "$CONF"
  done
else
  echo "warning: RELAY_ALLOW unset — any host that can reach $RELAY_LISTEN may use the relay" >&2
fi

exec tinyproxy -d -c "$CONF"
