<#
.SYNOPSIS
  Sets up Chalkline for development on Windows.

.DESCRIPTION
  1. Node.js 24 LTS (installed with winget when Node 22.12+ is missing).
  2. pnpm, at the version package.json pins.
  3. The project's packages (pnpm install).
  4. .env.local from .env.example, asking for your Mathpix keys.
  5. Optionally TeX Live 2026 (needed for PDF handouts; without it you get
     .tex files) and veraPDF (only for pnpm compile-matrix).

  Safe to run again; finished steps are skipped.

.PARAMETER TeXLive
  Install TeX Live without asking.

.PARAMETER NoTeXLive
  Skip TeX Live without asking.

.PARAMETER VeraPdf
  Also install veraPDF (needs Java 11+).

.PARAMETER NoPrompt
  Never ask; skip the key questions and TeX Live unless -TeXLive is given.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1 -TeXLive
#>
[CmdletBinding()]
param(
  [switch]$TeXLive,
  [switch]$NoTeXLive,
  [switch]$VeraPdf,
  [switch]$NoPrompt
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Toolchain = Join-Path $Root 'apps\worker-compile\toolchain'
$MinNode = [version]'22.12.0'

function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Done([string]$Text) { Write-Host "   $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "   $Text" -ForegroundColor Yellow }

function Update-SessionPath {
  # Installers change the machine and user PATH; pick that up without a new window.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Get-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $null }
  $text = (& node --version) -replace '^v', ''
  try { return [version]$text } catch { return $null }
}

function Invoke-Checked([string]$What, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)." }
}

function Read-YesNo([string]$Question) {
  if ($NoPrompt) { return $false }
  $answer = Read-Host "$Question [y/N]"
  return $answer -match '^(y|yes)$'
}

if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
  throw 'This script is for Windows. On Linux and macOS follow the README.'
}

# 1. Node.js
Write-Step 'Node.js'
$node = Get-NodeVersion
if ($node -and $node -ge $MinNode) {
  Write-Done "Node $node is installed."
} else {
  if ($node) { Write-Note "Node $node is too old; Chalkline needs $MinNode or later." }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget is not available. Install Node.js 24 LTS from https://nodejs.org, then run this script again.'
  }
  Write-Host '   Installing Node.js 24 LTS with winget ...'
  Invoke-Checked 'winget install Node.js' {
    winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements
  }
  Update-SessionPath
  $node = Get-NodeVersion
  if (-not $node -or $node -lt $MinNode) {
    throw 'Node.js was installed but is not on PATH yet. Open a new PowerShell window and run this script again.'
  }
  Write-Done "Node $node is installed."
}

# 2. pnpm, at the version package.json pins
Write-Step 'pnpm'
$manifest = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$pnpmVersion = ($manifest.packageManager -split '@')[1]
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  Write-Done "pnpm $(& pnpm --version) is installed (the project pins $pnpmVersion; pnpm switches to it by itself)."
} else {
  # Corepack ships with Node 24; enabling it in Program Files needs administrator
  # rights, so fall back to a per-user npm install.
  $viaCorepack = $false
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & corepack enable pnpm 2>&1 | Out-Null
    $viaCorepack = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $previous
  }
  if (-not $viaCorepack) {
    Invoke-Checked 'npm install -g pnpm' { npm install --global "pnpm@$pnpmVersion" }
  }
  Update-SessionPath
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw 'pnpm was installed but is not on PATH yet. Open a new PowerShell window and run this script again.'
  }
  Write-Done "pnpm $(& pnpm --version) is installed."
}

# 3. Packages
Write-Step 'Project packages'
Push-Location $Root
try {
  Invoke-Checked 'pnpm install' { pnpm install --frozen-lockfile }
} finally {
  Pop-Location
}
Write-Done 'Packages are installed.'

# 4. .env.local
Write-Step 'Keys (.env.local)'
$envFile = Join-Path $Root '.env.local'
if (-not (Test-Path $envFile)) {
  $lines = Get-Content (Join-Path $Root '.env.example')
  $id = ''
  $key = ''
  if (-not $NoPrompt) {
    Write-Host '   Drawing on the board needs a Mathpix account to read handwriting'
    Write-Host '   (https://mathpix.com/docs/convert/overview). Press Enter to skip; you can'
    Write-Host '   add the keys to .env.local later.'
    $id = (Read-Host '   MATHPIX_APP_ID').Trim()
    if ($id) { $key = (Read-Host '   MATHPIX_APP_KEY').Trim() }
  }
  $lines = $lines | ForEach-Object {
    if ($_ -match '^MATHPIX_APP_ID=') { "MATHPIX_APP_ID=$id" }
    elseif ($_ -match '^MATHPIX_APP_KEY=') { "MATHPIX_APP_KEY=$key" }
    else { $_ }
  }
  # Node reads .env files as UTF-8; avoid the byte order mark Windows PowerShell would add.
  [IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
  Write-Done 'Created .env.local.'
} else {
  Write-Done '.env.local already exists; left as it is.'
}
$hasKeys = (Select-String -Path $envFile -Pattern '^MATHPIX_APP_ID=\S' -Quiet) -and
  (Select-String -Path $envFile -Pattern '^MATHPIX_APP_KEY=\S' -Quiet)
if (-not $hasKeys) {
  Write-Note 'No Mathpix keys yet: the board works, but handwriting will not be read until you add'
  Write-Note 'MATHPIX_APP_ID and MATHPIX_APP_KEY to .env.local and restart pnpm dev.'
}

# 5. TeX Live and veraPDF
Write-Step 'TeX Live (PDF handouts)'
$texBin = 'C:\texlive\2026\bin\windows'
if (Test-Path "$texBin\lualatex.exe") {
  Write-Done "TeX Live is installed in $texBin."
} elseif ($TeXLive -or (-not $NoTeXLive -and (Read-YesNo '   Install TeX Live 2026 now? About 400 MB and 15 to 40 minutes. Without it handouts come out as .tex files.'))) {
  & (Join-Path $Toolchain 'install-texlive.ps1') | Out-Null
  Write-Done "TeX Live is installed in $texBin."
} else {
  Write-Note 'Skipped. Install it later with:'
  Write-Note '  powershell -ExecutionPolicy Bypass -File apps\worker-compile\toolchain\install-texlive.ps1'
}

if ($VeraPdf) {
  Write-Step 'veraPDF (compile matrix only)'
  & (Join-Path $Toolchain 'install-verapdf.ps1')
}

Write-Step 'Ready'
Write-Host '   Start the board:   pnpm dev'
Write-Host '   Then open:         http://127.0.0.1:5173'
Write-Host '   Write on the board; each group of writing is read about two seconds after you'
Write-Host '   stop. Press "Make handout" for the PDF.'
