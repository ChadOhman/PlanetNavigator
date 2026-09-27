# PlanetNavigator

A companion map for [The Planet Crafter](https://store.steampowered.com/app/1284190/The_Planet_Crafter/) – a Windows desktop app that displays a live, interactive map of your planet, tracking your position, scanned resources, and progress.

## Download

Grab the latest Windows installer from the [Releases page](https://github.com/ChadOhman/PlanetNavigator/releases). The installer is not code-signed, so SmartScreen shows "unknown publisher" on first run: choose *More info*, then *Run anyway*. After installing, open Settings › Game setup to install BepInEx and the plugin into your game folder.

## Architecture

**Mod ↔ App over localhost HTTP/SSE**

- **Mod** (BepInEx plugin): Runs in The Planet Crafter process, serves player position, planet state, and scanned resource nodes over HTTP JSON + Server-Sent Events on `http://127.0.0.1:27641`.
- **App** (Electron + TypeScript + OpenLayers): Desktop application that renders the map with live player tracking, auto-follow, nearby-resources filters, and persistent POI caching.

## Requirements

- **Windows** (x64)
- **The Planet Crafter** (Steam, tested on build 25296421, Unity 6000.3.2)
- **.NET 8 SDK** (to build the mod)
- **Node.js 24+** (to build the app)

## What Works Today

- **Mod**: Position/planet/POI scan over local HTTP+SSE
- **App**: Live map for all six planets with barren/lush/endgame tiles, auto-follow player arrow, nearby list, filter chips, a "Hide stored" toggle that hides items sitting in crates, growers and other inventories, per-planet POI cache, settings (always-on-top, opacity), system tray
- **Installer**: In-app BepInEx + plugin installer

## Running from Source

```bash
npm install
npm run tiles
dotnet build mod -c Release
pwsh tools/install-mod.ps1
```

Launch the game and load a save, then:

```bash
npm run dev
```

## Troubleshooting

- **Status badge stays "Searching"**: Game not running or save not loaded. Check `/api/status` for `samplerState`.
- **Two game instances**: If you launch The Planet Crafter twice, the second takes port 27642+; the app finds it automatically.
- **Mod not reloading**: BepInEx does not hot-reload. Quit the game before rebuilding the mod.
- **Check logs**: See `BepInEx\LogOutput.log` for mod errors.

## Documentation & Installation

- [Architecture & API](docs/ARCHITECTURE.md) — technical design, HTTP API, data model
- [Installation Guide](docs/INSTALL.md) — user-facing setup

## License & Attribution

PlanetNavigator is released under the MIT License (see [LICENSE](LICENSE)).

Third-party materials are attributed in [NOTICE](NOTICE), including planet map imagery (Apache 2.0), BepInEx (LGPL-2.1), OpenLayers (BSD-2-Clause), and Electron (MIT).

**Disclaimer**: The Planet Crafter is © Miju Games. PlanetNavigator is an unofficial fan tool and is not affiliated with Miju Games.
