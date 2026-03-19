# Tucson Music Freight Services - Office Audio Control

## Overview
This repository contains the Node.js middleware and HTML/JS frontend for the centralized office audio control system at `https://tucsonmusic.freightservices.net`. It bridges an HTTP-based web dashboard with a Dayton Audio DAX88 matrix amplifier (via RS-232) and Up2Stream/Arylic audio modules (via HTTP API).

## Architecture
The system operates on a unified controller model:
1. **Frontend:** Vanilla HTML/JS dashboard hosted via Nginx reverse proxy.
2. **Middleware:** Node.js Express server executing bidirectional communication.
3. **Hardware Integration:**
   * **DAX88 Matrix:** Controlled via `serialport` over USB-to-RS232. 
   * **Up2Stream Modules:** Controlled via `axios` HTTP GET requests.

## Prerequisites
* Linux-based server (Ubuntu/Debian recommended).
* Node.js (v20.x).
* Nginx (configured for SSL termination).
* USB-to-RS232 adapter connected to the DAX88.

## Installation
1. Clone the repository: `git clone [repository_url]`
2. Navigate to the directory: `cd audio-control`
3. Install dependencies: `npm install`
4. Ensure serial port permissions: `sudo usermod -a -G dialout $USER`
5. Start the server: `node server.js` (or use PM2 for process management).

## Hardware Configuration
### DAX88 RS-232 Parameters
* **Baud Rate:** 9600
* **Data Bits:** 8
* **Parity:** None
* **Stop Bits:** 1
* **Terminator:** Carriage Return (`\r` or `0x0D`)

### Up2Stream API Notes
* All HTTP requests expect a JSON response.
* Track metadata (Title, Artist, Album) is returned as hex-encoded strings and must be converted to ASCII before frontend delivery.

## API Endpoints (Internal)
* `POST /api/dax88/volume` - Sets zone volume (00-38).
* `POST /api/dax88/power` - Toggles zone power.
* `POST /api/dax88/source` - Sets zone input source (1-8).
* `GET /api/stream/status` - Fetches decoded playback status from Up2Stream modules.
