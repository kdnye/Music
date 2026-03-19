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
```bash
npm install
```

## Environment Variables
- `PORT` (optional, default `3000`)
- `DAX88_SERIAL_PATH` (optional, default `/dev/ttyUSB0`)
- `DAX88_SERIAL_DISABLED` (optional, set `true` to skip serial writes for development)
- `UP2STREAM_BASE_URL` (required for `/api/stream/status`, e.g. `http://192.168.1.55`)
- `UP2STREAM_TIMEOUT_MS` (optional, default `4000`)

## Run
```bash
npm start
```

For development with restart-on-change:
```bash
npm run dev
```

Then open:
- Dashboard: `http://localhost:3000/`
- Health: `http://localhost:3000/api/health`

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
