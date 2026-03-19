# Background Agents & Services

To keep physical hardware and the web dashboard synchronized, this system runs asynchronous Node.js agents so polling and fan-out execution do not block the HTTP event loop.

## 1. DAX88 Serial Monitor Agent (`dax88_monitor.js`)
**Purpose:** Reflect manual hardware overrides (for example, volume changes from wall keypads) in dashboard state.
- **Execution:** `setInterval` every **3000ms**.
- **Action:** Sends `?xx\r` (Ask Status) sequentially for active zones `01`-`08`.
- **Data Flow:** Parses responses shaped like `>xxaabbccddeeffgghhiijj\r`, normalizes zone state, updates shared in-memory state, then publishes deltas via WebSocket or SSE.
- **Error Handling:** On serial timeout or malformed frame, log with zone id, keep last known-good state, and continue polling the next zone (no loop abort).

### Contract
- **Input:** `{ activeZones: string[], serialPort: SerialPortLike, intervalMs?: number }`
- **Output:** `{ zoneStates: Record<string, ZoneState>, events: ZoneStateChangedEvent[] }`

## 2. Up2Stream Metadata Agent (`stream_poller.js`)
**Purpose:** Fetch near-real-time playback metadata and decode hex-encoded fields into readable text.
- **Execution:** `setInterval` every **5000ms**.
- **Action:** Performs HTTP `GET` to `http://[DEVICE_IP]/getPlayerStatus`.
- **Data Flow:** Reads `Title`, `Artist`, and `Album` hex fields, converts hex to ASCII/UTF-8-safe strings, stores decoded payload in cache, and serves cached metadata to frontend consumers to reduce concurrent device load.
- **Error Handling:** On request failure, non-200 response, or decode error, preserve prior cache entry, attach stale/error metadata, and retry on next interval.

### Contract
- **Input:** `{ deviceIp: string, httpClient: HttpClientLike, intervalMs?: number, cacheTtlMs?: number }`
- **Output:** `{ metadata: { title: string, artist: string, album: string, ... }, source: 'live' | 'cache', fetchedAt: string, error?: string }`

## 3. Zone Grouping Execution Agent (`zone_controller.js`)
**Purpose:** Implement logical multi-zone grouping by fanning one dashboard command into ordered per-zone serial writes.
- **Execution:** On-demand from HTTP `POST` dashboard actions.
- **Action:** Resolves logical group names (for example, `Sales Floor`) to zone arrays (for example, `['01','02','03']`) and emits per-zone serial commands like `<xxPPuu\r`.
- **Data Flow:** Iterates target zones in deterministic order with a mandatory **50ms** inter-write delay to protect the DAX88 serial buffer.
- **Error Handling:** If one zone write fails, record per-zone result, continue remaining writes, and return a partial-success summary.

### Contract
- **Input:** `{ groupId: string, command: ZoneCommand, groups: Record<string, string[]>, serialPort: SerialPortLike, interWriteDelayMs?: number }`
- **Output:** `{ requestId: string, results: Array<{ zoneId: string, ok: boolean, error?: string }>, summary: { total: number, succeeded: number, failed: number } }`
