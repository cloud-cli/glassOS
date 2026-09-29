#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

for command in node npm dpkg-deb tar xz env cut; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command is missing: %s\n' "$command" >&2
    exit 1
  fi
done

node_supported="$(node -p 'const [major, minor] = process.versions.node.split(".").map(Number); major > 22 || (major === 22 && minor >= 13)')"
if [[ "$node_supported" != 'true' ]]; then
  printf 'Node.js 22.13 or newer is required; found %s\n' "$(node --version)" >&2
  exit 1
fi
npm_major="$(npm --version | cut -d. -f1)"
if (( npm_major < 10 )); then
  printf 'npm 10 or newer is required; found %s\n' "$(npm --version)" >&2
  exit 1
fi

printf '%s\n' 'Installing locked dependencies…'
npm ci

printf '%s\n' 'Running tests and static checks…'
npm test
npm run lint
npm run format:check

printf '%s\n' 'Building the Ubuntu/Debian x64 installer…'
npm run package:linux

version="$(node -p 'require("./package.json").version')"
artifact="dist/GlassOS-${version}-amd64.deb"
if [[ ! -f "$artifact" ]]; then
  printf 'Expected installer was not produced: %s\n' "$artifact" >&2
  exit 1
fi

package_name="$(dpkg-deb --field "$artifact" Package)"
architecture="$(dpkg-deb --field "$artifact" Architecture)"
if [[ "$package_name" != 'glassos' || "$architecture" != 'amd64' ]]; then
  printf 'Unexpected package metadata: Package=%s Architecture=%s\n' "$package_name" "$architecture" >&2
  exit 1
fi

temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT
dpkg-deb --extract "$artifact" "$temporary_dir"
if [[ ! -x "$temporary_dir/opt/GlassOS/glassos" ]]; then
  printf '%s\n' 'Installer is missing its executable.' >&2
  exit 1
fi
if [[ ! -s "$temporary_dir/opt/GlassOS/resources/app.asar" ]]; then
  printf '%s\n' 'Installer is missing the packaged application archive.' >&2
  exit 1
fi
if [[ ! -s "$temporary_dir/opt/GlassOS/resources/glassos-hyprland.conf" ]]; then
  printf '%s\n' 'Installer is missing its optional Hyprland preview profile.' >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/asar ]]; then
  printf '%s\n' 'ASAR inspection tool is missing after dependency installation.' >&2
  exit 1
fi
archive_entries="$(node_modules/.bin/asar list "$temporary_dir/opt/GlassOS/resources/app.asar")"
for entry in /backend/server.js /electron/main.js /electron/renderer.js /node_modules/ws/index.js; do
  if ! grep -Fqx "$entry" <<< "$archive_entries"; then
    printf 'Installer archive is missing required application content: %s\n' "$entry" >&2
    exit 1
  fi
done
if ! find "$temporary_dir/usr/share/applications" -maxdepth 1 -name '*.desktop' -print -quit | grep -q .; then
  printf '%s\n' 'Installer is missing its desktop launcher.' >&2
  exit 1
fi

if command -v xvfb-run >/dev/null 2>&1; then
  printf '\nRunning the packaged app smoke test under Xvfb…\n'
  env -u NODE_OPTIONS xvfb-run -a timeout 20s "$temporary_dir/opt/GlassOS/glassos" --no-sandbox --disable-gpu --smoke-test
else
  printf '\nSkipping packaged GUI smoke test (xvfb-run is not installed).\n' >&2
fi

printf '\nBuild complete. Installable artifact:\n  %s\nSHA-256:\n' "$ROOT_DIR/$artifact"
sha256sum "$artifact"
ls -lh "$artifact"
