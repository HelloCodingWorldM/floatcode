const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const WebSocket = require("ws");

process.env.YPERSISTENCE ||= path.resolve(
  process.env.FLOATCODE_DATA_DIR || path.join(process.cwd(), "data", "yjs"),
);
fs.mkdirSync(process.env.YPERSISTENCE, { recursive: true });

const { setupWSConnection } = require("y-websocket/bin/utils");

const PORT = Number(process.env.PORT || 1234);
const HOST = process.env.HOST || "0.0.0.0";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || "";
const COLLAB_SECRET = process.env.FLOATCODE_COLLAB_SECRET || "";
const PUBLIC_WS_URL = String(process.env.FLOATCODE_PUBLIC_WS_URL || "").replace(/\/+$/, "");
const DOWNLOAD_URL = String(process.env.FLOATCODE_DOWNLOAD_URL || "").trim();
const ALLOWED_ORIGINS = new Set(
  String(process.env.FLOATCODE_ALLOWED_ORIGINS || "http://127.0.0.1:5173,null,file://")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const TOKEN_TTL_SECONDS = Math.max(
  60,
  Math.min(900, Number(process.env.FLOATCODE_TOKEN_TTL_SECONDS || 300)),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;
const rateBuckets = new Map();

function assertConfiguration() {
  const missing = [];
  if (!/^https:\/\//i.test(SUPABASE_URL)) missing.push("SUPABASE_URL");
  if (!SUPABASE_PUBLISHABLE_KEY) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (!SUPABASE_SECRET_KEY) missing.push("SUPABASE_SECRET_KEY");
  if (COLLAB_SECRET.length < 32) missing.push("FLOATCODE_COLLAB_SECRET (at least 32 characters)");
  if (!/^wss?:\/\//i.test(PUBLIC_WS_URL)) missing.push("FLOATCODE_PUBLIC_WS_URL");
  if (missing.length) {
    throw new Error(`Missing or invalid server configuration: ${missing.join(", ")}`);
  }
}

function json(response, status, body, request) {
  const origin = request?.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

function html(response, status, body) {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  response.writeHead(status);
  response.end(body);
}

function reject(response, request, status, code, message) {
  json(response, status, { error: { code, message } }, request);
}

function allowOrigin(request, response) {
  const origin = request.headers.origin;
  if (!origin || ALLOWED_ORIGINS.has(origin)) return true;
  reject(response, request, 403, "origin_not_allowed", "This app origin is not allowed.");
  return false;
}

function rateLimit(request, response, scope, limit = 60, windowMs = 60_000) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const address = forwarded || request.socket.remoteAddress || "unknown";
  const key = `${scope}:${address}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  if (bucket.count <= limit) return true;
  response.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
  reject(response, request, 429, "rate_limited", "Too many requests. Try again shortly.");
  return false;
}

async function readJson(request, maximumBytes = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function authenticatedUser(request) {
  const token = bearerToken(request);
  if (!token) throw Object.assign(new Error("Sign in is required."), { status: 401 });
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error("Your session is invalid or expired."), { status: 401 });
  }
  return { token, user: await response.json() };
}

async function supabaseRest(route, { method = "GET", body, query = "", prefer } = {}) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };

  // New sb_secret_* keys are opaque, not JWTs, and must only be sent in the
  // apikey header. Keep Authorization for the legacy JWT service_role key so
  // existing deployments can migrate without downtime.
  if (!SUPABASE_SECRET_KEY.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${route}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.hint || `Database request failed (${response.status}).`;
    throw Object.assign(new Error(message), { status: response.status >= 500 ? 503 : 400 });
  }
  return payload;
}

async function callRpc(name, parameters) {
  return supabaseRest(`rpc/${name}`, {
    method: "POST",
    body: parameters,
    prefer: "return=representation",
  });
}

async function membership(documentId, userId) {
  const query = `?select=role&document_id=eq.${encodeURIComponent(documentId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const rows = await supabaseRest("floatcode_document_members", { query });
  return Array.isArray(rows) ? rows[0] || null : null;
}

function encodeSegment(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signCollabToken({ userId, documentId, role }) {
  const header = encodeSegment({ alg: "HS256", typ: "JWT" });
  const payload = encodeSegment({
    iss: "floatcode-collab",
    sub: userId,
    doc: documentId,
    role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
  });
  const signature = crypto
    .createHmac("sha256", COLLAB_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyCollabToken(token, documentId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const expected = crypto
    .createHmac("sha256", COLLAB_SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  let supplied;
  try { supplied = Buffer.from(parts[2], "base64url"); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== "floatcode-collab" || payload.doc !== documentId || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function accessPayload(documentId, userId, role) {
  return {
    documentId,
    role,
    websocketUrl: `${PUBLIC_WS_URL}/collab`,
    websocketToken: signCollabToken({ documentId, userId, role }),
    expiresIn: TOKEN_TTL_SECONDS,
  };
}

async function routeApi(request, response) {
  if (!allowOrigin(request, response)) return;
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && (url.pathname === "/join" || url.pathname === "/join/")) {
    const template = fs.readFileSync(path.join(__dirname, "public", "join.html"), "utf8");
    html(response, 200, template.replace("__DOWNLOAD_URL_JSON__", JSON.stringify(DOWNLOAD_URL)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, { ok: true, service: "floatcode-collab" }, request);
    return;
  }

  if (!rateLimit(request, response, "api")) return;
  const { user } = await authenticatedUser(request);

  if (request.method === "POST" && url.pathname === "/api/documents") {
    if (user.is_anonymous) {
      reject(response, request, 403, "owner_account_required", "Create an account before starting a shared room.");
      return;
    }
    const body = await readJson(request);
    const title = String(body.title || "Untitled code").trim().slice(0, 80) || "Untitled code";
    const rows = await callRpc("floatcode_create_document", {
      p_owner_id: user.id,
      p_title: title,
    });
    const document = Array.isArray(rows) ? rows[0] : rows;
    json(response, 201, accessPayload(document.document_id, user.id, "owner"), request);
    return;
  }

  const accessMatch = url.pathname.match(/^\/api\/documents\/([0-9a-f-]+)\/access$/i);
  if (request.method === "POST" && accessMatch && UUID_PATTERN.test(accessMatch[1])) {
    const documentId = accessMatch[1];
    const member = await membership(documentId, user.id);
    if (!member) {
      reject(response, request, 403, "document_forbidden", "You do not have access to this document.");
      return;
    }
    json(response, 200, accessPayload(documentId, user.id, member.role), request);
    return;
  }

  const inviteMatch = url.pathname.match(/^\/api\/documents\/([0-9a-f-]+)\/invites$/i);
  if (request.method === "POST" && inviteMatch && UUID_PATTERN.test(inviteMatch[1])) {
    const documentId = inviteMatch[1];
    const member = await membership(documentId, user.id);
    if (member?.role !== "owner") {
      reject(response, request, 403, "owner_required", "Only the document owner can create invitations.");
      return;
    }
    const body = await readJson(request);
    const hours = Math.max(1, Math.min(168, Number(body.expiresInHours || 24)));
    const maxUses = Math.max(1, Math.min(100, Number(body.maxUses || 25)));
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
    const rows = await supabaseRest("floatcode_document_invites", {
      method: "POST",
      body: {
        document_id: documentId,
        token_hash: tokenHash,
        role: "editor",
        expires_at: expiresAt,
        max_uses: maxUses,
        created_by: user.id,
      },
      prefer: "return=representation",
    });
    const invite = Array.isArray(rows) ? rows[0] : rows;
    json(response, 201, {
      inviteId: invite.id,
      token,
      expiresAt,
      maxUses,
    }, request);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/invites/redeem") {
    const body = await readJson(request);
    const token = String(body.token || "");
    if (!INVITE_PATTERN.test(token)) {
      reject(response, request, 400, "invalid_invite", "This invitation link is invalid.");
      return;
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const rows = await callRpc("floatcode_redeem_invite", {
      p_token_hash: tokenHash,
      p_user_id: user.id,
    });
    const redeemed = Array.isArray(rows) ? rows[0] : rows;
    if (!redeemed?.document_id) {
      reject(response, request, 410, "invite_unavailable", "This invitation has expired, was revoked, or reached its use limit.");
      return;
    }
    json(response, 200, accessPayload(redeemed.document_id, user.id, redeemed.member_role), request);
    return;
  }

  const revokeMatch = url.pathname.match(/^\/api\/invites\/([0-9a-f-]+)$/i);
  if (request.method === "DELETE" && revokeMatch && UUID_PATTERN.test(revokeMatch[1])) {
    const inviteId = revokeMatch[1];
    const query = `?select=id,document_id&id=eq.${encodeURIComponent(inviteId)}&limit=1`;
    const invites = await supabaseRest("floatcode_document_invites", { query });
    const invitation = Array.isArray(invites) ? invites[0] : null;
    if (!invitation) {
      reject(response, request, 404, "invite_not_found", "Invitation not found.");
      return;
    }
    const member = await membership(invitation.document_id, user.id);
    if (member?.role !== "owner") {
      reject(response, request, 403, "owner_required", "Only the document owner can revoke invitations.");
      return;
    }
    await supabaseRest("floatcode_document_invites", {
      method: "PATCH",
      query: `?id=eq.${encodeURIComponent(inviteId)}`,
      body: { revoked_at: new Date().toISOString() },
      prefer: "return=minimal",
    });
    json(response, 200, { revoked: true }, request);
    return;
  }

  reject(response, request, 404, "not_found", "Not found.");
}

assertConfiguration();

const server = http.createServer((request, response) => {
  routeApi(request, response).catch((error) => {
    console.error("API request failed:", error.message);
    if (!response.headersSent) {
      reject(response, request, error.status || 500, "request_failed", error.status ? error.message : "The server could not complete this request.");
    } else {
      response.end();
    }
  });
});

const websocketServer = new WebSocket.Server({
  noServer: true,
  clientTracking: true,
  maxPayload: 2 * 1024 * 1024,
});

websocketServer.on("connection", (socket, request, documentId) => {
  setupWSConnection(socket, request, { docName: documentId, gc: true });
});

server.on("upgrade", (request, socket, head) => {
  try {
    const origin = request.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) throw new Error("Origin not allowed");
    const url = new URL(request.url, "http://localhost");
    const match = url.pathname.match(/^\/collab\/([0-9a-f-]+)$/i);
    if (!match || !UUID_PATTERN.test(match[1])) throw new Error("Invalid document");
    const documentId = match[1];
    if (!verifyCollabToken(url.searchParams.get("access_token"), documentId)) {
      throw new Error("Invalid access token");
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request, documentId);
    });
  } catch {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`FloatCode collaboration server listening on ${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; closing FloatCode collaboration server.`);
  websocketServer.clients.forEach((client) => client.close(1001, "Server restarting"));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
