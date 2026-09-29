const assert = require("node:assert/strict");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { WebSocket } = require("ws");

const { createServer, handleRequest } = require("../backend/server");

const root = path.resolve(__dirname, "..");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server, websocket) {
  return new Promise((resolve, reject) => {
    websocket.close();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestOverWebSocket(url, request) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("error", reject);
    socket.once("open", () => {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "authorization",
          method: "authenticate",
          params: { token: "integration-test-token" },
        }),
      );
    });
    const onMessage = (message) => {
      const response = JSON.parse(message.toString());
      if (response.id === "authorization") {
        socket.send(JSON.stringify(request));
        return;
      }

      socket.off("message", onMessage);
      socket.close();
      resolve(response);
    };
    socket.on("message", onMessage);
  });
}

test("readFile accepts the explicit hostname allowlist entry", async () => {
  const result = await handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "readFile",
    params: { path: "/etc/hostname" },
  });

  assert.equal(result.error, undefined);
  assert.equal(typeof result.result.contents, "string");
  assert.equal(result.result.path, "/etc/hostname");
});

test("readFile rejects paths outside the allowlist", async () => {
  const result = await handleRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "readFile",
    params: { path: "/etc/passwd" },
  });

  assert.equal(result.result, undefined);
  assert.equal(result.error.code, -32001);
});

test("unknown methods are rejected", async () => {
  const result = await handleRequest({ jsonrpc: "2.0", id: 3, method: "exec" });
  assert.equal(result.error.code, -32601);
});

test("loopback HTTP and WebSocket integration works", async () => {
  const { server, websocket } = createServer({ port: 0, token: "integration-test-token" });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await new Promise((resolve, reject) => {
      http
        .get(`${baseUrl}/health`, (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => resolve({ statusCode: response.statusCode, body }));
        })
        .on("error", reject);
    });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { status: "ok" });

    const result = await requestOverWebSocket(`${baseUrl.replace("http", "ws")}`, {
      jsonrpc: "2.0",
      id: 4,
      method: "readFile",
      params: { path: "/etc/hostname" },
    });
    assert.equal(result.jsonrpc, "2.0");
    assert.equal(result.id, 4);
    assert.equal(typeof result.result.contents, "string");
  } finally {
    await close(server, websocket);
  }
});

test("Electron renderer preserves the web-only security boundary", async () => {
  const [main, preload, renderer, html] = await Promise.all([
    fs.readFile(path.join(root, "electron/main.js"), "utf8"),
    fs.readFile(path.join(root, "electron/preload.js"), "utf8"),
    fs.readFile(path.join(root, "electron/renderer.js"), "utf8"),
    fs.readFile(path.join(root, "electron/index.html"), "utf8"),
  ]);

  assert.match(main, /frame:\s*false/);
  assert.match(main, /transparent:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /utilityProcess\.fork/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\(\s*["']glassOS["']/);
  assert.doesNotMatch(preload, /exposeInMainWorld\(['"](?:ipcRenderer|require|process)['"]/);
  assert.doesNotMatch(preload, /child_process|node:fs|node:os/);
  assert.doesNotMatch(renderer, /require\(|from ['"]node:|child_process|\bos\./);
  assert.match(renderer, /new WebSocket\(["']ws:\/\/127\.0\.0\.1:8080["']\)/);
  assert.match(html, /-webkit-app-region:\s*drag/);
  assert.match(html, /-webkit-app-region:\s*no-drag/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /rgba\(/);
});

test("build script produces and validates a Linux installer from a clean checkout", async () => {
  const [buildScript, builderConfig] = await Promise.all([
    fs.readFile(path.join(root, "build.sh"), "utf8"),
    fs.readFile(path.join(root, "electron-builder.yml"), "utf8"),
  ]);

  assert.match(buildScript, /ROOT_DIR=.*BASH_SOURCE/);
  assert.match(buildScript, /npm ci/);
  assert.match(buildScript, /npm test/);
  assert.match(buildScript, /npm run package:linux/);
  assert.match(buildScript, /dpkg-deb --extract/);
  assert.match(buildScript, /asar list/);
  assert.match(builderConfig, /target: deb/);
  assert.match(builderConfig, /- x64/);
  await fs.access(path.join(root, "build.sh"), constants.X_OK);
});

test("Hyprland profile contains the low-overhead glass settings", async () => {
  const config = await fs.readFile(path.join(root, "hyprland/hyprland.conf"), "utf8");
  assert.match(config, /border_size\s*=\s*0/);
  assert.match(config, /gaps_in\s*=\s*0/);
  assert.match(config, /enabled\s*=\s*false/);
  assert.match(config, /passes\s*=\s*3/);
  assert.match(config, /size\s*=\s*8/);
  assert.match(config, /windowrulev2\s*=\s*blur/);
});
