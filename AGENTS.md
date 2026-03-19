# Background Agents & Services

To maintain synchronization between the physical hardware and the web dashboard, this system utilizes specific background polling agents within the Node.js environment. These agents operate asynchronously to prevent blocking the main HTTP event loop.

## 1. DAX88 Serial Monitor Agent (`dax88_monitor.js`)
**Purpose:** Ensures the web dashboard reflects manual overrides (e.g., a user adjusting volume via a physical wall keypad).
* **Execution:** Runs on a `setInterval` loop (every 3000ms).
* **Action:** Issues the `?xx\r` (Ask Status) command sequentially for active zones (01-08).
* **Data Handling:** Parses the return string (`>xxaabbccddeeffgghhiijj\r`), updates the internal Node.js state object, and broadcasts changes to connected frontend clients via WebSockets or Server-Sent Events (SSE).

## 2. Up2Stream Metadata Agent (`stream_poller.js`)
**Purpose:** Fetches real-time playback data and converts hex-encoded metadata to human-readable text.
* **Execution:** Runs on a `setInterval` loop (every 5000ms).
* [cite_start]**Action:** Executes an HTTP GET request to `http://[DEVICE_IP]/getPlayerStatus`[cite: 99].
* [cite_start]**Data Handling:** * Intercepts the `Title`, `Artist`, and `Album` hex string values[cite: 105, 218].
  * [cite_start]Executes a Hex-to-ASCII conversion algorithm[cite: 219].
  * Caches the decoded JSON object to serve to the frontend, reducing concurrent HTTP load on the Arylic hardware.

## 3. Zone Grouping Execution Agent (`zone_controller.js`)
**Purpose:** Overcomes the DAX88's lack of native multi-zone serial grouping by fanning out single commands into sequential arrays.
* **Execution:** Triggered on-demand via HTTP POST requests from the dashboard.
* **Action:** Maps a logical group (e.g., "Sales Floor") to a physical array of zones (e.g., `['01', '02', '03']`).
* **Data Handling:** Iterates through the array and writes individual `<xxPPuu\r` strings to the serial buffer. Includes a mandatory 50ms delay between writes to prevent buffer overflow on the DAX88's serial receiver.
