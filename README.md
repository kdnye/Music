# Tucson Music Freight Services - Office Audio Control

## Overview
This repository contains a working Node.js project for centralized office audio control. It provides:
- An Express API for DAX88 serial commands (volume/power/source).
- An Up2Stream status proxy with metadata decoding.
- A lightweight vanilla HTML dashboard served from `public/index.html`.

## Project Structure
- `server.js` - Express entrypoint, API routes, auth/rate limiting, and request logging.
- `src/api/security.js` - Central request logging, bearer token auth, and per-endpoint rate limiting.
- `src/api/validators.js` - Central payload and URL validation for control/status operations.
- `src/dax88/commands.js` - DAX88 serial command formatting.
- `src/dax88/serialClient.js` - Serial port write client (`serialport`).
- `src/stream/statusService.js` - Up2Stream HTTP fetch + metadata decoding (`axios`).
- `public/index.html` - Minimal dashboard UI for testing endpoints.

## Prerequisites
- Node.js 20+
- Linux host with serial access (for real DAX88 hardware control)

## Installation

### 1) Clone into the expected repository folder
```bash
git clone <YOUR_REPO_URL> Music
cd Music
```

### 2) Install dependencies
```bash
npm install
```

### 3) Runtime environment prerequisites
Create a `.env` file (or export variables in your shell) before startup:

```bash
# API bind port
PORT=3000

# DAX88 serial path on the host machine
DAX88_SERIAL_PORT=/dev/ttyUSB0

# Up2Stream module IP (single module)
UP2STREAM_IP=192.168.1.55
# optional alternative
UP2STREAM_BASE_URL=http://192.168.1.55

# REQUIRED: bearer token for authenticated control endpoints
API_AUTH_TOKEN=replace-with-long-random-token

# REQUIRED for dashboard browser login (same-origin auth bootstrap)
DASHBOARD_LOGIN_PASSWORD=replace-with-long-random-password

# Optional: short-lived browser token TTL in milliseconds (default 300000 = 5 minutes)
BROWSER_TOKEN_TTL_MS=300000

# Optional: request rate limiting on control endpoints (defaults shown)
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=60


# Optional: group mapping JSON string (overrides file groups by key)
# Example: {"sales-floor":["01","02","03"]}
DAX88_ZONE_GROUPS=

# Optional: path to group mapping file (default: ./config/groups.json)
DAX88_GROUPS_FILE=./config/groups.json
```

Optional runtime flags:
- `DAX88_SERIAL_DISABLED=true` for development without physical serial hardware.
- `UP2STREAM_TIMEOUT_MS=4000` to tune metadata polling request timeout.
- `UP2STREAM_CACHE_TTL_MS=20000` to control how long cached metadata is considered fresh before being marked stale.
- `DAX88_INTER_WRITE_DELAY_MS=50` and `DAX88_QUEUE_TASK_TIMEOUT_MS=2500` to tune global serial FIFO queue pacing/timeouts.
- Polling loops include built-in retry backoff at 10s, 30s, and 60s after repeated failures; hardware is marked offline after 3 consecutive failures.
- On process boot, the service performs an immediate DAX88 cold-start sweep (`?01`..`?08`) before opening the HTTP listener so `/api/state` and SSE start with populated zone cache.

> Multiple Up2Stream IPs: this service currently reads one `UP2STREAM_BASE_URL` per process. For multiple modules, run one process per module with different `UP2STREAM_BASE_URL` and (if needed) different `PORT`.

### 4) Start the service
```bash
npm run start
```

Expected success output:
```text
Audio middleware listening on http://localhost:3000
```

For development with restart-on-change:
```bash
npm run dev
```

Then open:
- Dashboard: `http://localhost:3000/`
- Health: `http://localhost:3000/api/health`

## Security Controls

### 1) Authentication on control endpoints
- All control endpoints under `/api/dax88/*` require `Authorization: Bearer <token>`.
- Allowed token sources:
  - `API_AUTH_TOKEN` (for server-to-server or CLI clients), or
  - a short-lived browser token issued by `POST /api/auth/login`.
- Browser login flow:
  1. Operator opens dashboard on same origin.
  2. Operator submits dashboard password to `POST /api/auth/login`.
  3. Backend validates `DASHBOARD_LOGIN_PASSWORD` server-side.
  4. Backend issues short-lived scoped bearer token (TTL controlled by `BROWSER_TOKEN_TTL_MS`).
  5. Dashboard keeps controls disabled until authenticated and includes the issued token in `Authorization` headers for control calls.
- Missing, invalid, or expired tokens receive `401 UNAUTHORIZED`.
- If neither `API_AUTH_TOKEN` nor `DASHBOARD_LOGIN_PASSWORD` is configured, control endpoints fail closed with `503 AUTH_NOT_CONFIGURED`.

### 2) Central input validation
- Control payloads are validated centrally in `src/api/validators.js` before serial writes:
  - `zone` must be integer `1..8`
  - `volume` must be integer `0..38`
  - `source` must be integer `1..8`
  - `power` must be boolean or `on/off/true/false/1/0`
- Unknown JSON fields are rejected to prevent command ambiguity.
- Upstream stream URL is validated before HTTP fetch (`UP2STREAM_BASE_URL` must be valid `http/https` URL).

### 3) Rate limiting + request logging
- `/api/dax88/*` requests are rate-limited per client IP and endpoint.
- Defaults: `60` requests per `60` seconds (`API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS`).
- Breaches return `429 RATE_LIMITED`.
- Structured logs are emitted for every request with:
  - timestamp
  - requestId
  - client IP
  - method + path
  - status code
  - latency
  - user-agent

## Network Segmentation and TLS Boundaries

This service assumes three security zones:

1. **Dashboard client zone** (user workstations / browser clients)
   - Should only reach the middleware through a reverse proxy or API gateway.
2. **Middleware host zone** (this Node.js service)
   - Should be the only host allowed to call:
     - RS-232 adapter host / USB serial bridge for DAX88
     - Up2Stream module subnet
3. **Device zone** (DAX88 + Up2Stream modules)
   - Should not be directly reachable from user workstations.

Recommended policy model:
- Allow dashboard-to-middleware traffic only (deny direct dashboard-to-device traffic).
- Allow middleware-to-device traffic only on required protocols/ports.
- Deny east-west traffic inside device subnet except required control paths.

TLS termination boundary:
- Terminate TLS at the reverse proxy/load balancer in front of middleware.
- Use HTTPS between dashboard clients and the proxy.
- Between proxy and middleware, use one of:
  - loopback/private interface on same host, or
  - mTLS on internal network if crossing hosts/VLANs.
- Device-side protocols (serial, legacy module HTTP APIs) may be non-TLS; isolate these on trusted internal segments and firewall aggressively.


## Reverse Proxy and Process Hardening

### Nginx SSE tuning (required)
If Nginx fronts this service, disable proxy buffering for `/api/state/stream` so SSE messages are delivered immediately.

```nginx
location /api/state/stream {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;

    # Critical for Server-Sent Events
    proxy_buffering off;
    chunked_transfer_encoding off;
    proxy_read_timeout 24h;
}
```

After editing `/etc/nginx/sites-available/tucsonmusic`, run:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### PM2 log rotation (required for long-running agents)
Prevent unbounded `out.log` / `err.log` growth by enabling PM2 log rotation:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## API Endpoints
### `POST /api/auth/login`
Body:
```json
{ "password": "operator-entered-password" }
```

Success response includes:
```json
{
  "success": true,
  "data": {
    "token": "<short-lived-browser-token>",
    "expiresAt": "2026-03-19T12:00:00.000Z"
  }
}
```

### `GET /api/auth/status`
Headers:
```http
Authorization: Bearer <API_AUTH_TOKEN|short-lived-browser-token>
```

### `POST /api/dax88/volume`
Headers:
```http
Authorization: Bearer <API_AUTH_TOKEN|short-lived-browser-token>
```
Body:
```json
{ "zone": 1, "volume": 20 }
```

### `POST /api/dax88/power`
Headers:
```http
Authorization: Bearer <API_AUTH_TOKEN|short-lived-browser-token>
```
Body:
```json
{ "zone": 1, "power": "on" }
```

### `POST /api/dax88/source`
Headers:
```http
Authorization: Bearer <API_AUTH_TOKEN|short-lived-browser-token>
```
Body:
```json
{ "zone": 1, "source": 3 }
```


### `POST /api/dax88/group/:groupId/volume`
Headers:
```http
Authorization: Bearer <API_AUTH_TOKEN|short-lived-browser-token>
```
Body:
```json
{ "volume": 20 }
```

Returns per-zone results and aggregate summary:
```json
{
  "success": true,
  "data": {
    "groupId": "sales-floor",
    "volume": 20,
    "results": [
      { "zoneId": "01", "ok": true },
      { "zoneId": "02", "ok": false, "error": "..." }
    ],
    "summary": { "total": 2, "succeeded": 1, "failed": 1 },
    "requestId": "..."
  }
}
```

### `GET /api/stream/status`
Fetches `GET [UP2STREAM_BASE_URL]/getPlayerStatus`, decodes `Title`, `Artist`, and `Album` if they are hex-encoded, and returns structured JSON. If polling or decode fails, the endpoint serves the last known-good cached payload with stale indicators instead of hard-failing where possible.

## Troubleshooting
| Issue | Likely cause | Resolution |
|---|---|---|
| Dashboard controls stay disabled | User has not logged in or browser token expired. | Log in from the dashboard using `DASHBOARD_LOGIN_PASSWORD`; if idle for longer than `BROWSER_TOKEN_TTL_MS`, re-authenticate. |
| `401 UNAUTHORIZED` on control endpoint | Missing/invalid/expired bearer token. | Send `Authorization: Bearer <API_AUTH_TOKEN>` (automation) or re-login for a fresh short-lived dashboard token. |
| `503 AUTH_NOT_CONFIGURED` on control endpoint | `API_AUTH_TOKEN` missing on server. | Set `API_AUTH_TOKEN` and restart service. |
| `429 RATE_LIMITED` | Too many control requests from same client + endpoint within rate window. | Reduce call frequency or increase `API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS` carefully. |
| Serial permission denied (`EACCES`, `EPERM`) | User is not in the serial-access group for `/dev/tty*`. | Add your user to the device group (commonly `dialout`), then log out/in. Confirm with `ls -l /dev/ttyUSB0`. |
| Serial device path unavailable (`ENOENT`) | `DAX88_SERIAL_PATH` points to a non-existent device. | Verify the actual device path (`/dev/ttyUSB0`, `/dev/ttyACM0`, etc.) and update `DAX88_SERIAL_PATH`. |
| Up2Stream status fetch fails (`ECONNREFUSED`, timeout, 5xx) | Module IP is wrong/unreachable or module is offline. | Confirm `UP2STREAM_BASE_URL`, test `http://<IP>/getPlayerStatus` directly, and verify network/subnet connectivity. |

## Notes
- Email integrations should use Postmark per project directive.
- For higher-assurance deployments, replace or augment bearer token auth with mTLS between proxy and middleware.
