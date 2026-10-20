#!/usr/bin/env bash
# Installs veraPDF (PDF/UA-2 validation) headlessly. Needs Java 11+.
#   install-verapdf.sh [PREFIX]            (default PREFIX=/opt/verapdf)
set -euo pipefail

PREFIX="${1:-/opt/verapdf}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL --retry 4 --retry-all-errors -o "$WORK/installer.zip" https://software.verapdf.org/releases/verapdf-installer.zip
unzip -q "$WORK/installer.zip" -d "$WORK"
JAR="$(find "$WORK" -name 'verapdf-izpack-installer-*.jar' | head -1)"
cat > "$WORK/auto-install.xml" <<XML
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>$PREFIX</installpath></com.izforge.izpack.panels.target.TargetPanel>
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
XML
java -jar "$JAR" "$WORK/auto-install.xml" >/dev/null
"$PREFIX/verapdf" --version | head -1
