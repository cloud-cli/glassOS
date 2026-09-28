const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');

const { createServer, handleRequest } = require('../backend/server');

const root = path.resolve(__dirname, '..');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server, websocket) {
  return new Promise((resolve, reject) => {
    websocket.close();
    server.close((error) => error ? reject(error) : resolve());
  });
}

function requestOverWebSocket(url, request) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('error', reject);
    socket.once('open', () => socket.send(JSON.stringify(request)));
    socket.once('message', (message) => {
      socket.close();
      resolve(JSON.parse(message.toString()));
    });
  });
}

test('readFile accepts the explicit hostname allowlist entry', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'readFile',
    params: { path: '/etc/hostname' }
  });

  assert.equal(result.error, undefined);
  assert.equal(typeof result.result.contents, 'string');
  assert.equal(result.result.path, '/etc/hostname');
});

test('readFile rejects paths outside the allowlist', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'readFile',
    params: { path: '/etc/passwd' }
  });

  assert.equal(result.result, undefined);
  assert.equal(result.error.code, -32001);
});

test('unknown methods are rejected', async () => {
  const result = await handleRequest({ jsonrpc: '2.0', id: 3, method: 'exec' });
  assert.equal(result.error.code, -32601);
});

test('loopback HTTP and WebSocket integration works', async () => {
  const { server, websocket } = createServer({ port: 0 });
  const address = await listen(server);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/health`, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ statusCode: response.statusCode, body }));
      }).on('error', reject);
    });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { status: 'ok' });

    const result = await requestOverWebSocket(`${baseUrl.replace('http', 'ws')}`, {
      jsonrpc: '2.0',
      id: 4,
      method: 'readFile',
      params: { path: '/etc/hostname' }
    });
    assert.equal(result.jsonrpc, '2.0');
    assert.equal(result.id, 4);
    assert.equal(typeof result.result.contents, 'string');
  } finally {
    await close(server, websocket);
  }
});

test('Electron renderer preserves the web-only security boundary', async () => {
  const [main, preload, renderer] = await Promise.all([
    fs.readFile(path.join(root, 'electron/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'electron/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'electron/index.html'), 'utf8')
  ]);

  assert.match(main, /frame:\s*false/);
  assert.match(main, /transparent:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.doesNotMatch(preload, /require\(|process\.|global\./);
  assert.match(renderer, /-webkit-app-region:\s*drag/);
  assert.match(renderer, /-webkit-app-region:\s*no-drag/);
  assert.match(renderer, /rgba\(/);
});

test('Hyprland profile contains the low-overhead glass settings', async () => {
  const config = await fs.readFile(path.join(root, 'hyprland/hyprland.conf'), 'utf8');
  assert.match(config, /border_size\s*=\s*0/);
  assert.match(config, /gaps_in\s*=\s*0/);
  assert.match(config, /enabled\s*=\s*false/);
  assert.match(config, /passes\s*=\s*3/);
  assert.match(config, /size\s*=\s*8/);
  assert.match(config, /windowrulev2\s*=\s*blur/);
});
