# Deployment

This stack is three Docker containers — a SvelteKit web app, an MCP HTTP server, and an OnlyOffice DocumentServer — meant to sit behind a reverse proxy that terminates TLS.

## Architecture

| Service       | Container          | Internal port | Purpose                                              |
|---------------|--------------------|---------------|------------------------------------------------------|
| Web app       | `lernsax-web`      | `3000`        | UI + OAuth issuer + OnlyOffice callback              |
| MCP server    | `lernsax-mcp`      | `8765`        | Streamable-HTTP MCP endpoint at path `/mcp`          |
| OnlyOffice    | `lernsax-onlyoffice` | `80`        | DocumentServer for collaborative editing             |

The MCP **must be served from the same hostname as the web app**, mounted at `/mcp`. RFC 9728 / RFC 8414 discovery only works correctly when the protected resource and its authorization server share an origin.

OnlyOffice can live on a separate hostname (it just needs to be reachable from both the user's browser and the web container).

So a typical deployment uses two public hostnames:

- `https://<app>.example.com`        → web (`:3000`) + MCP (`:8765`, path-routed at `/mcp`)
- `https://<office>.example.com`     → OnlyOffice (`:80`)

## Bring-up

1. Copy `.env.example` → `.env` and fill in:

   ```
   LERNSAX_WEB_SESSION_KEY=<32+ char random>      # encrypts on-disk sessions
   ONLYOFFICE_JWT_SECRET=<long random>            # must match in both containers
   WEB_ORIGIN=https://<app>.example.com           # public URL of the web app
   ONLYOFFICE_PUBLIC_URL=https://<office>.example.com
   BIND_HOST=0.0.0.0                              # or a private IP if you only
                                                  # want the proxy to reach it
   ```

2. `docker compose up -d --build`

3. First run pulls OnlyOffice (~1.5 GB). You can pre-pull with `docker compose pull onlyoffice`.

By default the compose file binds container ports to `BIND_HOST` so you can keep the host's public interface clean and only expose via the reverse proxy.

## Reverse proxy

Whatever proxy you use (nginx, Caddy, Traefik, Nginx Proxy Manager, …) needs to:

### `<app>.example.com`

Default-route everything to `<docker-host>:3001` (the web container). Carve out `/mcp` and route it to `<docker-host>:8765` instead.

Example nginx snippet:

```nginx
server {
  server_name <app>.example.com;

  location /mcp {
    proxy_pass http://<docker-host>:8765;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
  }

  location / {
    proxy_pass http://<docker-host>:3001;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade           $http_upgrade;
    proxy_set_header Connection        "upgrade";
  }
}
```

Make sure TLS, HTTP/2 and websockets are on.

### `<office>.example.com`

Forward everything to `<docker-host>:3380`. Websockets are required (OnlyOffice uses them for live collaboration). No path rules needed.

## Auth flow for AI clients

Claude.ai (and any RFC 7591 / 8414 / 9728-compliant MCP client) discovers the OAuth flow as follows:

1. Client POSTs to `/mcp` without a bearer.
2. We respond `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
3. Client fetches that document → finds the authorization server and its `/.well-known/oauth-authorization-server` metadata.
4. Client POSTs `/oauth/register` (Dynamic Client Registration) → gets a `client_id`.
5. Client opens `/oauth/authorize?…` in the user's browser. The user — already logged into the SvelteKit app — sees a consent page listing scopes and approves.
6. We mint a 5-minute auth code, redirect to the client's `redirect_uri` with `code` + `state`.
7. Client POSTs `/oauth/token` with `grant_type=authorization_code` + the PKCE verifier → receives `access_token` (+ refresh).
8. MCP calls hit `/mcp` with `Authorization: Bearer <access_token>`. The MCP server reads the shared on-disk store, resolves the token to a user session, derives the LernSax credentials and runs the tool.

Users see and revoke active connections under **Einstellungen → Verbindungen**.

To bypass auth for local testing (e.g. with the MCP Inspector), set `LERNSAX_MCP_ALLOW_ANON=1` on the `lernsax-mcp` container.

## Data persistence

| Volume                  | Contents                                          |
|-------------------------|---------------------------------------------------|
| `lernsax-web-data`      | Encrypted session blobs (`/app/data/sessions`) + connection records (`/app/data/connections`); shared between web and MCP. |
| `onlyoffice-*`          | DocumentServer data, logs, file cache.            |

Sessions and connections survive `docker compose down`/`up`; deleting the volume forces every user to re-authenticate.

## Updating

```bash
git pull
docker compose build lernsax-web lernsax-mcp
docker compose up -d
```

`onlyoffice` only needs a rebuild when you bump the image tag in `docker-compose.yml`.
