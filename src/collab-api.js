import { userError } from "./user-error.js";

const apiUrl = String(import.meta.env.VITE_FLOATCODE_API_URL || "").trim().replace(/\/+$/, "");
const joinUrl = String(import.meta.env.VITE_FLOATCODE_JOIN_URL || "").trim().replace(/\/+$/, "");

export const productionCollaborationConfigured = Boolean(
  /^https:\/\//i.test(apiUrl) && !apiUrl.includes("YOUR_DOMAIN"),
);

async function request(path, accessToken, options = {}) {
  if (!productionCollaborationConfigured) {
    throw new Error("协作服务尚未配置，请联系应用维护者。");
  }
  if (!accessToken) throw new Error("请先登录。");

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
    throw new Error(userError({ ...payload?.error, status: response.status }, `协作服务暂时不可用（${response.status}），请稍后重试。`));
  }
  return payload;
}

export function createDocument(accessToken, title = "未命名代码") {
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
