const apiUrl = String(import.meta.env.VITE_FLOATCODE_API_URL || "").trim().replace(/\/+$/, "");
const joinUrl = String(import.meta.env.VITE_FLOATCODE_JOIN_URL || "").trim().replace(/\/+$/, "");

export const productionCollaborationConfigured = Boolean(
  /^https:\/\//i.test(apiUrl) && !apiUrl.includes("YOUR_DOMAIN"),
);

async function request(path, accessToken, options = {}) {
  if (!productionCollaborationConfigured) {
    throw new Error("The production collaboration service is not configured.");
  }
  if (!accessToken) throw new Error("Sign in is required.");

  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method || "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Collaboration service error (${response.status}).`);
  }
  return payload;
}

export function createDocument(accessToken, title = "Untitled code") {
  return request("/api/documents", accessToken, { body: { title } });
}

export function getDocumentAccess(accessToken, documentId) {
  return request(`/api/documents/${encodeURIComponent(documentId)}/access`, accessToken);
}

export function createInvite(accessToken, documentId, options = {}) {
  return request(`/api/documents/${encodeURIComponent(documentId)}/invites`, accessToken, {
    body: {
      expiresInHours: options.expiresInHours || 24,
      maxUses: options.maxUses || 25,
    },
  });
}

export function redeemInvite(accessToken, token) {
  return request("/api/invites/redeem", accessToken, { body: { token } });
}

export function revokeInvite(accessToken, inviteId) {
  return request(`/api/invites/${encodeURIComponent(inviteId)}`, accessToken, {
    method: "DELETE",
  });
}

export function inviteLink(token) {
  if (joinUrl && /^https:\/\//i.test(joinUrl)) {
    return `${joinUrl}#token=${encodeURIComponent(token)}`;
  }
  return `floatcode://join?token=${encodeURIComponent(token)}`;
}
