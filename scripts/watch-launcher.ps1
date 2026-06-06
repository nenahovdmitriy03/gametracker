param(
  [switch]$Install,
  [switch]$NoInitialBuild,
  [int]$DebounceSeconds = 4
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$watched = @(
  "main.js",
  "preload.js",
  "package.json",
  "renderer",
  "assets"
)

$script:updateQueued = -not $NoInitialBuild
$script:building = $false
$script:lastChange = Get-Date

function Request-Build {
  param([string]$Reason)

  $script:updateQueued = $true
  $script:lastChange = Get-Date
  Write-Host "Change detected: $Reason"
}

function Invoke-LauncherBuild {
  if ($script:building) { return }
  if (-not $script:updateQueued) { return }

  $age = ((Get-Date) - $script:lastChange).TotalSeconds
  if ($age -lt $DebounceSeconds) { return }

  $script:updateQueued = $false
  $script:building = $true

  try {
    Write-Host ""
    Write-Host "== Auto-building Game Tracker launcher =="
    if ($Install) {
      & powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts/update-launcher.ps1")
    } else {
      & powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts/update-launcher.ps1") -SkipInstaller
    }

    if ($LASTEXITCODE -ne 0) {
      Write-Host "Build failed with exit code $LASTEXITCODE"
    } else {
      Write-Host "Auto-build finished."
    }
  } finally {
    $script:building = $false
  }
}

$watchers = New-Object System.Collections.Generic.List[System.IO.FileSystemWatcher]

foreach ($item in $watched) {
  $path = Join-Path $root $item
  if (-not (Test-Path $path)) { continue }

  if ((Get-Item $path).PSIsContainer) {
    $directory = $path
    $filter = "*.*"
  } else {
    $directory = Split-Path -Parent $path
    $filter = Split-Path -Leaf $path
  }

  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = $directory
  $watcher.Filter = $filter
  $watcher.IncludeSubdirectories = (Get-Item $path).PSIsContainer
  $watcher.EnableRaisingEvents = $true

  $action = {
    $ignored = @(".tmp", ".log", ".map")
    $ext = [System.IO.Path]::GetExtension($Event.SourceEventArgs.FullPath)
    if ($ignored -contains $ext) { return }
    Request-Build $Event.SourceEventArgs.FullPath
  }

  Register-ObjectEvent $watcher Changed -Action $action | Out-Null
  Register-ObjectEvent $watcher Created -Action $action | Out-Null
  Register-ObjectEvent $watcher Deleted -Action $action | Out-Null
  Register-ObjectEvent $watcher Renamed -Action $action | Out-Null
  $watchers.Add($watcher)
}

Write-Host "Watching Game Tracker files."
Write-Host "Mode: $($(if ($Install) { 'build and run installer' } else { 'build only' }))"
Write-Host "Press Ctrl+C to stop."

while ($true) {
  Invoke-LauncherBuild
  Start-Sleep -Milliseconds 500
}
