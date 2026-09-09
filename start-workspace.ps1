[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Project = 'admin',

  [ValidateRange(5, 600)]
  [int]$TimeoutSeconds = 120,

  [switch]$SkipAudit,
  [switch]$Headed
)

$ErrorActionPreference = 'Stop'
$auditRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localConfig = Join-Path $auditRoot 'config/projects.local.json'
$sharedConfig = Join-Path $auditRoot 'config/projects.json'
$configFile = if (Test-Path -LiteralPath $localConfig) { $localConfig } else { $sharedConfig }

function Test-ServiceReady {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 3 | Out-Null
    return $true
  } catch {
    # An HTTP error still proves that the frontend server is reachable.
    return $null -ne $_.Exception.Response
  }
}

if (-not (Test-Path -LiteralPath $configFile)) {
  throw "Project config not found: $configFile"
}

$projects = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$property = $projects.PSObject.Properties[$Project]
if ($null -eq $property) {
  $available = ($projects.PSObject.Properties.Name -join ', ')
  throw "Unknown project '$Project'. Available projects: $available"
}

$projectConfig = $property.Value
if ([string]::IsNullOrWhiteSpace([string]$projectConfig.root)) {
  throw "Project '$Project' has no root in $configFile"
}
if ([string]::IsNullOrWhiteSpace([string]$projectConfig.url)) {
  throw "Project '$Project' has no url in $configFile"
}

$projectRoot = if ([IO.Path]::IsPathRooted([string]$projectConfig.root)) {
  [IO.Path]::GetFullPath([string]$projectConfig.root)
} else {
  [IO.Path]::GetFullPath((Join-Path $auditRoot ([string]$projectConfig.root)))
}

if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
  throw "Business project directory not found: $projectRoot. Create config/projects.local.json and set the real root."
}

$projectUrl = [string]$projectConfig.url
if (Test-ServiceReady -Url $projectUrl) {
  Write-Host "Business project is already running: $projectUrl" -ForegroundColor Green
} else {
  $startCommand = [string]$projectConfig.startCommand
  if ([string]::IsNullOrWhiteSpace($startCommand)) {
    throw "Project '$Project' is not running and has no startCommand in $configFile"
  }

  $escapedRoot = $projectRoot.Replace("'", "''")
  $escapedCommand = $startCommand.Replace("'", "''")
  $childCommand = "Set-Location -LiteralPath '$escapedRoot'; Write-Host 'Starting $Project...'; Invoke-Expression '$escapedCommand'"
  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit', '-EncodedCommand', $encodedCommand -PassThru

  Write-Host "Waiting for $projectUrl (timeout: ${TimeoutSeconds}s)..." -ForegroundColor Cyan
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (-not (Test-ServiceReady -Url $projectUrl)) {
    if ($process.HasExited) {
      throw "Business project process exited before the page became reachable. Check the new PowerShell window."
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "Timed out waiting for $projectUrl. Check startCommand, port, and the new PowerShell window."
    }
    Start-Sleep -Seconds 2
  }
  Write-Host "Business project is ready: $projectUrl" -ForegroundColor Green
}

if ($SkipAudit) {
  Write-Host 'Workspace startup completed. Audit was skipped.' -ForegroundColor Yellow
  exit 0
}

Set-Location -LiteralPath $auditRoot
if (-not (Test-Path -LiteralPath (Join-Path $auditRoot 'node_modules/playwright'))) {
  throw 'Audit dependencies are missing. Run: pnpm install; pnpm exec playwright install chromium'
}

$browserExecutable = & node -e "const { chromium } = require('playwright'); process.stdout.write(chromium.executablePath())"
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $browserExecutable -PathType Leaf)) {
  throw 'Playwright Chromium is missing. Run: pnpm exec playwright install chromium'
}

$auditArgs = @('src/run-with-tests.mjs', $Project)
if ($Headed) { $auditArgs += '--headed' }

Write-Host "Running Audit for $Project..." -ForegroundColor Cyan
& node @auditArgs
exit $LASTEXITCODE
