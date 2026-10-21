<#
.SYNOPSIS
  Installs veraPDF (PDF/UA-2 validation for pnpm compile-matrix) on Windows.

.DESCRIPTION
  The Windows counterpart of install-verapdf.sh. Needs Java 11 or later on
  PATH, for example: winget install EclipseAdoptium.Temurin.21.JRE
  Only the compile matrix uses veraPDF; drawing on the board does not need it.

.PARAMETER Prefix
  Install folder (default C:\verapdf). The compile matrix looks for
  C:\verapdf\verapdf.bat, or wherever VERAPDF points.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\worker-compile\toolchain\install-verapdf.ps1
#>
[CmdletBinding()]
param([string]$Prefix = 'C:\verapdf')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol =
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
  throw 'veraPDF needs Java 11 or later on PATH. Install it with: winget install EclipseAdoptium.Temurin.21.JRE'
}

$Work = Join-Path ([IO.Path]::GetTempPath()) ('chalkline-verapdf-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $Work | Out-Null
try {
  Write-Host 'Downloading the veraPDF installer ...'
  $zip = Join-Path $Work 'installer.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://software.verapdf.org/releases/verapdf-installer.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $Work
  $jar = Get-ChildItem -Path $Work -Recurse -Filter 'verapdf-izpack-installer-*.jar' | Select-Object -First 1
  if (-not $jar) { throw 'The veraPDF download did not contain the installer.' }

  $installPath = [Security.SecurityElement]::Escape($Prefix)
  $answers = Join-Path $Work 'auto-install.xml'
  # UTF-8 without a byte order mark; Windows PowerShell's -Encoding UTF8 would add one.
  [IO.File]::WriteAllText($answers, @"
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>$installPath</installpath></com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Batch files" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="true"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>
</AutomatedInstallation>
"@, (New-Object Text.UTF8Encoding $false))

  Write-Host "Installing veraPDF into $Prefix ..."
  # Java reports progress on stderr; Windows PowerShell would turn that into errors.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & java -jar $jar.FullName $answers 2>&1 | Out-Null
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) { throw "The veraPDF installer failed (exit code $code)." }
} finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}

$launcher = Join-Path $Prefix 'verapdf.bat'
if (-not (Test-Path $launcher)) { throw "veraPDF did not install: $launcher is missing." }
& cmd.exe /d /c "`"$launcher`" --version" | Select-Object -First 1
Write-Host "veraPDF is ready: $launcher"
