#Requires -Version 7.0

param(
    [string]$GameDir,
    [string]$PluginDll,
    [switch]$SkipBepInEx
)

$ErrorActionPreference = 'Stop'

# ============================================================================
# STEP 0: Resolve parameters
# ============================================================================

Write-Host "PlanetNavigator Mod Installer`n" -ForegroundColor Cyan

# Resolve GameDir
if (-not $GameDir) {
    Write-Host "Step 1/4: Detecting game directory..." -ForegroundColor Cyan

    $candidates = @(
        "D:\SteamLibrary\steamapps\common\The Planet Crafter",
        "C:\Program Files (x86)\Steam\steamapps\common\The Planet Crafter"
    )

    $found = $null
    foreach ($candidate in $candidates) {
        if (Test-Path "$candidate\Planet Crafter_Data\Managed\Assembly-CSharp.dll") {
            $found = $candidate
            break
        }
    }

    if ($found) {
        $GameDir = $found
        Write-Host "  Found game at: $GameDir" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: Could not auto-detect game directory." -ForegroundColor Red
        Write-Host "  Checked:" -ForegroundColor Yellow
        foreach ($candidate in $candidates) {
            Write-Host "    - $candidate" -ForegroundColor Yellow
        }
        Write-Host "  Please run the script with -GameDir parameter." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "Step 1/4: Using provided game directory..." -ForegroundColor Cyan
    Write-Host "  $GameDir" -ForegroundColor Gray
}

# Validate GameDir
if (-not (Test-Path "$GameDir\Planet Crafter_Data\Managed\Assembly-CSharp.dll")) {
    Write-Host "  ERROR: Game assemblies not found at $GameDir" -ForegroundColor Red
    Write-Host "  Expected: $GameDir\Planet Crafter_Data\Managed\Assembly-CSharp.dll" -ForegroundColor Yellow
    exit 1
}

# Resolve PluginDll
if (-not $PluginDll) {
    $PluginDll = "$PSScriptRoot\..\mod\PlanetNavigator\bin\Release\netstandard2.1\PlanetNavigator.dll"
}

# Normalize path
$PluginDll = (Resolve-Path -Path $PluginDll -ErrorAction SilentlyContinue).Path
if (-not $PluginDll) {
    Write-Host "  WARNING: Plugin DLL not found at expected location." -ForegroundColor Yellow
    Write-Host "  Expected: $PSScriptRoot\..\mod\PlanetNavigator\bin\Release\netstandard2.1\PlanetNavigator.dll" -ForegroundColor Yellow
    Write-Host "  (Did you build the mod? Run: dotnet build mod -c Release)" -ForegroundColor Yellow
}

# ============================================================================
# STEP 1: Install/Verify BepInEx
# ============================================================================

if (-not $SkipBepInEx) {
    Write-Host "`nStep 2/4: Setting up BepInEx..." -ForegroundColor Cyan

    $bepinexCore = "$GameDir\BepInEx\core\BepInEx.dll"

    if (Test-Path $bepinexCore) {
        Write-Host "  BepInEx already installed" -ForegroundColor Green
    } else {
        Write-Host "  Downloading BepInEx 5.4.23.5..." -ForegroundColor Gray

        $bepinexUrl = "https://github.com/BepInEx/BepInEx/releases/download/v5.4.23.5/BepInEx_win_x64_5.4.23.5.zip"
        $bepinexZip = "$env:TEMP\BepInEx_win_x64_5.4.23.5.zip"
        $expectedSize = 639118

        try {
            $progressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $bepinexUrl -OutFile $bepinexZip -ErrorAction Stop
            $progressPreference = 'Continue'
        } catch {
            Write-Host "  ERROR: Failed to download BepInEx from $bepinexUrl" -ForegroundColor Red
            Write-Host "  $_" -ForegroundColor Red
            exit 1
        }

        # Verify download size
        $actualSize = (Get-Item $bepinexZip).Length
        if ($actualSize -ne $expectedSize) {
            Write-Host "  ERROR: Download size mismatch" -ForegroundColor Red
            Write-Host "  Expected: $expectedSize bytes" -ForegroundColor Yellow
            Write-Host "  Got: $actualSize bytes" -ForegroundColor Yellow
            Remove-Item $bepinexZip -Force
            exit 1
        }

        Write-Host "  Download verified ($actualSize bytes)" -ForegroundColor Green
        Write-Host "  Extracting to $GameDir..." -ForegroundColor Gray

        try {
            Expand-Archive -Path $bepinexZip -DestinationPath $GameDir -Force -ErrorAction Stop
        } catch {
            Write-Host "  ERROR: Failed to extract BepInEx" -ForegroundColor Red
            Write-Host "  $_" -ForegroundColor Red
            exit 1
        }

        Remove-Item $bepinexZip -Force
        Write-Host "  BepInEx installed successfully" -ForegroundColor Green
    }
} else {
    Write-Host "`nStep 2/4: Skipping BepInEx (already installed)" -ForegroundColor Cyan
}

# ============================================================================
# STEP 2: Deploy plugin DLL
# ============================================================================

Write-Host "`nStep 3/4: Deploying PlanetNavigator plugin..." -ForegroundColor Cyan

$pluginDir = "$GameDir\BepInEx\plugins\PlanetNavigator"

if (-not (Test-Path $pluginDir)) {
    New-Item -ItemType Directory -Path $pluginDir -Force | Out-Null
    Write-Host "  Created directory: $pluginDir" -ForegroundColor Gray
}

if ($PluginDll -and (Test-Path $PluginDll)) {
    Copy-Item -Path $PluginDll -Destination $pluginDir -Force
    Write-Host "  Copied: $(Split-Path -Leaf $PluginDll)" -ForegroundColor Green

    # Also copy .pdb if present
    $pdbPath = $PluginDll -replace '\.dll$', '.pdb'
    if (Test-Path $pdbPath) {
        Copy-Item -Path $pdbPath -Destination $pluginDir -Force
        Write-Host "  Copied: $(Split-Path -Leaf $pdbPath)" -ForegroundColor Green
    }
} else {
    Write-Host "  WARNING: Plugin DLL not found" -ForegroundColor Yellow
    Write-Host "  (Install will continue, but the plugin was not deployed)" -ForegroundColor Yellow
    Write-Host "  Expected: $PluginDll" -ForegroundColor Yellow
}

# ============================================================================
# STEP 3: Summary and next steps
# ============================================================================

Write-Host "`nStep 4/4: Installation complete" -ForegroundColor Cyan
Write-Host "`n  Game folder: $GameDir" -ForegroundColor Gray
Write-Host "  Plugin path: $pluginDir" -ForegroundColor Gray
Write-Host "  BepInEx:     $(if (Test-Path "$GameDir\BepInEx\core\BepInEx.dll") { 'Installed' } else { 'Not installed' })" -ForegroundColor Gray

Write-Host "`n" -ForegroundColor Cyan
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Launch The Planet Crafter from Steam" -ForegroundColor White
Write-Host "  2. Load or create a save file and spawn into the world" -ForegroundColor White
Write-Host "  3. Open the PlanetNavigator app - the map will appear when connected" -ForegroundColor White
Write-Host "`nThe mod will serve on http://127.0.0.1:27641" -ForegroundColor Gray
