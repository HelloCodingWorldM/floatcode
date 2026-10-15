import { createClient } from "@supabase/supabase-js";
import { userError } from "./user-error.js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

function configured() {
  return Boolean(
    supabaseUrl &&
    supabaseKey &&
    /^https:\/\//i.test(supabaseUrl) &&
    !supabaseUrl.includes("YOUR_PROJECT") &&
    !supabaseKey.includes("YOUR_PUBLISHABLE_KEY"),
  );
}

function friendlyError(error) {
  if (!navigator.onLine) return "网络似乎已断开，请检查网络连接。";
  return userError(error);
}

export async function setupAuth({ onSessionChange, showToast }) {
  const gate = document.querySelector("#auth-gate");
  const authCard = document.querySelector("#auth-card");
  const configNotice = document.querySelector("#auth-config-notice");
  const form = document.querySelector("#auth-form");
  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  const submitButton = document.querySelector("#auth-submit");
  const signInTab = document.querySelector("#auth-tab-signin");
  const signUpTab = document.querySelector("#auth-tab-signup");
  const message = document.querySelector("#auth-message");
  const accountToggle = document.querySelector("#account-toggle");
  const accountPanel = document.querySelector("#account-panel");
  const accountEmail = document.querySelector("#account-email");
  const accountInitial = document.querySelector("#account-initial");
  const closeAccount = document.querySelector("#close-account");
  const signOutButton = document.querySelector("#sign-out");

  let mode = "signin";
  let session = null;
  let supabase = null;

  const setMessage = (text, kind = "info") => {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
  };

  const setPending = (pending) => {
    submitButton.disabled = pending;
    emailInput.disabled = pending;
    passwordInput.disabled = pending;
    submitButton.textContent = pending
      ? "请稍候…"
      : mode === "signin" ? "登录" : "注册账号";
  };

  const setMode = (nextMode) => {
    mode = nextMode;
    signInTab.setAttribute("aria-selected", String(mode === "signin"));
    signUpTab.setAttribute("aria-selected", String(mode === "signup"));
    signInTab.classList.toggle("active", mode === "signin");
    signUpTab.classList.toggle("active", mode === "signup");
    submitButton.textContent = mode === "signin" ? "登录" : "注册账号";
    passwordInput.autocomplete = mode === "signin" ? "current-password" : "new-password";
    setMessage("");
  };

  const renderSession = async (nextSession) => {
    session = nextSession;
    const signedIn = Boolean(session?.user);
    gate.hidden = signedIn;
    accountToggle.hidden = !signedIn;
    accountPanel.classList.remove("open");

    if (signedIn) {
      const email = session.user.is_anonymous ? "访客会话" : session.user.email || "账号";
      accountEmail.textContent = email;
      accountInitial.textContent = session.user.is_anonymous
        ? "访"
        : email.charAt(0).toUpperCase();
    }

    await onSessionChange(session);
  };

  if (!configured()) {
    authCard.classList.add("needs-config");
    configNotice.hidden = false;
    form.hidden = true;
    gate.hidden = false;
    accountToggle.hidden = true;
    await onSessionChange(null, { configured: false });
    return {
      getSession: () => null,
      configured: false,
      ensureAnonymousSession: async () => {
        throw new Error("账号服务尚未配置，请联系应用维护者。");
      },
    };
  }

  const secureStorage = window.floatCode?.secureStorage;
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(secureStorage ? { storage: secureStorage } : {}),
    },
  });

  signInTab.addEventListener("click", () => setMode("signin"));
  signUpTab.addEventListener("click", () => setMode("signup"));

  for (const input of [emailInput, passwordInput]) {
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("invalid", () => {
      input.setCustomValidity(input === emailInput
        ? "请输入有效的邮箱地址。"
        : "请输入至少 6 个字符的密码。");
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    setPending(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) {
          await renderSession(data.session);
          showToast("账号已创建");
        } else {
          setMessage("请前往邮箱确认注册，然后返回这里登录。", "success");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await renderSession(data.session);
        showToast("已登录");
      }
    } catch (error) {
      setMessage(friendlyError(error), "error");
    } finally {
      setPending(false);
    }
  });

  accountToggle.addEventListener("click", () => accountPanel.classList.toggle("open"));
  closeAccount.addEventListener("click", () => accountPanel.classList.remove("open"));
  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    const { error } = await supabase.auth.signOut();
    signOutButton.disabled = false;
    if (error) {
      showToast(friendlyError(error), 2600);
      return;
    }
    await renderSession(null);
    showToast("已退出登录");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") accountPanel.classList.remove("open");
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) setMessage(friendlyError(error), "error");
  await renderSession(data?.session || null);

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    if (nextSession?.access_token === session?.access_token) return;
    void renderSession(nextSession);
  });

  return {
    configured: true,
    getSession: () => session,
    ensureAnonymousSession: async () => {
      if (session?.user) return session;
      const { data, error: anonymousError } = await supabase.auth.signInAnonymously();
      if (anonymousError) throw anonymousError;
      await renderSession(data.session);
      return data.session;
    },
  };
}
