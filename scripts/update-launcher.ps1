param(
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

Write-Host "== Game Tracker launcher update =="

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  Invoke-Native npm install
}

Write-Host "Preparing launcher icon..."
Invoke-Native npm run make:icon

Write-Host "Building installer..."
Invoke-Native npm run build

$installer = Get-ChildItem -Path "dist" -Filter "*.exe" |
  Where-Object { $_.Name -notmatch "uninstaller|uninstall" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "Installer was not found in dist."
}

Write-Host "Built: $($installer.FullName)"

if ($SkipInstaller) {
  Write-Host "Skipped installer run. Run this manually when ready:"
  Write-Host "  $($installer.FullName)"
  exit 0
}

Write-Host "Starting installer. Keep 'Create desktop shortcut' enabled."
Start-Process -FilePath $installer.FullName -Wait

Write-Host "Done. The desktop shortcut should point to the updated Game Tracker."
