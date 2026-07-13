# Deploy the extension to a permanent folder outside the dev repo, so the
# installed copy survives deleting / moving / re-cloning this working directory.
#
# Usage:  double-click deploy.bat   (or)   powershell -ExecutionPolicy Bypass -File deploy.ps1
#
# The script copies the runtime files, then checks Chrome's own profile data to
# see whether the extension is ALREADY loaded from the install folder:
#
#   - not loaded yet -> opens Explorer on the folder and puts the path on your
#                       clipboard, so "Load unpacked" is just Ctrl+V + Enter
#                       (or drag the folder straight onto chrome://extensions).
#   - already loaded -> nothing to click; just hit the reload arrow on the card.
#
# Chrome deliberately blocks scripts from installing extensions, so that one
# "Load unpacked" click cannot be automated. Everything around it is.

$ErrorActionPreference = 'Stop'

$Source = $PSScriptRoot
$Target = Join-Path $env:LOCALAPPDATA 'ExitTimer'

# Only what the extension actually needs at runtime.
$Include = @('manifest.json', 'popup.html', 'offscreen.html', 'js', 'css', 'icons')

# ── Is the extension already loaded from $Target? ────────────────────────────
# Chrome records unpacked extensions (with their source path) in each profile's
# "Secure Preferences". Scan every profile rather than trusting a marker file.
function Get-LoadedExtensionPaths {
    $userData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
    if (-not (Test-Path $userData)) { return @() }

    $paths = @()
    Get-ChildItem $userData -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        foreach ($file in @('Secure Preferences', 'Preferences')) {
            $pref = Join-Path $_.FullName $file
            if (-not (Test-Path $pref)) { continue }
            try { $raw = Get-Content $pref -Raw -ErrorAction Stop } catch { continue }
            foreach ($m in [regex]::Matches($raw, '"path":"([^"]+)"')) {
                # JSON-escaped backslashes come through doubled.
                $paths += ($m.Groups[1].Value -replace '\\\\', '\')
            }
        }
    }
    return $paths
}

Write-Host ""
Write-Host "  Exit Timer - deploy" -ForegroundColor Cyan
Write-Host "  from: $Source" -ForegroundColor DarkGray
Write-Host "  to:   $Target" -ForegroundColor DarkGray
Write-Host ""

# ── Safety: never delete anything under the source repo ──────────────────────
# This script only READS from $Source. Bail out if the target somehow resolved
# to a path inside (or equal to) the repo.
$srcFull = (Resolve-Path $Source).ProviderPath.TrimEnd('\')
$tgtFull = [System.IO.Path]::GetFullPath($Target).TrimEnd('\')
if ($tgtFull -eq $srcFull -or $tgtFull.StartsWith("$srcFull\", [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "  ERROR: target ($tgtFull) is inside the source repo." -ForegroundColor Red
    Write-Host "  Refusing to continue - your source folder must never be touched." -ForegroundColor Red
    Read-Host "  Press Enter to close"
    return
}

# ── Copy the runtime files ───────────────────────────────────────────────────
if (-not (Test-Path $Target)) {
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
}

# Wipe old runtime files inside the TARGET only (never the repo), but keep the
# target folder itself so Chrome's extension ID and all stored data (theme,
# 12/24h, manual time entries) survive the update.
Get-ChildItem -Path $Target -Force | Remove-Item -Recurse -Force

foreach ($item in $Include) {
    $src = Join-Path $Source $item
    if (-not (Test-Path $src)) {
        Write-Warning "  missing, skipped: $item"
        continue
    }
    Copy-Item -Path $src -Destination $Target -Recurse -Force
    Write-Host "  copied  $item" -ForegroundColor DarkGray
}

$version = (Get-Content (Join-Path $Target 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Host ""
Write-Host "  Deployed v$version" -ForegroundColor Green
Write-Host ""

# ── Work out what (if anything) you still have to click ──────────────────────
$loaded    = Get-LoadedExtensionPaths
$isLoaded  = $loaded -contains $Target
$staleRepo = $loaded -contains $Source     # old copy still loaded from the repo

if ($isLoaded) {
    Write-Host "  Already loaded in Chrome from the install folder." -ForegroundColor Green
    Write-Host "  Open chrome://extensions and click the RELOAD arrow on the Exit" -ForegroundColor White
    Write-Host "  Timer card to pick up these changes." -ForegroundColor White

    if ($staleRepo) {
        Write-Host ""
        Write-Host "  NOTE: an OLD copy is also loaded from $Source." -ForegroundColor Yellow
        Write-Host "  Click Remove on that card so you don't run two of them." -ForegroundColor Yellow
    }
}
else {
    # Not installed from $Target yet - make the one manual click as easy as possible.
    try { Set-Clipboard -Value $Target } catch { }

    Write-Host "  NOT LOADED IN CHROME YET - one-time setup" -ForegroundColor Yellow
    Write-Host "  ----------------------------------------" -ForegroundColor Yellow
    Write-Host ""

    if ($staleRepo) {
        Write-Host "  0. An OLD copy is loaded from:" -ForegroundColor White
        Write-Host "       $Source" -ForegroundColor DarkYellow
        Write-Host "     Click Remove on that card first." -ForegroundColor White
        Write-Host ""
    }

    Write-Host "  1. Open           chrome://extensions" -ForegroundColor White
    Write-Host "  2. Turn ON        'Developer mode'  (top-right toggle)" -ForegroundColor White
    Write-Host "  3. Then EITHER:" -ForegroundColor White
    Write-Host "       A) DRAG the ExitTimer folder from the Explorer window that" -ForegroundColor White
    Write-Host "          just opened, and DROP it on the Chrome page.   <- easiest" -ForegroundColor White
    Write-Host "       B) Click 'Load unpacked', press Ctrl+V (the path is already" -ForegroundColor White
    Write-Host "          on your clipboard), press Enter." -ForegroundColor White
    Write-Host "  4. Pin Exit Timer to the toolbar (puzzle-piece icon)." -ForegroundColor White
    Write-Host ""
    Write-Host "  Clipboard now holds:" -ForegroundColor Green
    Write-Host "    $Target" -ForegroundColor Green

    # Open Explorer on the folder so it can be dragged straight onto Chrome.
    Start-Process explorer.exe $Target

    # Only launch Chrome if it isn't already running - otherwise you get a stray
    # window. If it IS running, just switch to it yourself and type the URL.
    $chromeRunning = @(Get-Process chrome -ErrorAction SilentlyContinue).Count -gt 0
    if (-not $chromeRunning) {
        try { Start-Process 'chrome.exe' 'chrome://extensions' } catch { }
    } else {
        Write-Host ""
        Write-Host "  (Chrome is already running - switch to it and go to" -ForegroundColor DarkGray
        Write-Host "   chrome://extensions. Not opening a second window.)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "  The installed copy is independent of the repo." -ForegroundColor Green
Write-Host "  Deleting or moving $Source will NOT break it." -ForegroundColor Green
Write-Host ""
