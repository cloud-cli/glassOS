const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const host = '127.0.0.1';
const readableFiles = new Set(['/etc/hostname']);

function response(id, result, error) {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, ...(error ? { error } : { result }) });
}

async function handleRequest(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return { error: { code: -32600, message: 'Invalid request' } };
  }

  if (request.method === 'readFile') {
    const requestedPath = request.params?.path;
    if (typeof requestedPath !== 'string' || !readableFiles.has(path.resolve(requestedPath))) {
      return { error: { code: -32001, message: 'Path is not permitted' } };
    }

    try {
      return { result: { path: requestedPath, contents: await fs.readFile(requestedPath, 'utf8') } };
    } catch {
      return { error: { code: -32002, message: 'Unable to read permitted file' } };
    }
  }

  return { error: { code: -32601, message: 'Method not found' } };
}

function createServer({ port = 8080 } = {}) {
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const websocket = new WebSocketServer({ server });
  websocket.on('connection', (socket) => {
    socket.on('message', async (raw) => {
      let request;
      try {
        request = JSON.parse(raw.toString());
      } catch {
        socket.send(response(null, null, { code: -32700, message: 'Parse error' }));
        return;
      }

      const result = await handleRequest(request);
      socket.send(response(request.id, result.result, result.error));
    });
  });

  return { server, websocket, port };
}

if (require.main === module) {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value] = arg.split('=');
    return [key, value];
  }));
  const port = Number(args.get('--port') || process.env.PORT || 8080);
  const { server } = createServer({ port });
  server.listen(port, host, () => {
    console.log(`GlassOS backend listening on http://${host}:${port}`);
  });
}

module.exports = { createServer, handleRequest, readableFiles };
