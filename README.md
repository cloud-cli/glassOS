# GlassOS

## Architectural Design & LLM Implementation Blueprint

GlassOS is a lightweight, webview-driven UI layer running on Ubuntu Server. It strictly decouples the user interface from system operations using standard HTTP and WebSocket communication.

## 1. System Architecture Overview

```text
┌────────────────────────────────────────────────────────┐
│               SYSTEM LAYER ARCHITECTURE                │
└────────────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────────────┐
 │ HYPRLAND (Wayland Compositor / Display Server)       │
 │ - Manages display hardware via DRM/KMS               │
 │ - Renders system-level background blur               │
 └──────────────────────────┬───────────────────────────┘
                            │
            Spawns isolated, borderless UI runtimes
                            │
 ┌──────────────────────────────────────────────────────┐
 │ ELECTRON RUNTIME (Frontend Layer)                    │
 │ - Frameless and transparent                           │
 │ - Sandboxed with context isolation                    │
 │ - Custom window controls implemented in HTML/CSS      │
 └──────────────────────────┬───────────────────────────┘
                            │
                 HTTP / WebSocket over loopback
                            │
 ┌──────────────────────────────────────────────────────┐
 │ NODE.JS BACKEND (Electron Utility Process)           │
 │ - Separate process managed by the Electron runtime    │
 │ - Serves only on the localhost loopback               │
 │ - Handles validated file and process operations       │
 └──────────────────────────────────────────────────────┘
```

The frontend must never import `os`, `fs`, or `child_process`. System operations are explicit backend protocol actions targeting `127.0.0.1`.

## 2. Project Layout

```text
.
├── backend/
│   └── server.js          # Loopback HTTP/WebSocket service
├── electron/
│   ├── main.js            # Sandboxed BrowserWindow and backend lifecycle
│   ├── preload.js         # Narrow window-control API
│   ├── renderer.js        # Browser-only UI and WebSocket client
│   └── index.html         # Initial glass UI
├── hyprland/
│   └── hyprland.conf     # Minimal nested/kiosk compositor profile
├── test/                  # Unit, integration, and packaging checks
├── build.sh               # Reproducible Ubuntu x64 installer build
├── electron-builder.yml
├── package.json
└── README.md
```

## 3. Component Specifications

### A. Wayland Compositor

The Hyprland profile disables default borders, gaps, shadows, animations, status bars, wallpapers, and terminal shortcuts. It enables an aggressive blur profile and translucent application windows.

### B. Electron Frontend

The Electron window is frameless and transparent with `nodeIntegration: false`, `contextIsolation: true`, and sandboxing enabled. The renderer contains a 24px draggable header and functional window controls backed by a narrow preload API. Electron starts the backend as a separate utility process and stops it when the application exits.

### C. Node.js Backend

The backend listens exclusively on `127.0.0.1:8080` and exposes a JSON-RPC-style WebSocket protocol plus `GET /health`. Each app launch generates a random authorization token and transfers it to the backend process and trusted renderer through process/preload channels. Messages have a 16 KiB size limit, compression is disabled, and non-local browser origins are rejected; every socket must authenticate before any method can run. No frontend-provided string is passed to shell execution.

The client first sends `{"jsonrpc":"2.0","id":"authorization","method":"authenticate","params":{"token":"<launch token>"}}` and receives `{"jsonrpc":"2.0","id":"authorization","result":{"authenticated":true}}`. The protocol then intentionally exposes one system action:

```json
{
  "jsonrpc": "2.0",
  "id": "hostname",
  "method": "readFile",
  "params": { "path": "/etc/hostname" }
}
```

Success returns `{"jsonrpc":"2.0","id":"hostname","result":{"path":"/etc/hostname","contents":"…"}}`. Invalid requests, disallowed paths, unreadable files, and unknown methods return JSON-RPC-style errors; arbitrary file paths and shell commands are not supported.

## 4. Build and Install on Ubuntu

The supported installer target is **Ubuntu 22.04/24.04/26.04, x86_64**. The build machine needs Node.js 22.13 or newer, npm 10 or newer, `dpkg-deb`, `tar`, and `xz-utils`. If `xvfb-run` is installed, the build also launches the packaged application and verifies the UI-to-backend flow headlessly. From a fresh clone, run:

```bash
git clone https://github.com/cloud-cli/glassOS.git
cd glassOS
./build.sh
```

`build.sh` installs locked dependencies, runs tests/lint/format checks, packages Electron, and verifies the resulting Debian package. The downloadable installer is written to `dist/GlassOS-<version>-amd64.deb`.

Install and launch:

```bash
sudo apt install ./dist/GlassOS-0.1.1-amd64.deb
glassos
```

The Debian package declares the desktop runtime libraries as package dependencies. It bundles Electron and the backend; a separate Node.js installation is not needed on the target computer. The package installs a desktop-menu launcher and can be removed with:

```bash
sudo apt remove glassos
```

The first screen shows whether the backend connected and includes a button that reads the allowlisted hostname through the WebSocket protocol.

## 5. Development and Verification

Install dependencies and run the test suite:

```bash
npm ci
npm test
npm run lint
npm run format:check
```

To run the Electron window and end-to-end backend UI check without a desktop session (with Xvfb installed):

```bash
xvfb-run -a ./node_modules/.bin/electron . --no-sandbox --disable-gpu --smoke-test
```

For development, launch Electron normally; it starts and supervises the backend utility process automatically:

```bash
npm run electron:start
```

For standalone protocol development (without Electron), launch the backend with a per-session token:

```bash
export GLASSOS_BACKEND_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm run backend:start
```

To preview the Hyprland glass effect, first update GlassOS to version 0.1.1 and install Hyprland. Then run this from a terminal opened inside your regular Ubuntu Wayland desktop (not from a TTY):

```bash
sudo apt install ./dist/GlassOS-0.1.1-amd64.deb hyprland
Hyprland -c /opt/GlassOS/resources/glassos-hyprland.conf
```

This opens a nested Hyprland preview, starts GlassOS automatically, and only applies opacity to GlassOS. Press **Super+Escape** to close the preview; it does not replace or modify your regular desktop session/configuration.

## 6. Optional Environment Preparation

On an Ubuntu development machine, install Hyprland/XWayland if needed:

```bash
#!/usr/bin/env bash
set -euo pipefail

sudo apt update
sudo apt install -y hyprland xwayland build-essential curl xz-utils xvfb

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'const [major, minor] = process.versions.node.split(".").map(Number); major > 22 || (major === 22 && minor >= 13)')" != 'true' ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
fi
```

## 7. Automation Guardrails

- **Security boundary:** Renderer code must remain web-standard. Hardware, filesystem, configuration, and process operations belong behind validated loopback protocol handlers.
- **Protocol boundary:** Add new backend actions through explicit permission checks and input schemas. Never expose arbitrary shell execution.
- **Transparency rule:** Root viewport and layout wrappers must use `rgba`, `hsla`, or transparent backgrounds. Do not use fully opaque root viewport colors such as `#ffffff`.
- **Runtime boundary:** Keep Electron native APIs in the main process. Do not expose native Node.js APIs through preload.
- **Testing boundary:** Use nested Hyprland sessions for development rather than replacing a primary desktop session.

## 8. Next Implementation Steps

1. Validate the installer on supported Ubuntu releases and a native Wayland/Hyprland session.
2. Specify schemas and permissions before adding any system operation to the backend protocol.
3. Replace the hostname demonstration with the first user-facing shell components.
4. Add signing and update delivery after the target-machine workflow is established.

## 9. MK-1 Runtime Decision

Use **Electron for MK-1**. It matches the current scaffold, provides mature Wayland support and debugging tools, and lets the project validate the UI/backend protocol boundary before adding a Rust toolchain.

Wry is the better eventual fit when memory footprint and startup time become release requirements. Wry is a Rust webview library rather than a complete application runtime, so it requires more application and platform integration work. On Linux it also relies on the system WebKitGTK stack, which introduces deployment and rendering-version concerns.

The migration boundary should remain the web UI and loopback protocol. If the UI stays browser-standard and Electron-native APIs remain isolated, a later Wry client can reuse the renderer and backend without changing the system API.
