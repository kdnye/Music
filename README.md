# Tucson Music Freight Services - Office Audio Control

## Overview
This repository contains a working Node.js project for centralized office audio control. It provides:
- An Express API for DAX88 serial commands (volume/power/source).
- An Up2Stream status proxy with metadata decoding.
- A lightweight vanilla HTML dashboard served from `public/index.html`.

## Project Structure
- `server.js` - Express entrypoint and API routes.
- `src/dax88/commands.js` - DAX88 validation and serial command formatting.
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
DAX88_SERIAL_PATH=/dev/ttyUSB0

# Up2Stream module IP (single module)
UP2STREAM_BASE_URL=http://192.168.1.55
```

Optional runtime flags:
- `DAX88_SERIAL_DISABLED=true` for development without physical serial hardware.
- `UP2STREAM_TIMEOUT_MS=4000` to tune metadata polling request timeout.

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

### Troubleshooting
| Issue | Likely cause | Resolution |
|---|---|---|
| Serial permission denied (`EACCES`, `EPERM`) | User is not in the serial-access group for `/dev/tty*`. | Add your user to the device group (commonly `dialout`), then log out/in. Confirm with `ls -l /dev/ttyUSB0`. |
| Serial device path unavailable (`ENOENT`) | `DAX88_SERIAL_PATH` points to a non-existent device. | Verify the actual device path (`/dev/ttyUSB0`, `/dev/ttyACM0`, etc.) and update `DAX88_SERIAL_PATH`. |
| Up2Stream status fetch fails (`ECONNREFUSED`, timeout, 5xx) | Module IP is wrong/unreachable or module is offline. | Confirm `UP2STREAM_BASE_URL`, test `http://<IP>/getPlayerStatus` directly, and verify network/subnet connectivity. |

## API Endpoints
### `POST /api/dax88/volume`
Body:
```json
{ "zone": 1, "volume": 20 }
```

### `POST /api/dax88/power`
Body:
```json
{ "zone": 1, "power": "on" }
```

### `POST /api/dax88/source`
Body:
```json
{ "zone": 1, "source": 3 }
```

### `GET /api/stream/status`
Fetches `GET [UP2STREAM_BASE_URL]/getPlayerStatus`, decodes `Title`, `Artist`, and `Album` if they are hex-encoded, and returns structured JSON.

## Notes
- To keep this project secure and maintainable, all control routes validate input ranges and return consistent JSON error shapes.
- Email integrations should use Postmark per project directive.
