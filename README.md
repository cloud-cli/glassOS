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
 │ NODE.JS DAEMON (Secure System Backend)               │
 │ - Runs on localhost loopback                          │
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
│   ├── main.js            # Sandboxed BrowserWindow lifecycle
│   ├── preload.js         # Deliberately empty web-only bridge
│   └── index.html         # Initial glass UI
├── hyprland/
│   └── hyprland.conf     # Minimal nested/kiosk compositor profile
├── package.json
└── README.md
```

## 3. Component Specifications

### A. Wayland Compositor

The Hyprland profile disables default borders, gaps, shadows, animations, status bars, wallpapers, and terminal shortcuts. It enables an aggressive blur profile and translucent application windows.

### B. Electron Frontend

The Electron window is frameless and transparent with `nodeIntegration: false` and `contextIsolation: true`. The renderer contains a 24px draggable header and Mac-style window controls. Control buttons use `-webkit-app-region: no-drag` so they remain interactive.

### C. Node.js Backend

The backend listens exclusively on `127.0.0.1:8080` and exposes a JSON-RPC-style WebSocket protocol plus a health endpoint. Incoming actions are validated against explicit handlers and an allowlist of readable paths. No frontend-provided string is passed to shell execution.

## 4. Development Commands

Install dependencies:

```bash
npm install
```

Start the backend:

```bash
npm run backend:start
```

Start Electron:

```bash
npm run electron:start
```

Run the initial unit and integration tests:

```bash
npm test
```

For a nested compositor session:

```bash
Hyprland --nested
export WAYLAND_DISPLAY=wayland-1
npm run electron:start
```

## 5. Environment Preparation

The following is a starting point for an Ubuntu test workspace. Review package availability for the target Ubuntu release before running it.

```bash
#!/usr/bin/env bash
set -euo pipefail

sudo apt update
sudo apt install -y hyprland xwayland build-essential curl

if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt install -y nodejs
fi
```

## 6. Automation Guardrails

- **Security boundary:** Renderer code must remain web-standard. Hardware, filesystem, configuration, and process operations belong behind validated loopback protocol handlers.
- **Protocol boundary:** Add new backend actions through explicit permission checks and input schemas. Never expose arbitrary shell execution.
- **Transparency rule:** Root viewport and layout wrappers must use `rgba`, `hsla`, or transparent backgrounds. Do not use fully opaque root viewport colors such as `#ffffff`.
- **Runtime boundary:** Keep Electron native APIs in the main process. Do not expose native Node.js APIs through preload.
- **Testing boundary:** Use nested Hyprland sessions for development rather than replacing a primary desktop session.

## 7. Next Implementation Steps

1. Replace the initial renderer with the chosen Vue 3 or vanilla UI architecture.
2. Define and document the JSON-RPC action schema.
3. Add automated backend protocol and renderer smoke tests.
4. Add service management and production hardening after the nested development flow is stable.

## 8. MK-1 Runtime Decision

Use **Electron for MK-1**. It matches the current scaffold, provides mature Wayland support and debugging tools, and lets the project validate the UI/backend protocol boundary before adding a Rust toolchain.

Wry is the better eventual fit when memory footprint and startup time become release requirements. Wry is a Rust webview library rather than a complete application runtime, so it requires more application and platform integration work. On Linux it also relies on the system WebKitGTK stack, which introduces deployment and rendering-version concerns.

The migration boundary should remain the web UI and loopback protocol. If the UI stays browser-standard and Electron-native APIs remain isolated, a later Wry client can reuse the renderer and backend without changing the system API.
