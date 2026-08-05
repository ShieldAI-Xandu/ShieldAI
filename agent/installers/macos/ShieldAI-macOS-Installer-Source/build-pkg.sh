#!/usr/bin/env bash
# ============================================================================
#  ShieldAI Agent — macOS .pkg build script
# ----------------------------------------------------------------------------
#  Run this ON A MAC (needs pkgbuild, part of Xcode Command Line Tools —
#  install with `xcode-select --install` if you don't already have it).
#
#  Usage:
#    ./build-pkg.sh                                     # production build
#    ./build-pkg.sh --server-url http://localhost:3001   # test build
#
#  Output: Output/ShieldAI-Agent.pkg — the one file to send to clients.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_URL="https://shieldai-production-627e.up.railway.app"
IDENTIFIER="com.xandultd.shieldai.agent"
VERSION="1.0.0"

while [ $# -gt 0 ]; do
  case "$1" in
    --server-url) SERVER_URL="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if ! command -v pkgbuild >/dev/null 2>&1; then
  echo "pkgbuild not found. Install Xcode Command Line Tools first:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

OUT="$HERE/Output"
mkdir -p "$OUT"

# Stamp the server URL into a fresh copy of postinstall for this build so the
# source template (scripts/postinstall) stays clean and reusable.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/scripts"
sed "s|__SERVER_URL__|$SERVER_URL|g" "$HERE/scripts/postinstall" > "$STAGE/scripts/postinstall"
chmod +x "$STAGE/scripts/postinstall"

pkgbuild \
  --root "$HERE/payload" \
  --scripts "$STAGE/scripts" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "/usr/local/shieldai/installer" \
  "$OUT/ShieldAI-Agent.pkg"

echo
echo "Built: $OUT/ShieldAI-Agent.pkg"
echo "Server URL baked in: $SERVER_URL"
echo
echo "This pkg is unsigned. Before sending it to any real client, read the"
echo "'Code signing & notarization' section in README-BUILD-MACOS-INSTALLER.md —"
echo "on current macOS, Gatekeeper blocks unsigned installers by default."
