// Translate service errors at the UI boundary; protocol codes stay unchanged.
const messages = {
  invalid_credentials: "邮箱或密码不正确。",
  email_not_confirmed: "邮箱尚未验证，请先打开邮箱中的确认链接。",
  user_already_exists: "此邮箱已注册，请直接登录。",
  email_exists: "此邮箱已注册，请直接登录。",
  weak_password: "密码强度不足，请使用更长、更复杂的密码。",
  over_request_rate_limit: "操作过于频繁，请稍后重试。",
  over_email_send_rate_limit: "邮件发送过于频繁，请稍后重试。",
  signup_disabled: "暂时无法注册新账号，请稍后重试。",
  anonymous_provider_disabled: "访客登录暂不可用，请联系文档创建者。",
  session_expired: "登录已过期，请重新登录。",
  refresh_token_not_found: "登录已过期，请重新登录。",
  owner_account_required: "请先注册并登录，再创建共享文档。",
  document_forbidden: "你没有此文档的访问权限，请向创建者索取邀请链接。",
  owner_required: "只有文档创建者可以管理邀请链接。",
  invalid_invite: "此邀请链接无效，请向创建者索取新链接。",
  invite_unavailable: "此邀请已过期、被撤销或达到使用次数上限，请索取新链接。",
  invite_not_found: "未找到此邀请链接。",
  rate_limited: "操作过于频繁，请稍后重试。",
};

export function userError(error, fallback = "操作失败，请稍后重试。") {
  if (globalThis.navigator?.onLine === false) return "网络已断开，请检查网络连接。";
  if (Object.hasOwn(messages, error?.code)) return messages[error.code];
  const message = String(error?.message || "");
  // Locally authored Chinese messages can be shown without translating twice.
  if (/[\u3400-\u9fff]/u.test(message)) return message;
  if (/invalid login credentials/i.test(message)) return messages.invalid_credentials;
  if (/email not confirmed/i.test(message)) return messages.email_not_confirmed;
  if (/already registered/i.test(message)) return messages.user_already_exists;
  if (/password.*at least/i.test(message)) return "密码至少需要 6 个字符。";
  if (/invalid.*email|email.*invalid/i.test(message)) return "请输入有效的邮箱地址。";
  if (/fetch|network|load failed/i.test(message)) return "无法连接服务，请检查网络后重试。";
  if (error?.status === 401) return messages.session_expired;
  if (error?.status === 429) return messages.rate_limited;
  return fallback;
}
