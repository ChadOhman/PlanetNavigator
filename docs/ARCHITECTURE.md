# PlanetNavigator Architecture

## Overview

PlanetNavigator is a two-part system: a BepInEx 5 plugin running in The Planet Crafter process, and an Electron desktop application communicating with it over HTTP + Server-Sent Events.

```
The Planet Crafter (Windows)
  └─ BepInEx 5 (Mono)
      └─ PlanetNavigator Plugin
          ├─ Samples game state (position, planet, scanned nodes) at 10 Hz
          ├─ Scans POI database every ~20 s (when a client connected in last 60 s)
          └─ Serves HTTP JSON + SSE on http://127.0.0.1:27641

Electron App (Desktop)
  ├─ Connects via HTTP/SSE
  ├─ Renders OpenLayers map per planet
  ├─ Displays live player arrow, resources, filters
  └─ Maintains persistent POI cache in userData
```

## Transport

### HTTP Server

- **Binding**: `System.Net.HttpListener` bound to `127.0.0.1:27641`
  - No `http.sys` registration, no URL ACL required, no firewall prompt
  - Listens on localhost only; requests from other machines are rejected at the socket layer
- **Accept Loop**: Background thread continuously accepts and processes HTTP requests
- **Responses**: All JSON responses include `Access-Control-Allow-Origin: *` header
- **OPTIONS Method**: Returns 204 No Content

### Server-Sent Events (SSE)

- **Endpoint**: `GET /api/events`
- **Initial Send**: On connect, immediately sends `retry: 2000` followed by current `planet`, `position` (if in game), and `pois` events
- **Chunked Transfer**: Uses `SendChunked = true` and explicit `Flush()` calls to send events in real time
- **Events Sent**:
  - `position` — 10 Hz (player position updates)
  - `planet` — when player changes planets (sent before matching position)
  - `pois` — when POI scan completes (includes `scanId` and `planet`)
  - Keepalive comment (`: keepalive`) every 15 seconds
- **Limits**: At most 16 concurrent streams; further connections get `503` with a JSON error
- **Client Activity**: Every open SSE stream continuously marks the client as active (counts toward the 60-second activity window for automatic scans)
- **Fallback**: Clients that do not support SSE can poll `GET /api/position` and `GET /api/pois` instead

## Threading Model

### Main Unity Thread

- `Update()` runs every frame (~60 Hz on player's machine)
- Samples current player position, planet, and heading every 100 ms (10 Hz logical sampling)
- Stores immutable snapshot into a thread-safe reference (published for HTTP handler threads to read)
- Drains command queue (see below) and processes commands like "rescan"

### HTTP Handler Threads

- Background thread pool threads handle incoming HTTP requests
- Read from published position snapshot (immutable, no locking needed)
- Call into POI cache for scan responses

### POI Scan Coroutine

- Runs as a Unity coroutine (executes on main thread, yields to avoid frame stalls)
- Triggered every ~20 seconds if any HTTP client was seen in the last 60 seconds
- Also triggered immediately when planet changes and after a Unity scene load (with a follow-up scan 5 seconds later once objects have streamed in)
- Scans the persistent resource node database
- Spreads over multiple frames (400 objects per frame) to keep frame time reasonable
- Updates `scanId` on completion, notifying connected clients via SSE
- If planet changes mid-scan, the result is discarded and a new scan starts

### Command Queue

- `ConcurrentQueue<Command>` receives POST requests from the app
- `Update()` drains the queue and executes commands on the main thread (where Unity APIs are safe)
- Supports commands like `{type: "rescan"}` to trigger an immediate POI scan

## HTTP API

All endpoints bind to `http://127.0.0.1:27641/api/`.

### `GET /api/status`

Returns plugin and game metadata.

**Response:**
```json
{
  "modVersion": "0.1.0",
  "gameVersion": "1.519",
  "port": 27641,
  "planet": "Prime",
  "playerName": "Player",
  "scanId": 42,
  "poiCount": 1843,
  "ti": 1523344.25,
  "lushThreshold": 1000000.0,
  "uptimeSeconds": 812.4,
  "sseClients": 1
}
```

- `modVersion`: PlanetNavigator plugin version
- `gameVersion`: `UnityEngine.Application.version`
- `port`: Port actually bound (see fallback section)
- `planet`: Current planet name (e.g., "Prime", "Humble", "Selenea", "Aqualis", "Toxicity", "Skeo"); `null` in the menu
- `playerName`: Local player name; `null` in the menu
- `scanId`: Monotonic ID of last completed POI scan; 0 before first scan
- `poiCount`: Items in the latest scan
- `ti`: Terraformation index of the current planet; 0 if unknown
- `lushThreshold`: Start value of the planet's moss terraform stage; 0 if unknown
- `uptimeSeconds`: Seconds since the server started
- `sseClients`: Open `/api/events` streams

### `GET /api/position`

Returns live player position and heading.

- `200` with the body below while a planet is loaded.
- `204 No Content` (empty body) in the main menu / while loading.

**Response:**
```json
{
  "t": 1790000000123.0,
  "planet": "Prime",
  "ti": 1523344.25,
  "players": [
    {
      "id": 0,
      "name": "Player",
      "x": 100.5,
      "y": 50.0,
      "z": -200.3,
      "heading": 0.0,
      "isLocal": true
    }
  ]
}
```

- `t`: Unix time in milliseconds
- `planet`: Current planet
- `ti`: Terraformation index
- `players`: Array of player positions
  - `id`: Index in the game's `PlayersManager.playersControllers` list (stable while nobody joins/leaves)
  - `name`: Player name
  - `x`, `y`, `z`: World position in game coordinates (y is altitude)
  - `heading`: Degrees clockwise from +z
  - `isLocal`: `true` for the controlled player

### `GET /api/pois?since=<scanId>`

Returns scanned Points of Interest (resource nodes).

- `200` with the full list.
- `304 Not Modified` (empty body) if `since` equals the current `scanId`.

**Response:**
```json
{
  "planet": "Prime",
  "scanId": 7,
  "t": 1790000000456.0,
  "items": [
    {
      "id": "Iron@412:37:-1190",
      "kind": "minable",
      "group": "Iron",
      "x": 412.3,
      "y": 37.1,
      "z": -1190.2
    },
    {
      "id": "Seed0@15:22:47",
      "kind": "grabable",
      "group": "Seed0",
      "x": 15.2,
      "y": 22.3,
      "z": 47.0
    }
  ]
}
```

- `planet`: Current planet
- `scanId`: Scan ID of this result
- `t`: Unix time in milliseconds
- `items`: Array of POIs

**POI Fields:**
- `id`: Format `${group}@${roundX}:${roundY}:${roundZ}` (coordinates rounded to nearest integer, invariant culture)
- `kind`: One of `minable`, `grabable`, or `openable`
- `group`: Game group id (raw identifier, e.g., "Iron", "Seed0")
- `x`, `y`, `z`: World position in game coordinates

### `GET /api/events`

Server-Sent Events stream. Content-Type: text/event-stream, chunked, kept open. On connect immediately sends `retry: 2000` followed by the current `planet`, `position` (if in game) and `pois` events. The server checks state every 100 ms and emits only what changed.

**Events:**

1. `retry: 2000` — Sent once on connect (tells client to retry on disconnect after 2 seconds)
2. `event: planet\ndata: {"planet":"Prime"}\n\n` — On connect and whenever planet changes (sent before matching position)
3. `event: position\ndata: {...}\n\n` — Each new position sample (same JSON as `GET /api/position`), 10 Hz
4. `event: pois\ndata: {"scanId":7,"planet":"Prime"}\n\n` — On connect and when scan completes (planet is `null` when scanId is 0)
5. `: keepalive\n` — Comment every 15 seconds

### `POST /api/command`

Sends commands to the mod. Body: a JSON object with a string `type`.

**Request:**
```json
{
  "type": "rescan"
}
```

**Responses:**

| Status | Body | When |
|---|---|---|
| `202` | `{"queued":true}` | Accepted (also for unknown types, which are ignored and logged once per type) |
| `400` | `{"error":"bad json: expected an object with a string \"type\""}` | Malformed JSON or missing/non-string `type` |
| `413` | `{"error":"body too large"}` | Body over 64 KiB |
| `503` | `{"error":"command queue full"}` | More than 256 commands waiting |

Commands are queued and executed on the game's main thread on the next frame(s).

Supported commands:
- `{type: "rescan"}` — Requests a POI scan at the next once-per-second check

## Map Model

### Coordinate System

- **Game coordinates**: `[x, y, z]` where `y` is altitude, `x` and `z` are horizontal
- **Map coordinates**: `[x, z]` (OpenLayers pixel projection; y/altitude is not used in 2D map)
- **Tile grid origin**: `[minX, maxZ]` (tile [0,0] at top-left, in-world coordinates)

### Per-Planet Extents

Bounding boxes for each planet (in game world coordinates, `[minX, minZ, maxX, maxZ]`):

- **Prime**: `[-2000, -2000, 3000, 3000]`
- **Humble**: `[-2300, -2300, 2700, 2700]`
- **Selenea**: `[-2000, -2000, 3000, 3000]`
- **Aqualis**: `[-3000, -3000, 4000, 4000]`
- **Toxicity**: `[-2200, -2200, 2800, 2800]`
- **Skeo**: `[-4600, -200, 1900, 6300]`

### Tile Grid

- **Tile size**: 256 × 256 pixels
- **Levels**: Pyramid levels from 0 (overview) to max zoom
- **Resolution**: For planet `P`, `resolutions[z] = size_P / (256 * 2^z)`
  - `size_P` is the width of the extent (e.g., 5000 for Prime)
- **Tile path**: `tiles/<Planet>/<variant>/{z}/{x}/{y}.webp` with y counted downward from the top edge
- **Manifests**: Each variant has a per-variant `manifest.json`

### POI Identification

- **ID format**: `${group}@${roundX}:${roundY}:${roundZ}`
  - Example: `copper@100:50:200`
  - Coordinates are rounded to nearest integer for deduplication

### Calibration

Verified on 2026-09-27 that the akarnokd imagery is north-up (top edge = maxZ, left edge = minX) with the listed extents, by comparing a tile around the player's real position (Prime, x≈854, z≈-637) against the equivalent reference tile. No flip or offset is needed.

### Verified against the live game

Game v2.103 (Steam build 25296421), BepInEx 5.4.23.5. Position streams at 10 Hz over SSE. A scan of the loaded Prime save returned 814 POIs (763 minable, 51 grabable) in ~50–85 ms spread over 3 frames. Note that `grabable` includes loose items inside the player's base (seeds, food, posters), which the app groups under "other" so they can be filtered out.

## POI Caching

The Electron app maintains a persistent, merged POI cache in its userData directory.

### Merge Rules

Given:
- `latest`: POIs from the latest scan (from `GET /api/pois`)
- `cache`: POIs previously cached

**Algorithm:**

1. For each POI in `latest`:
   - **If not in cache**: Insert into cache (new POI)
   - **If in cache**: Update it (upsert; refresh `kind`, coordinates, etc.)

2. For each POI in `cache` not in `latest`:
   - **If player was within ~150 units of this POI in the latest scan**: Delete from cache (player likely collected it)
   - **Otherwise**: Keep in cache (POI may be on a different island, not yet visited, or from an older scan)

3. **Opacity rule**: Cache-only POIs (not in latest scan) are drawn at 60% opacity to distinguish them from freshly scanned POIs

### Cache Invalidation

- Cache is per-planet and persists across app sessions
- Cleared when player starts a new save or manually triggers a rescan via the app UI

## Repository Layout

```
PlanetNavigator/
├── mod/                           # BepInEx plugin source (C#, .NET Standard 2.1)
│   ├── PlanetNavigator/
│   │   ├── Properties/
│   │   ├── *.cs                   # Plugin source
│   │   └── PlanetNavigator.csproj
│   └── Directory.Build.props      # Shared build configuration
├── app/                           # Electron app (TypeScript)
│   ├── src/
│   │   ├── main/                  # Main process (Node.js)
│   │   ├── preload/               # Preload script
│   │   ├── renderer/              # Renderer process (UI)
│   │   └── shared/                # Shared types & utilities
│   ├── public/                    # Static assets
│   │   ├── tiles/                 # Generated tile pyramids (gitignored)
│   │   └── ...
│   ├── resources/                 # App resources
│   │   ├── mod/                   # Bundled mod binary (gitignored)
│   │   ├── bepinex/               # BepInEx installers (gitignored)
│   │   └── ...
│   ├── package.json
│   └── electron-builder.json      # Build configuration
├── tools/
│   ├── tile-slicer/               # Tool to generate tile pyramids from source images
│   ├── install-mod.ps1            # PowerShell installer script
│   └── ...
├── assets/
│   └── source-maps/               # Planet map source images (Apache 2.0 licensed)
├── docs/
│   ├── ARCHITECTURE.md            # This file
│   ├── INSTALL.md                 # End-user installation guide
│   └── ...
├── .gitignore
├── LICENSE
├── NOTICE
└── README.md
```

## Build & Deployment

- **Mod**: Built with `dotnet build mod -c Release` → outputs to `mod/PlanetNavigator/bin/Release/netstandard2.1/PlanetNavigator.dll`
- **App**: Built with `npm run build -w app` → outputs to `app/out/` (Electron packager output)
- **Tiles**: Generated by `tools/tile-slicer` from `assets/source-maps/` images → outputs to `app/public/tiles/`
- **Installer**: Uses `tools/install-mod.ps1` to deploy the mod and BepInEx to the player's game folder
