#!/usr/bin/env sh
set -eu

fail() {
  printf 'FAILURE: jb-sdd-odd-models installer: %s\n' "$*" >&2
  exit 1
}

printf 'jb-sdd-odd-models installer starting. Preflight: checking Node.js and Pi home.\n'
command -v node >/dev/null 2>&1 || fail "Node.js is required (Pi itself requires Node.js)."
NODE_VERSION=$(node -p "process.versions.node" 2>/dev/null || node --version 2>/dev/null || printf '0.0.0')
NODE_VERSION=${NODE_VERSION#v}
NODE_MAJOR=${NODE_VERSION%%.*}
NODE_REST=${NODE_VERSION#*.}
NODE_MINOR=${NODE_REST%%.*}
case "$NODE_MAJOR:$NODE_MINOR" in
  ''|*[!0-9:]* ) fail "Could not determine Node.js version. Node.js 22.19.0 or newer is required for --experimental-strip-types." ;;
esac
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 19 ]; }; then
  fail "Node.js 22.19.0 or newer is required to run the TypeScript installer with --experimental-strip-types (found v$NODE_VERSION)."
fi

if [ -z "${PI_HOME:-}" ] && [ -z "${HOME:-}" ]; then
  fail "Neither HOME nor PI_HOME is set. Set one before installing."
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PI_HOME=${PI_HOME:-"$HOME/.pi"}

[ -d "$PI_HOME/agent" ] || fail "Pi agent directory not found at $PI_HOME/agent. Install Gentle Pi first, or set PI_HOME to its Pi home."
[ -f "$SCRIPT_DIR/model-profiles-install.ts" ] || fail "Package asset is missing: install/model-profiles-install.ts"

PACKAGE_ROOT=$PACKAGE_ROOT PI_HOME=$PI_HOME exec node --experimental-strip-types "$SCRIPT_DIR/model-profiles-install.ts"
