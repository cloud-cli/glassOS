const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../backend/server");
const { WebSocket } = require("ws");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function waitForMessage(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onMessage = (data) => {
      cleanup();
      resolve(JSON.parse(data.toString()));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code, reason) => {
      cleanup();
      reject(new Error(`Socket closed before a response: ${code} ${reason.toString()}`));
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function waitForClose(socket) {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

async function createBackend(t, { token = "test-token-12345678901234567890123456789012" } = {}) {
  const { server, websocket } = createServer({ port: 0, token });
  const address = await listen(server);
  const sockets = new Set();

  t.after(async () => {
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    }

    await new Promise((resolve) => websocket.close(resolve));
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  return {
    token,
    url: `ws://127.0.0.1:${address.port}`,
    connect: async (origin = "file://") => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, {
        headers: { Origin: origin },
      });
      sockets.add(socket);
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      return socket;
    },
    track: (socket) => sockets.add(socket),
  };
}

async function authenticate(socket, token) {
  const responsePromise = waitForMessage(socket);
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "auth",
      method: "authenticate",
      params: { token },
    }),
  );
  return responsePromise;
}

test("unauthenticated WebSocket connections time out and close with policy violation", { timeout: 8000 }, async (t) => {
  const backend = await createBackend(t);
  const socket = await backend.connect();
  const closePromise = waitForClose(socket);
  const closeInfo = await closePromise;

  assert.equal(closeInfo.code, 1008);
  assert.equal(closeInfo.reason, "Authorization required");
});

test("valid token authenticates the socket and permits the allowlisted read", async (t) => {
  const backend = await createBackend(t);
  const socket = await backend.connect();

  assert.deepEqual(await authenticate(socket, backend.token), {
    jsonrpc: "2.0",
    id: "auth",
    result: { authenticated: true },
  });

  const responsePromise = waitForMessage(socket);
  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "read1",
      method: "readFile",
      params: { path: "/etc/hostname" },
    }),
  );
  const response = await responsePromise;

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, "read1");
  assert.equal(response.result.path, "/etc/hostname");
  assert.equal(typeof response.result.contents, "string");
});

test("invalid token is rejected with policy violation", async (t) => {
  const backend = await createBackend(t);
  const socket = await backend.connect();
  const closePromise = waitForClose(socket);

  socket.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "auth",
      method: "authenticate",
      params: { token: "incorrect-token" },
    }),
  );

  assert.equal((await closePromise).code, 1008);
});

test("non-local browser origins are rejected during the WebSocket handshake", async (t) => {
  const backend = await createBackend(t);
  const socket = new WebSocket(backend.url, { headers: { Origin: "https://evil.example" } });
  backend.track(socket);

  const error = await new Promise((resolve, reject) => {
    socket.once("error", resolve);
    socket.once("open", () => reject(new Error("Unexpectedly accepted a non-local origin")));
  });

  assert.match(error.message, /Unexpected server response/);
});

test("WebSocket payloads larger than 16 KiB are rejected", async (t) => {
  const backend = await createBackend(t);
  const socket = await backend.connect();

  await authenticate(socket, backend.token);
  const closePromise = waitForClose(socket);
  socket.send("x".repeat(20 * 1024));

  assert.equal((await closePromise).code, 1009);
});
