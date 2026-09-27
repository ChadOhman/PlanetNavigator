# PlanetNavigator Mod HTTP API

The BepInEx plugin serves live game state to the desktop companion app over plain HTTP (JSON)
and Server-Sent Events (SSE).

- **Base URL:** `http://127.0.0.1:27641/` (the literal loopback IP; the server never binds
  `localhost`, `+` or `*`, so it is not reachable from the LAN and needs no URL ACL / admin rights).
- **Encoding:** all bodies are UTF-8 JSON without a BOM, compact (single line).
- **Coordinates:** Unity world units. `x` = east/west, `y` = altitude, `z` = north/south.
  `heading` is degrees clockwise from +z, in `[0, 360)`.
- **Time:** `t` fields are Unix time in milliseconds (JSON number).

## Port fallback

The server tries `Server.Port` first (default `27641`). If binding fails (port in use), it tries
`Port+1` through `Port+5` in order and logs the chosen port at Info level
(`HTTP server listening on http://127.0.0.1:27642/`). The actual port is also reported by
`GET /api/status` as `port`. A client that cannot connect on 27641 should probe 27642..27646
and use the first one whose `/api/status` returns `modVersion`.

If no port can be bound, or `Server.Enabled = false`, the plugin logs the problem and the game
continues normally with no server.

## CORS and caching

Every response (including errors and `OPTIONS`) carries:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Private-Network: true
Cache-Control: no-cache
```

`OPTIONS <any path>` returns `204 No Content` (CORS preflight).

## Client activity

Every request (and every open SSE stream, continuously) marks the client as active. Automatic
POI scans only run while a client has been active within the last 60 seconds, so the plugin
costs nothing when the companion app is closed.

---

## `GET /api/status`

Always `200`. Plugin and game metadata; safe to call from the main menu.

```json
{
  "modVersion": "0.1.0",
  "gameVersion": "1.519",
  "port": 27641,
  "planet": "Prime",
  "playerName": "Chad",
  "scanId": 7,
  "poiCount": 1843,
  "samplerState": "ok",
  "ti": 1523344.25,
  "lushThreshold": 1000000.0,
  "uptimeSeconds": 812.4,
  "sseClients": 1
}
```

| Field | Type | Notes |
|---|---|---|
| `modVersion` | string | Plugin version. |
| `gameVersion` | string | `UnityEngine.Application.version`. |
| `port` | number | Port actually bound (see fallback). |
| `planet` | string \| null | `Prime`, `Humble`, `Selenea`, `Aqualis`, `Toxicity`, `Skeo`, ... `null` in the main menu / while loading. |
| `playerName` | string \| null | Local player's name; `null` in the menu. |
| `scanId` | number | Id of the latest POI scan, `0` before the first scan. |
| `poiCount` | number | Items in the latest scan. |
| `samplerState` | string | Diagnostic state: `"ok"` (planet loaded and sampler active), `"not sampled yet"`, `"PlayersManager not found"`, `"PlanetLoader not found"`, or `"PlanetLoader has no current planet"`. Explains why `planet` is `null` during main menu or loading. |
| `ti` | number | Terraformation index of the current planet; `0` if unknown / in menu. |
| `lushThreshold` | number | Start value of the planet's moss terraform stage (`PlanetData.startMossTerraStage`); `0` if unknown. |
| `uptimeSeconds` | number | Seconds since the server started. |
| `sseClients` | number | Open `/api/events` streams. |

## `GET /api/position`

Latest position sample (default 10 Hz, see `Sampling.PositionHz`).

- `200` with the body below while a planet is loaded.
- `204 No Content` (empty body) in the main menu / while loading.

```json
{
  "t": 1790000000123.0,
  "planet": "Prime",
  "ti": 1523344.25,
  "players": [
    { "id": 0, "name": "Chad",   "x": 412.73, "y": 38.02, "z": -1180.4, "heading": 271.5, "isLocal": true },
    { "id": 1, "name": "Friend", "x": 398.1,  "y": 40.5,  "z": -1177.9, "heading": 90.0,  "isLocal": false }
  ]
}
```

| Field | Notes |
|---|---|
| `players[].id` | Index of the player in the game's `PlayersManager.playersControllers` list. Stable while nobody joins/leaves; not a persistent identity. |
| `players[].isLocal` | `true` for the player controlled on this machine. |
| `players[].heading` | Player body yaw (`transform.eulerAngles.y`), degrees clockwise from +z. |

In single player `players` has one entry. It can briefly be empty while the player spawns.

## `GET /api/pois?since=<scanId>`

Latest scan of points of interest in the loaded scene.

- `200` with the full list.
- `304 Not Modified` (empty body) if `since` equals the current `scanId`.
- Before any scan has completed: `200` with
  `{"planet":null,"scanId":0,"t":0,"items":[]}` (regardless of `since`).

```json
{
  "planet": "Prime",
  "scanId": 7,
  "t": 1790000000456.0,
  "items": [
    { "id": "Iron@412:37:-1190", "kind": "minable",  "group": "Iron",       "x": 412.3, "y": 37.1, "z": -1190.2 },
    { "id": "Cobalt@-88:61:230", "kind": "minable",  "group": "Cobalt",     "x": -88.4, "y": 61.0, "z": 230.4 },
    { "id": "Seed0@15:22:47",    "kind": "grabable", "group": "Seed0",      "x": 15.2,  "y": 22.3, "z": 47.0 },
    { "id": "Container1@3:9:-4", "kind": "openable", "group": "Container1", "x": 3.1,   "y": 9.2,  "z": -4.4 }
  ]
}
```

| Field | Notes |
|---|---|
| `kind` | `minable` (`ActionMinable`), `grabable` (`ActionGrabable`), or `openable` (`ActionOpenable`). |
| `group` | Game group id (`WorldObjectFromScene` group data, else the associated `WorldObject`'s group). If neither exists, the GameObject name with `(Clone)` and trailing digits/whitespace removed. |
| `id` | `${group}@${round(x)}:${round(y)}:${round(z)}`, invariant culture. Unique within a scan (duplicates are dropped; the first kind wins). |

Only active, enabled objects in the currently loaded (streamed-in) scene are reported, so the list
covers what is loaded around the player, not the whole planet. The companion app merges scans
into its own cache.

**When scans run** (only while a client is active and a planet is loaded; checked once per second):

- every `Scan.IntervalSeconds` (default 20 s),
- immediately after a `rescan` command,
- immediately when the planet changes,
- after a Unity scene load (immediately, then again 5 s later once objects have streamed in).

A scan is spread over several frames (400 objects per frame). If the planet changes mid-scan the
result is discarded and a new scan starts.

## `GET /api/events` (Server-Sent Events)

`Content-Type: text/event-stream`, chunked, kept open. The server checks state every 100 ms and
emits only what changed. On connect it immediately sends `retry: 2000` followed by the current
`planet`, `position` (if in game) and `pois` events, so a client can sync from the stream alone.

| Event | When | `data` |
|---|---|---|
| `planet` | On connect and whenever the planet changes, including to/from `null` (entering/leaving the menu). Sent before the matching `position`. | `{"planet":"Humble"}` or `{"planet":null}` |
| `position` | Each new position sample (default 10 Hz; none while in menu). | Same JSON as `GET /api/position`. |
| `pois` | On connect and whenever a scan completes. Fetch the list with `GET /api/pois?since=<previous scanId>`. | `{"scanId":8,"planet":"Humble"}` (`planet` is `null` when `scanId` is 0) |
| comment | Every 15 s. | `: keepalive` |

Wire example:

```
retry: 2000

event: planet
data: {"planet":"Prime"}

event: position
data: {"t":1790000000123.0,"planet":"Prime","ti":1523344.25,"players":[{"id":0,"name":"Chad","x":412.73,"y":38.02,"z":-1180.4,"heading":271.5,"isLocal":true}]}

event: pois
data: {"scanId":7,"planet":"Prime"}

: keepalive

```

Limits: at most 16 concurrent streams. Further connections get `503` with a JSON error. Streams
end when the game quits. Browsers' `EventSource` reconnects automatically.

## `POST /api/command`

Body: a JSON object with a string `type`. Extra fields are allowed and passed through to the
handler. Commands are queued and executed on the game's main thread on the next frame(s).
The endpoint accepts any `Content-Type` (e.g., `text/plain`, `application/json`); the body is
parsed as JSON regardless.

```http
POST /api/command
Content-Type: text/plain

{"type":"rescan"}
```

| Status | Body | When |
|---|---|---|
| `202` | `{"queued":true}` | Accepted (also for unknown types, which are ignored and logged once per type). |
| `400` | `{"error":"bad json: expected an object with a string \"type\""}` | Malformed JSON, not an object, or missing/non-string `type`. |
| `413` | `{"error":"body too large"}` | Body over 64 KiB. |
| `503` | `{"error":"command queue full"}` | More than 256 commands waiting. |

Supported commands:

| `type` | Effect |
|---|---|
| `rescan` | Requests a POI scan at the next once-per-second check (still requires a loaded planet). A new `pois` SSE event follows when it completes. |

## Errors

| Status | Body |
|---|---|
| `404` | `{"error":"not found"}`: unknown path, or a known path with the wrong method. |
| `500` | `{"error":"internal error"}`: unexpected failure (details go to the BepInEx log at Warning). |

## Configuration

File: `BepInEx/config/ca.ohman.planetnavigator.cfg` (created on first launch).

| Section | Key | Type | Default | Notes |
|---|---|---|---|---|
| `Server` | `Port` | int | `27641` | First port tried; falls back to `Port+1`..`Port+5`. |
| `Server` | `Enabled` | bool | `true` | `false` disables the server, sampling and scanning. |
| `Sampling` | `PositionHz` | int | `10` | Position samples per second, clamped to 1..30. |
| `Scan` | `IntervalSeconds` | float | `20` | Seconds between automatic scans while a client is active (minimum 1). |
| `Scan` | `Enabled` | bool | `true` | Disables POI scanning (the `rescan` command then does nothing). |
| `Logging` | `Verbose` | bool | `false` | Promotes diagnostic messages (scan counts/timings, SSE connects, rescan requests) from Debug to Info. |

`Server.*` is read once at startup. `PositionHz`, `Scan.*` and `Logging.Verbose` take effect
live if changed at runtime (e.g. via ConfigurationManager).

## Security note

The server listens on loopback only, but it sends `Access-Control-Allow-Origin: *`, so any web
page open in a local browser could read the player's position or queue a `rescan`. No command can
change game state.


### POI storage fields (added 2026-09-27)

Each item in `GET /api/pois` also carries:

| Field | Type | Meaning |
|---|---|---|
| `inStorage` | boolean | `true` when the object is held by or displayed inside a storage/furniture (shelf, display case, vegetube, crate) instead of lying loose in the world. Detected primarily by checking the game's inventory tables (`InventoriesHandler.GetAllInventories()`; the holder is resolved through each `WorldObject`'s linked and secondary inventory ids, which is how vegetube/grower slots are found), with a fallback that walks up the object's transform parents looking for `InventoryShowContent`, `InventoryAssociated`, `InventoryFromScene` or `ActionOpenable`, or a `WorldObject` with no world position. |
| `container` | string or null | Group id of the holding storage when known (e.g. `Container1`), `"inventory"` when only known to be inside an inventory, `"storage"` when the holder has no group id, else `null`. |

The app hides `inStorage` items by default ("Hide stored" chip).
