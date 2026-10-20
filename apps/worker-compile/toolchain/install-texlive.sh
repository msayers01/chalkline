#!/usr/bin/env bash
# Installs the pinned TeX Live release for Chalkline compiles.
#   install-texlive.sh [PREFIX]            (default PREFIX=/opt/texlive)
# Env: TEXLIVE_REPOSITORY overrides the package repository. Once the release
# is frozen, point it at the historic archive for a fully reproducible build:
#   https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2026/tlnet-final
set -euo pipefail

RELEASE=2026
PREFIX="${1:-/opt/texlive}"
REPO="${TEXLIVE_REPOSITORY:-https://mirror.ctan.org/systems/texlive/tlnet}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL --retry 4 --retry-all-errors -o "$WORK/install-tl.tar.gz" "$REPO/install-tl-unx.tar.gz"
tar -xzf "$WORK/install-tl.tar.gz" -C "$WORK"
INSTALLER="$(find "$WORK" -maxdepth 2 -name install-tl -type f)"
if ! grep -q "version $RELEASE" "$(dirname "$INSTALLER")/release-texlive.txt"; then
  echo "repository does not serve TeX Live $RELEASE" >&2
  exit 1
fi

cat > "$WORK/texlive.profile" <<PROFILE
selected_scheme scheme-small
TEXDIR $PREFIX/$RELEASE
TEXMFLOCAL $PREFIX/texmf-local
TEXMFSYSVAR $PREFIX/$RELEASE/texmf-var
TEXMFSYSCONFIG $PREFIX/$RELEASE/texmf-config
instopt_adjustpath 0
instopt_adjustrepo 0
tlpdbopt_install_docfiles 0
tlpdbopt_install_srcfiles 0
tlpdbopt_autobackup 0
PROFILE

"$INSTALLER" --profile="$WORK/texlive.profile" --repository="$REPO" >"$WORK/install.log" 2>&1 || {
  tail -50 "$WORK/install.log" >&2
  exit 1
}

BIN="$(find "$PREFIX/$RELEASE/bin" -mindepth 1 -maxdepth 1 -type d | head -1)"
export PATH="$BIN:$PATH"
grep -vE '^\s*(#|$)' "$HERE/texlive-packages.txt" | xargs tlmgr --repository "$REPO" install >"$WORK/tlmgr.log" 2>&1 || {
  tail -50 "$WORK/tlmgr.log" >&2
  exit 1
}
cp "$HERE/texmf.cnf" "$PREFIX/$RELEASE/texmf.cnf"
export TEXMFCACHE="$PREFIX/$RELEASE/texmf-var"
luaotfload-tool --update >/dev/null
# Warm luaotfload's font caches into the system tree, which is still writable
# here; sandboxed jobs see it read-only and would otherwise re-parse every
# font on every compile.
cp "$HERE/warmup.tex" "$WORK/warmup.tex"
(cd "$WORK" && lualatex -interaction=nonstopmode -halt-on-error warmup.tex >"$WORK/warmup.log" 2>&1) || {
  tail -30 "$WORK/warmup.log" >&2
  exit 1
}
echo "$BIN"
