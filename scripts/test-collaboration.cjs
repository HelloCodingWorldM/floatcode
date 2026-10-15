// Runs the real collaboration server with temporary storage and locally signed
// fixture tokens. Does not exercise production Supabase login or invite RPCs.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const WebSocket = require('ws');

async function until(check, label, timeout = 7000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${label}`);
}

async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('Mac origin CORS and real two-client collaboration', { timeout: 35000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'floatcode-collab-test-'));
  const port = await freePort();
  const secret = crypto.randomBytes(32).toString('hex');
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const server = spawn(process.execPath, ['server/index.cjs'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
      YPERSISTENCE: dir, SUPABASE_URL: 'https://fixture.invalid',
      SUPABASE_PUBLISHABLE_KEY: 'fixture', SUPABASE_SECRET_KEY: 'fixture',
      FLOATCODE_COLLAB_SECRET: secret, FLOATCODE_PUBLIC_WS_URL: `ws://127.0.0.1:${port}`,
      FLOATCODE_ALLOWED_ORIGINS: 'null,http://127.0.0.1:5173' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  const clients = [];
  t.after(async () => {
    for (const client of clients) { client.provider.destroy(); client.doc.destroy(); }
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    await rm(dir, { recursive: true, force: true });
  });
  await until(() => output.includes('listening on'), 'server startup');

  await t.test('preflight permits packaged Mac origin and rejects untrusted origins', async () => {
    for (const origin of ['null', 'http://127.0.0.1:5173']) {
      for (const route of ['/api/documents', '/api/invites/redeem']) {
        const response = await fetch(base + route, { method: 'OPTIONS', headers: {
          Origin: origin, 'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization,content-type',
        }});
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('access-control-allow-origin'), origin);
        assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
        assert.equal(response.headers.get('vary'), 'Origin');
      }
    }
    const forbidden = await fetch(base + '/api/documents', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.invalid' }});
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get('access-control-allow-origin'), null);
    const unauthenticated = await fetch(base + '/api/documents', { method: 'POST', headers: { Origin: 'null' }});
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('access-control-allow-origin'), 'null');
  });

  const room = crypto.randomUUID();
  function token(documentId) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'floatcode-collab', sub: crypto.randomUUID(), doc: documentId, role: 'editor', exp: Math.floor(Date.now()/1000) + 300 })}`;
    return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
  }
  function client() {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(`ws://127.0.0.1:${port}/collab`, room, doc, {
      params: { access_token: token(room) }, WebSocketPolyfill: WebSocket, disableBc: true,
    });
    const result = { doc, provider, text: doc.getText('code') };
    clients.push(result);
    return result;
  }

  await t.test('two clients synchronize concurrent edits, presence and reconnect', async () => {
    const a = client(); const b = client();
    await until(() => a.provider.synced && b.provider.synced, 'initial synchronization');
    a.provider.awareness.setLocalStateField('user', { name: 'Alice' });
    b.provider.awareness.setLocalStateField('user', { name: 'Bob' });
    await until(() => a.provider.awareness.getStates().size === 2 && b.provider.awareness.getStates().size === 2, 'two peers visible');
    a.text.insert(0, 'from Alice\n');
    b.text.insert(0, 'from Bob\n');
    await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('Alice') && a.text.toString().includes('Bob'), 'concurrent edits converge');
    b.provider.disconnect();
    a.text.insert(a.text.length, 'online edit\n');
    b.text.insert(b.text.length, 'offline edit\n');
    b.provider.connect();
    await until(() => b.provider.synced && a.text.toString() === b.text.toString() && a.text.toString().includes('offline edit') && a.text.toString().includes('online edit'), 'offline edits merge after reconnect');
    const c = client();
    await until(() => c.provider.synced && c.text.toString() === a.text.toString(), 'new participant receives current document');
  });

  await t.test('room tokens cannot access another room', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/collab/${crypto.randomUUID()}?access_token=${token(room)}`);
    const status = await new Promise((resolve, reject) => {
      socket.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode); });
      socket.on('open', () => reject(new Error('Unauthorized room opened')));
      socket.on('error', reject);
    });
    socket.terminate();
    assert.equal(status, 401);
  });
});
