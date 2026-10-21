<#
.SYNOPSIS
  Installs the pinned TeX Live release for Chalkline compiles on Windows.

.DESCRIPTION
  The Windows counterpart of install-texlive.sh: TeX Live 2026 (scheme-small
  plus the packages in texlive-packages.txt), the hardened texmf.cnf, and
  warm luaotfload font caches, so the first handout does not spend minutes
  indexing fonts.

  Installs for the current user (no administrator rights) and leaves PATH and
  file associations alone: Chalkline looks for TeX Live at
  C:\texlive\2026\bin\windows, or wherever TEXLIVE_BIN points.

  Safe to run again: an existing install is kept and only the packages,
  texmf.cnf and font caches are brought up to date.

  Takes 15 to 40 minutes depending on the mirror; it downloads about 400 MB.

.PARAMETER Prefix
  Install root (default C:\texlive). TeX Live goes into <Prefix>\2026.
  Keep it free of spaces and non-ASCII characters.

.PARAMETER Repository
  Package repository (default: $env:TEXLIVE_REPOSITORY, else the CTAN
  mirror redirector). Once the release is frozen, point it at the historic
  archive for a reproducible install:
  https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2026/tlnet-final

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\worker-compile\toolchain\install-texlive.ps1
#>
[CmdletBinding()]
param(
  [string]$Prefix = 'C:\texlive',
  [string]$Repository = $env:TEXLIVE_REPOSITORY
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell's progress bar slows downloads down by an order of magnitude.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol =
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Release = 2026
if (-not $Repository) { $Repository = 'https://mirror.ctan.org/systems/texlive/tlnet' }
$Repository = $Repository.TrimEnd('/')
if ($Prefix -match '\s' -or $Prefix -match '[^\x20-\x7E]') {
  throw "Choose a -Prefix without spaces or non-ASCII characters (got '$Prefix')."
}

$Here = $PSScriptRoot
$TexDir = Join-Path $Prefix $Release
$Bin = Join-Path $TexDir 'bin\windows'
# Work inside the prefix rather than %TEMP%: user profile paths often contain
# spaces or non-ASCII characters, which the TeX Live installer handles badly.
$Work = Join-Path $Prefix ('.install-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

function Invoke-Logged {
  <#
    Runs one command line through cmd.exe with no input (so nothing can wait
    for a key press) and its output in a log; shows the end of the log and
    stops if it fails. A .cmd file avoids PowerShell-to-cmd quoting rules.
  #>
  param([string]$CommandLine, [string]$Log, [string]$What)
  $script = Join-Path $Work 'run.cmd'
  Set-Content -Path $script -Encoding Ascii -Value "@$CommandLine < NUL > `"$Log`" 2>&1"
  & cmd.exe /d /c "`"$script`""
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $Log) { Get-Content $Log -Tail 50 | ForEach-Object { Write-Host $_ } }
    throw "$What failed (exit code $LASTEXITCODE). The end of its log is above; the full log is $Log."
  }
}

New-Item -ItemType Directory -Force -Path $Work | Out-Null
$failed = $true
try {
  if ((Test-Path (Join-Path $Bin 'lualatex.exe')) -and (Test-Path (Join-Path $Bin 'tlmgr.bat'))) {
    Write-Host "TeX Live $Release is already installed in $TexDir; updating packages and caches."
  } else {
    Write-Host "Downloading the TeX Live installer from $Repository ..."
    $zip = Join-Path $Work 'install-tl.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "$Repository/install-tl.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $Work
    $installer = Get-ChildItem -Path $Work -Recurse -Filter 'install-tl-windows.bat' |
      Select-Object -First 1
    if (-not $installer) { throw 'install-tl.zip did not contain install-tl-windows.bat.' }
    $releaseFile = Join-Path $installer.DirectoryName 'release-texlive.txt'
    if (-not (Select-String -Path $releaseFile -Pattern "version $Release" -Quiet)) {
      throw "The repository does not serve TeX Live $Release. Set -Repository to a $Release mirror."
    }

    $slash = { param($p) $p -replace '\\', '/' }
    $profilePath = Join-Path $Work 'texlive.profile'
    Set-Content -Path $profilePath -Encoding Ascii -Value @(
      'selected_scheme scheme-small'
      "TEXDIR $(& $slash $TexDir)"
      "TEXMFLOCAL $(& $slash (Join-Path $Prefix 'texmf-local'))"
      "TEXMFSYSVAR $(& $slash (Join-Path $TexDir 'texmf-var'))"
      "TEXMFSYSCONFIG $(& $slash (Join-Path $TexDir 'texmf-config'))"
      'instopt_adjustpath 0'
      'instopt_adjustrepo 0'
      'tlpdbopt_install_docfiles 0'
      'tlpdbopt_install_srcfiles 0'
      'tlpdbopt_autobackup 0'
      'tlpdbopt_desktop_integration 0'
      'tlpdbopt_file_assocs 0'
      'tlpdbopt_w32_multi_user 0'
    )

    Write-Host "Installing TeX Live $Release into $TexDir (this is the long part) ..."
    Invoke-Logged -What 'The TeX Live installer' -Log (Join-Path $Work 'install.log') `
      -CommandLine "call `"$($installer.FullName)`" -no-gui -profile `"$profilePath`" -repository `"$Repository`""
    if (-not (Test-Path (Join-Path $Bin 'lualatex.exe'))) {
      throw "The installer finished but $Bin\lualatex.exe is missing."
    }
  }

  # The installation's own programs first, for this script and what it starts.
  $env:PATH = "$Bin;$env:PATH"

  $packages = @(Get-Content (Join-Path $Here 'texlive-packages.txt') |
      Where-Object { $_ -notmatch '^\s*(#|$)' } | ForEach-Object { $_.Trim() })
  Write-Host "Installing $($packages.Count) packages Chalkline's presets use ..."
  Invoke-Logged -What 'tlmgr' -Log (Join-Path $Work 'tlmgr.log') `
    -CommandLine "call `"$Bin\tlmgr.bat`" --repository `"$Repository`" install $($packages -join ' ')"

  Copy-Item -Force (Join-Path $Here 'texmf.cnf') (Join-Path $TexDir 'texmf.cnf')

  # Warm luaotfload's font caches into the system tree, which compiles read
  # first; otherwise every compile re-parses every font.
  Write-Host 'Building font caches ...'
  $env:TEXMFCACHE = Join-Path $TexDir 'texmf-var'
  Invoke-Logged -What 'luaotfload-tool' -Log (Join-Path $Work 'fonts.log') `
    -CommandLine "`"$Bin\luaotfload-tool.exe`" --update"
  Copy-Item (Join-Path $Here 'warmup.tex') (Join-Path $Work 'warmup.tex')
  Invoke-Logged -What 'The warm-up compile' -Log (Join-Path $Work 'warmup.out') `
    -CommandLine "cd /d `"$Work`" && `"$Bin\lualatex.exe`" -interaction=nonstopmode -halt-on-error warmup.tex"
  $failed = $false
} finally {
  # Keep the logs when something failed; they are what explains it.
  if ($failed) {
    Write-Host "Logs kept in $Work"
  } else {
    Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
  }
}

Write-Host "TeX Live $Release is ready: $Bin"
$Bin
