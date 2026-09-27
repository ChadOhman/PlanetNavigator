# PlanetNavigator Mod

BepInEx 5 plugin for The Planet Crafter that provides a companion map bridge.

## Building

Build the plugin from the repository root:

```bash
dotnet build mod -c Release
```

The compiled DLL will be placed in `mod/PlanetNavigator/bin/Release/` and automatically copied to `BepInEx/plugins/PlanetNavigator/` if the game directory is found, and also to `app/resources/mod/`.

## Overriding Game Directory

If The Planet Crafter is not installed at the default location, copy `Directory.Build.user.props.example` to `Directory.Build.user.props` in the `mod/` folder and update the `GameDir` property with the correct path.

Alternatively, set the `PLANET_CRAFTER_DIR` environment variable.

## Deployment

Release builds are deployed to:
- `<GameDir>/BepInEx/plugins/PlanetNavigator/PlanetNavigator.dll` (if BepInEx is installed)
- `app/resources/mod/PlanetNavigator.dll` (always)

Build while the game is running (skips the copy into `BepInEx\plugins`, which would fail on the locked DLL):

```bash
dotnet build mod -c Release -p:NoDeploy=true
```
