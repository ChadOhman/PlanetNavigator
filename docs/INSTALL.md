# PlanetNavigator Installation Guide

## Installation via the App (Recommended)

1. **Install and launch PlanetNavigator**
   - Download the latest release from the project page or build from source
   - Extract and run `PlanetNavigator.exe`

2. **Configure game setup**
   - Open the app's **Settings** (gear icon)
   - Select the **Game Setup** tab
   - The app will automatically detect your Steam installation of The Planet Crafter
   - If auto-detection fails, use the folder browser to manually select your game directory (the folder containing `Planet Crafter_Data/` and `Planet Crafter.exe`)

3. **Installation proceeds automatically**
   - The app will download and install **BepInEx 5.4.23.5** (win x64) into your game folder if not already present
   - The **PlanetNavigator.dll** plugin is copied to `BepInEx/plugins/PlanetNavigator/`
   - A status badge displays the current state:
     - 🔴 Red (error): Game folder not detected or BepInEx installation failed
     - 🟡 Yellow (pending): Game folder detected, BepInEx installed, waiting for the game to start
     - 🟢 Green (ready): A save file is loaded in the game; PlanetNavigator is connected and active

4. **Launch the game**
   - Start The Planet Crafter through Steam
   - Load or create a save file
   - Once you spawn into the world, the status badge turns green and the map appears in the app

## Updating

The installed app checks GitHub Releases for new versions shortly after launch and every few hours. When one is found it downloads in the background and asks you to restart; if you choose *Later*, it installs the next time you quit. Right-click the tray icon and choose **Check for updates…** to check on demand.

After an app update, open **Settings › Game Setup** again: if the bundled plugin changed, the status shows it as out of date and one click copies the new `PlanetNavigator.dll` into the game folder (close the game first).

## Manual Installation via PowerShell Script

If you prefer not to use the app's Settings interface, you can install the mod manually using the provided PowerShell script.

1. **Build the plugin** (if installing from source)
   ```powershell
   cd PlanetNavigator
   dotnet build mod -c Release
   ```

2. **Run the installer script**
   ```powershell
   cd PlanetNavigator
   pwsh tools/install-mod.ps1
   ```

   The script will:
   - Auto-detect your Steam installation of The Planet Crafter
   - Download and install BepInEx 5.4.23.5 if needed (expected size: 639,118 bytes)
   - Copy the plugin DLL to `BepInEx/plugins/PlanetNavigator/`
   - Print a summary of steps completed

3. **Launch the game and load a save**
   - The mod will start serving on `http://127.0.0.1:27641` when you spawn into the world

### Script Options

```powershell
# Auto-detect game directory and install
pwsh tools/install-mod.ps1

# Specify a custom game directory
pwsh tools/install-mod.ps1 -GameDir "D:\Games\The Planet Crafter"

# Use a custom plugin DLL
pwsh tools/install-mod.ps1 -PluginDll "C:\path\to\PlanetNavigator.dll"

# Skip BepInEx installation (assumes it's already installed)
pwsh tools/install-mod.ps1 -SkipBepInEx
```

**Game directory auto-detection** checks:
1. `D:\SteamLibrary\steamapps\common\The Planet Crafter`
2. `C:\Program Files (x86)\Steam\steamapps\common\The Planet Crafter`
3. Errors if neither path exists or the game assemblies are not found

## Uninstallation

### Remove Just the Mod

To uninstall PlanetNavigator while keeping BepInEx:

1. Open your game folder (where `Planet Crafter.exe` is located)
2. Delete the folder: `BepInEx/plugins/PlanetNavigator/`

### Remove BepInEx Entirely

To uninstall both PlanetNavigator and BepInEx:

1. Open your game folder
2. Delete these files and folders:
   - `winhttp.dll`
   - `doorstop_config.ini`
   - `BepInEx/` (entire folder)
   - `changelog.txt` (if present)

Your game folder will return to its original state.

## Troubleshooting

**Status badge is red (error)**
- Ensure The Planet Crafter is installed via Steam
- Check that the game path contains `Planet Crafter_Data/Managed/Assembly-CSharp.dll`
- Try specifying the game directory manually in Settings

**Status badge is yellow but stays yellow**
- Ensure you have launched the game at least once after installation
- Load or create a save file
- Spawn into the world

**Status badge is green but the map is empty**
- The mod is connected but no POI scan has completed yet
- Wait 20–30 seconds for the first scan to finish
- Use the app's rescan button to trigger a manual scan

**BepInEx installation fails**
- Check your internet connection (the installer downloads from GitHub)
- Ensure you have write permissions to the game folder
- Try the manual PowerShell script with `-SkipBepInEx` if BepInEx is already installed

## System Requirements

- **OS**: Windows 10 or later (x64)
- **The Planet Crafter**: Latest version from Steam
- **Internet connection**: Required for BepInEx download during installation
- **.NET 8 Runtime**: Usually included with modern Windows and The Planet Crafter; the mod uses .NET Standard 2.1
