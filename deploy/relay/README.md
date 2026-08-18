# LernSax DE egress relay (over Tailscale)

The deployment runs in Vienna, but LernSax must see requests from a German IP.
We route all LernSax-bound traffic — JSON-RPC, WebDAV, and the OnlyOffice web
login — through an HTTP `CONNECT` proxy on a German Tailscale node. Tailscale is
the encrypted transport between Vienna and the relay; the proxy tunnels the TLS
to LernSax without terminating it, so LernSax sees the relay's public IP.

Only LernSax egress is relayed. Everything else (OnlyOffice, image pulls, etc.)
still goes out directly from Vienna.

```
Vienna container ──fetch(dispatcher=ProxyAgent)──► Tailscale ──► DE node :8888 ──CONNECT──► www.lernsax.de
   LERNSAX_PROXY_URL=http://100.x.y.z:8888                         tinyproxy            (sees the DE IP)
```

## 1. German node (the relay)

The node must already be on your tailnet (`tailscale status`). Then:

```sh
sudo apt-get update && sudo apt-get install -y tinyproxy

# This node's Tailscale IP — used for `Listen`:
tailscale ip -4

sudo cp tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
sudo cp filter        /etc/tinyproxy/filter
# Edit /etc/tinyproxy/tinyproxy.conf:
#   - Listen  <this node's 100.x.y.z>
#   - Allow   <the Vienna node's 100.x.y.z>
sudo systemctl enable --now tinyproxy
sudo systemctl restart tinyproxy
```

Notes:
- `Listen` binds to the tailnet interface only — the proxy is never exposed to
  the public internet.
- `FilterDefaultDeny Yes` + `filter` mean only `www.lernsax.de` can be reached;
  `ConnectPort 443` limits it to HTTPS. It is not a general-purpose open proxy.

## 2. Vienna deployment

Set `LERNSAX_PROXY_URL` to the relay's Tailscale IP. Put it in your `.env`
(picked up by `docker-compose.yml` for both `lernsax-web` and `lernsax-mcp`):

```sh
LERNSAX_PROXY_URL=http://100.x.y.z:8888   # the DE node's Tailscale IP
```

The Vienna **host** must be on the tailnet (`tailscale status`). Containers on
the default Docker bridge reach `100.x` addresses through the host's
`tailscale0` route automatically (outbound traffic is masqueraded through the
host) — no `--network host` or extra routing needed. Use the raw `100.x.y.z`
IP, not a MagicDNS name: containers don't use the host's MagicDNS resolver.

Then redeploy:

```sh
docker compose up -d --build
```

## 3. Verify

The relay is active when LernSax sees the DE IP. Quick checks:

```sh
# From the Vienna host: the proxy tunnels HTTPS to LernSax
curl -x http://100.x.y.z:8888 https://www.lernsax.de/ -I

# From inside the running container, confirm it can reach the relay
docker compose exec lernsax-web wget -qO- --timeout=5 \
  --header 'Proxy: ' http://100.x.y.z:8888 ; echo

# tinyproxy logs on the DE node show the CONNECT to www.lernsax.de:443
sudo journalctl -u tinyproxy -f
```

To disable the relay, unset `LERNSAX_PROXY_URL` and redeploy — the app falls
back to talking to LernSax directly.
