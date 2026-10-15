import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { setupAuth } from "./auth.js";
import { userError } from "./user-error.js";
import {
  createDocument,
  createInvite,
  getDocumentAccess,
  inviteLink,
  productionCollaborationConfigured,
  redeemInvite,
  revokeInvite,
} from "./collab-api.js";
import "./styles.css";

const STORAGE = {
  code: "floatcode.code",
  color: "floatcode.user-color",
  fontSize: "floatcode.font-size",
  transparent: "floatcode.transparent",
  pinned: "floatcode.pinned",
  language: "floatcode.language",
  name: "floatcode.display-name",
  room: "floatcode.room",
  server: "floatcode.server",
  documentId: "floatcode.document-id",
  preCollabBackup: "floatcode.pre-collab-backup",
};

const languageExtensions = {
  python: python(),
  javascript: javascript({ jsx: true, typescript: true }),
  java: java(),
  cpp: cpp(),
};

const colors = [
  ["#30bced", "#30bced33"],
  ["#6eeb83", "#6eeb8333"],
  ["#ffbc42", "#ffbc4233"],
  ["#ee6352", "#ee635233"],
  ["#9ac2c9", "#9ac2c933"],
  ["#c792ea", "#c792ea33"],
];

const starterCode = `def two_sum(nums, target):
    seen = {}
    for index, value in enumerate(nums):
        complement = target - value
        if complement in seen:
            return [seen[complement], index]
        seen[value] = index
    return []`;

const shell = document.querySelector("#shell");
const editorHost = document.querySelector("#editor");
const titlebar = document.querySelector("#titlebar");
const windowCloseButton = document.querySelector("#window-close");
const windowMinimizeButton = document.querySelector("#window-minimize");
const windowMaximizeButton = document.querySelector("#window-maximize");
const resizeHandle = document.querySelector("#resize-handle");
const languageSelect = document.querySelector("#language");
const fontDecreaseButton = document.querySelector("#font-decrease");
const fontIncreaseButton = document.querySelector("#font-increase");
const fontSizeValue = document.querySelector("#font-size-value");
const backgroundModeButton = document.querySelector("#background-mode");
const pinnedModeButton = document.querySelector("#pinned-mode");
const passThroughButton = document.querySelector("#pass-through");
const hideButton = document.querySelector("#hide-window");
const toast = document.querySelector("#toast");
const collabToggle = document.querySelector("#collab-toggle");
const collabPanel = document.querySelector("#collab-panel");
const accountPanel = document.querySelector("#account-panel");
const closeCollabButton = document.querySelector("#close-collab");
const connectButton = document.querySelector("#connect-collab");
const copyInviteButton = document.querySelector("#copy-invite");
const revokeInviteButton = document.querySelector("#revoke-invite");
const restoreDraftButton = document.querySelector("#restore-draft");
const serverInput = document.querySelector("#server-url");
const roomInput = document.querySelector("#room-name");
const documentTitleInput = document.querySelector("#document-title");
const displayNameInput = document.querySelector("#display-name");
const connectionStatus = document.querySelector("#connection-status");
const connectionDot = document.querySelector("#connection-dot");
const peerCount = document.querySelector("#peer-count");

const savedLanguage = localStorage.getItem(STORAGE.language);
let currentLanguage = languageExtensions[savedLanguage] ? savedLanguage : "python";
const storedFontSize = localStorage.getItem(STORAGE.fontSize);
const parsedFontSize = Number(storedFontSize);
let fontSize = storedFontSize !== null && Number.isFinite(parsedFontSize)
  ? Math.min(36, Math.max(11, Math.round(parsedFontSize)))
  : 17;
let saveTimer = null;
let toastTimer = null;
let pointerOnControls = false;
let controlsInteractive = false;
let overlayState = {
  clickThrough: false,
  transparent: localStorage.getItem(STORAGE.transparent) !== "false",
  pinned: localStorage.getItem(STORAGE.pinned) !== "false",
  visible: true,
};
let authSession = null;
let authController = null;
let ydoc = null;
let provider = null;
let bindingActive = false;
let activeDocumentId = localStorage.getItem(STORAGE.documentId) || null;
let activeDocumentRole = null;
let activeInviteLink = null;
let activeInviteId = null;
let accessRefreshTimer = null;
let joiningInvite = false;

function randomToken() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0].toString(36).slice(0, 6);
}

function loadUserColor() {
  const stored = Number(localStorage.getItem(STORAGE.color));
  const index = Number.isInteger(stored) && stored >= 0
    ? stored % colors.length
    : crypto.getRandomValues(new Uint32Array(1))[0] % colors.length;
  localStorage.setItem(STORAGE.color, String(index));
  return colors[index];
}

const [userColor, userColorLight] = loadUserColor();
languageSelect.value = currentLanguage;
serverInput.value = localStorage.getItem(STORAGE.server) || "ws://localhost:1234";
roomInput.value = localStorage.getItem(STORAGE.room) || `float-${randomToken()}`;
displayNameInput.value = localStorage.getItem(STORAGE.name) || `访客 ${randomToken().slice(0, 3)}`;
restoreDraftButton.hidden = !localStorage.getItem(STORAGE.preCollabBackup);
document.querySelectorAll(".production-collab").forEach((element) => {
  element.hidden = !productionCollaborationConfigured;
});
document.querySelectorAll(".legacy-collab").forEach((element) => {
  element.hidden = productionCollaborationConfigured;
});
copyInviteButton.hidden = productionCollaborationConfigured;
connectButton.textContent = productionCollaborationConfigured
  ? (activeDocumentId ? "重新连接" : "创建协作")
  : "连接";

const languageCompartment = new Compartment();
const fontCompartment = new Compartment();
const highlightCompartment = new Compartment();
const collaborationCompartment = new Compartment();

function fontTheme(size, transparent = overlayState.transparent) {
  // Preserve the original bright syntax palette over dark desktop surfaces.
  // Background mode changes contrast, never adds text shadows.
  const light = !transparent;

  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${size}px`,
      color: light ? "#111827" : "#e5e7eb",
      backgroundColor: transparent ? "transparent" : "#ffffff",
    },
    ".cm-scroller": {
      overflow: "auto",
      backgroundColor: transparent ? "transparent" : "#ffffff",
      fontFamily:
        '\"SFMono-Regular\", \"SF Mono\", Menlo, Monaco, Consolas, monospace',
      lineHeight: "1.58",
    },
    ".cm-content": {
      padding: "56px 24px 28px",
      caretColor: light ? "#111827" : "#ffffff",
      textShadow: "none",
    },
    ".cm-line": { padding: "0 3px" },
    ".cm-gutters": {
      border: "none",
      color: light ? "#64748b" : "#cbd5e1",
      backgroundColor: "transparent",
      textShadow: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "34px",
      padding: "0 8px 0 10px",
      fontSize: "0.78em",
      textAlign: "right",
    },
    ".cm-activeLineGutter": {
      color: light ? "#2563eb" : "#bae6fd",
      backgroundColor: light ? "rgba(37, 99, 235, .08)" : "rgba(125, 211, 252, .08)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: light ? "#111827" : "#ffffff",
      borderLeftWidth: "2px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      background: light ? "rgba(59, 130, 246, .22)" : "rgba(88, 166, 255, .36)",
    },
    ".cm-activeLine": {
      background: light ? "rgba(15, 23, 42, .045)" : "rgba(255,255,255,.045)",
    },
    ".cm-panels, .cm-tooltip": {
      color: "#111827",
      background: "rgba(255, 255, 255, .97)",
      border: "1px solid rgba(15, 23, 42, .16)",
    },
    ".cm-ySelectionInfo": {
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      textShadow: "none",
    },
  }, { dark: transparent });
}

function highlightTheme(transparent = overlayState.transparent) {
  return syntaxHighlighting(transparent ? oneDarkHighlightStyle : defaultHighlightStyle);
}

function scheduleSave(code) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(STORAGE.code, code), 180);
}

function showToast(message, duration = 1800) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), duration);
}

function setFontSize(nextSize) {
  const parsedSize = Number(nextSize);
  if (!Number.isFinite(parsedSize)) return;
  fontSize = Math.min(36, Math.max(11, Math.round(parsedSize)));
  localStorage.setItem(STORAGE.fontSize, String(fontSize));
  fontSizeValue.textContent = String(fontSize);
  fontDecreaseButton.disabled = fontSize <= 11;
  fontIncreaseButton.disabled = fontSize >= 36;
  editor.dispatch({
    effects: fontCompartment.reconfigure(fontTheme(fontSize, overlayState.transparent)),
  });
  showToast(`字号 ${fontSize}px`);
}

const editor = new EditorView({
  parent: editorHost,
  state: EditorState.create({
    doc: localStorage.getItem(STORAGE.code) || starterCode,
    extensions: [
      highlightSpecialChars(),
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      bracketMatching(),
      indentOnInput(),
      highlightActiveLine(),
      languageCompartment.of(languageExtensions[currentLanguage]),
      fontCompartment.of(fontTheme(fontSize, overlayState.transparent)),
      highlightCompartment.of(highlightTheme(overlayState.transparent)),
      collaborationCompartment.of([]),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) scheduleSave(update.state.doc.toString());
      }),
    ],
  }),
});

fontSizeValue.textContent = String(fontSize);
fontDecreaseButton.disabled = fontSize <= 11;
fontIncreaseButton.disabled = fontSize >= 36;

function updatePeerCount() {
  const count = provider ? provider.awareness.getStates().size : 1;
  peerCount.textContent = String(Math.max(1, count));
}

function setConnectionStatus(status) {
  shell.dataset.connection = status;
  connectionDot.dataset.status = status;
  const labels = {
    offline: "未连接",
    connecting: "正在连接…",
    connected: "已连接",
    disconnected: "正在重连…",
  };
  connectionStatus.textContent = labels[status] || status;
}

function activateSharedDocument() {
  if (!ydoc || !provider || bindingActive) return;

  const ytext = ydoc.getText("code");
  const localCode = editor.state.doc.toString();

  if (ytext.length === 0 && localCode) {
    ydoc.transact(() => ytext.insert(0, localCode), "initial-content");
  }

  const sharedCode = ytext.toString();
  if (sharedCode && sharedCode !== localCode) {
    localStorage.setItem(STORAGE.preCollabBackup, localCode);
    restoreDraftButton.hidden = false;
  }
  const undoManager = new Y.UndoManager(ytext);
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: sharedCode },
    effects: collaborationCompartment.reconfigure(
      yCollab(ytext, provider.awareness, { undoManager }),
    ),
  });
  bindingActive = true;
  updatePeerCount();
  showToast(productionCollaborationConfigured ? "已加入共享文档" : `已加入 ${roomInput.value}`);
}

function disconnectCollaboration({ announce = true } = {}) {
  if (!provider && !ydoc) return;

  editor.dispatch({ effects: collaborationCompartment.reconfigure([]) });
  bindingActive = false;
  provider?.destroy();
  ydoc?.destroy();
  clearTimeout(accessRefreshTimer);
  accessRefreshTimer = null;
  provider = null;
  ydoc = null;
  connectButton.textContent = productionCollaborationConfigured
    ? (activeDocumentId ? "重新连接" : "创建协作")
    : "连接";
  serverInput.disabled = false;
  roomInput.disabled = false;
  documentTitleInput.disabled = false;
  displayNameInput.disabled = false;
  updatePeerCount();
  setConnectionStatus("offline");
  if (announce) showToast("已断开协作连接");
}

function normalizedServerUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^wss?:\/\//i.test(trimmed)) {
    throw new Error("服务器地址必须以 ws:// 或 wss:// 开头");
  }
  return trimmed;
}

function normalizedRoom(value) {
  const room = value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  if (!room) throw new Error("请输入房间名称");
  return room;
}

function connectLegacyCollaboration() {
  if (!authSession) {
    showToast("请先登录，再加入协作", 2400);
    return;
  }

  if (provider) {
    disconnectCollaboration();
    return;
  }

  try {
    const server = normalizedServerUrl(serverInput.value);
    const room = normalizedRoom(roomInput.value);
    const displayName = displayNameInput.value.trim().slice(0, 32) || "访客";

    serverInput.value = server;
    roomInput.value = room;
    displayNameInput.value = displayName;
    localStorage.setItem(STORAGE.server, server);
    localStorage.setItem(STORAGE.room, room);
    localStorage.setItem(STORAGE.name, displayName);

    ydoc = new Y.Doc();
    provider = new WebsocketProvider(server, room, ydoc);
    provider.awareness.setLocalStateField("user", {
      name: displayName,
      color: userColor,
      colorLight: userColorLight,
    });

    provider.on("status", ({ status }) => {
      setConnectionStatus(status === "connected" ? "connected" : status);
    });
    provider.on("sync", (synced) => {
      if (synced) activateSharedDocument();
    });
    provider.awareness.on("change", updatePeerCount);

    connectButton.textContent = "断开连接";
    serverInput.disabled = true;
    roomInput.disabled = true;
    displayNameInput.disabled = true;
    setConnectionStatus("connecting");
  } catch (error) {
    setConnectionStatus("offline");
    showToast(userError(error), 2600);
  }
}

function scheduleAccessRefresh(expiresIn = 300) {
  clearTimeout(accessRefreshTimer);
  const delay = Math.max(30, Number(expiresIn) - 45) * 1000;
  accessRefreshTimer = setTimeout(async () => {
    if (!provider || !activeDocumentId || !authSession?.access_token) return;
    try {
      const access = await getDocumentAccess(authSession.access_token, activeDocumentId);
      provider.params.access_token = access.websocketToken;
      scheduleAccessRefresh(access.expiresIn);
    } catch (error) {
      showToast(userError(error, "无法刷新协作权限，请重新连接"), 3000);
    }
  }, delay);
}

function connectWithAccess(access) {
  disconnectCollaboration({ announce: false });
  const displayName = displayNameInput.value.trim().slice(0, 32) || "访客";
  displayNameInput.value = displayName;
  localStorage.setItem(STORAGE.name, displayName);

  activeDocumentId = access.documentId;
  activeDocumentRole = access.role;
  localStorage.setItem(STORAGE.documentId, activeDocumentId);
  activeInviteLink = null;
  activeInviteId = null;

  ydoc = new Y.Doc();
  provider = new WebsocketProvider(access.websocketUrl, access.documentId, ydoc, {
    params: { access_token: access.websocketToken },
  });
  provider.awareness.setLocalStateField("user", {
    name: displayName,
    color: userColor,
    colorLight: userColorLight,
  });
  provider.on("status", ({ status }) => {
    setConnectionStatus(status === "connected" ? "connected" : status);
  });
  provider.on("connection-error", () => setConnectionStatus("disconnected"));
  provider.on("sync", (synced) => {
    if (synced) activateSharedDocument();
  });
  provider.awareness.on("change", updatePeerCount);

  connectButton.textContent = "断开连接";
  documentTitleInput.disabled = true;
  displayNameInput.disabled = true;
  copyInviteButton.hidden = access.role !== "owner";
  setConnectionStatus("connecting");
  scheduleAccessRefresh(access.expiresIn);
}

async function connectProductionCollaboration() {
  if (!authSession) {
    showToast("请先登录，再创建协作", 2400);
    return;
  }
  if (provider) {
    disconnectCollaboration();
    return;
  }

  connectButton.disabled = true;
  try {
    const access = activeDocumentId
      ? await getDocumentAccess(authSession.access_token, activeDocumentId)
      : await createDocument(
        authSession.access_token,
        documentTitleInput.value.trim().slice(0, 80) || "未命名代码",
      );
    connectWithAccess(access);
  } catch (error) {
    if (activeDocumentId) {
      activeDocumentId = null;
      activeDocumentRole = null;
      localStorage.removeItem(STORAGE.documentId);
      connectButton.textContent = "创建协作";
    }
    showToast(userError(error), 3200);
  } finally {
    connectButton.disabled = false;
  }
}

function connectCollaboration() {
  if (productionCollaborationConfigured) {
    void connectProductionCollaboration();
  } else {
    connectLegacyCollaboration();
  }
}

function invitationToken(urlValue) {
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "floatcode:") return null;
    const token = url.searchParams.get("token");
    return token && /^[A-Za-z0-9_-]{40,128}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

async function joinFromInvitation(urlValue) {
  if (!productionCollaborationConfigured || joiningInvite || !authController) return;
  const token = invitationToken(urlValue);
  if (!token) {
    showToast("此 FloatCode 邀请链接无效", 3200);
    return;
  }

  joiningInvite = true;
  showToast("正在打开共享文档…", 4000);
  try {
    const session = authController.getSession() || await authController.ensureAnonymousSession();
    const access = await redeemInvite(session.access_token, token);
    connectWithAccess(access);
    collabPanel.classList.add("open");
    await window.floatCode.consumeInvite();
  } catch (error) {
    showToast(userError(error, "无法打开此邀请链接"), 4200);
  } finally {
    joiningInvite = false;
  }
}

languageSelect.addEventListener("change", () => {
  currentLanguage = languageSelect.value;
  localStorage.setItem(STORAGE.language, currentLanguage);
  editor.dispatch({
    effects: languageCompartment.reconfigure(languageExtensions[currentLanguage]),
  });
  if (!overlayState.clickThrough) editor.focus();
  showToast(languageSelect.options[languageSelect.selectedIndex].text);
});

fontDecreaseButton.addEventListener("click", () => setFontSize(fontSize - 1));
fontIncreaseButton.addEventListener("click", () => setFontSize(fontSize + 1));
fontSizeValue.addEventListener("click", () => setFontSize(17));

backgroundModeButton.addEventListener("click", async () => {
  const nextTransparent = !overlayState.transparent;
  const state = await window.floatCode.setTransparent(nextTransparent);
  applyOverlayState(state);
  showToast(
    nextTransparent
      ? "透明背景"
      : "白色背景",
    2600,
  );
});

pinnedModeButton.addEventListener("click", async () => {
  const nextPinned = !overlayState.pinned;
  const state = await window.floatCode.setPinned(nextPinned);
  applyOverlayState(state);
  showToast(nextPinned ? "已开启窗口置顶" : "已取消窗口置顶", 2600);
});

collabToggle.addEventListener("click", () => {
  collabPanel.classList.toggle("open");
});
closeCollabButton.addEventListener("click", () => collabPanel.classList.remove("open"));
connectButton.addEventListener("click", connectCollaboration);

copyInviteButton.addEventListener("click", async () => {
  try {
    if (productionCollaborationConfigured) {
      if (!provider || !activeDocumentId || activeDocumentRole !== "owner") {
        throw new Error("请先创建协作，再复制邀请链接。");
      }
      if (!activeInviteLink) {
        const invitation = await createInvite(authSession.access_token, activeDocumentId, {
          expiresInHours: 24,
          maxUses: 25,
        });
        activeInviteLink = inviteLink(invitation.token);
        activeInviteId = invitation.inviteId;
        revokeInviteButton.hidden = false;
      }
      await navigator.clipboard.writeText(activeInviteLink);
      showToast("邀请链接已复制 · 24 小时内有效", 3000);
    } else {
      const details = `FloatCode 服务器：${normalizedServerUrl(serverInput.value)}\n房间：${normalizedRoom(roomInput.value)}`;
      await navigator.clipboard.writeText(details);
      showToast("连接信息已复制");
    }
  } catch (error) {
    showToast(userError(error, "复制失败，请重试"), 2600);
  }
});

revokeInviteButton.addEventListener("click", async () => {
  if (!activeInviteId || !authSession?.access_token) return;
  revokeInviteButton.disabled = true;
  try {
    await revokeInvite(authSession.access_token, activeInviteId);
    activeInviteId = null;
    activeInviteLink = null;
    revokeInviteButton.hidden = true;
    showToast("邀请链接已撤销");
  } catch (error) {
    showToast(userError(error, "无法撤销邀请链接"), 3000);
  } finally {
    revokeInviteButton.disabled = false;
  }
});

restoreDraftButton.addEventListener("click", () => {
  const backup = localStorage.getItem(STORAGE.preCollabBackup);
  if (!backup) return;
  disconnectCollaboration({ announce: false });
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: backup },
  });
  localStorage.removeItem(STORAGE.preCollabBackup);
  restoreDraftButton.hidden = true;
  showToast("已恢复本地草稿");
});

passThroughButton.addEventListener("click", async () => {
  collabPanel.classList.remove("open");
  accountPanel.classList.remove("open");
  const nextClickThrough = !overlayState.clickThrough;
  const state = await window.floatCode.setClickThrough(nextClickThrough);
  applyOverlayState(state);
  showToast(
    nextClickThrough
      ? "代码区域已开启鼠标穿透 · 顶部按钮仍可点击"
      : "可编辑和滚动代码",
    3200,
  );
});

function bindWindowControl(button, action) {
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void action().catch((error) => {
      console.error("Window control failed:", error);
      showToast("窗口操作失败，请重试。", 3000);
    });
  });
}

bindWindowControl(hideButton, () => window.floatCode.hideWindow());
bindWindowControl(windowCloseButton, () => window.floatCode.hideWindow());
bindWindowControl(windowMinimizeButton, () => window.floatCode.minimizeWindow());
bindWindowControl(windowMaximizeButton, () => window.floatCode.toggleMaximizeWindow());

titlebar.addEventListener("pointerdown", async (event) => {
  if (event.button !== 0) return;
  if (event.target.closest("button, select, input, a")) return;

  event.preventDefault();
  titlebar.setPointerCapture(event.pointerId);

  const startBounds = await window.floatCode.getBounds();
  if (!startBounds) {
    titlebar.releasePointerCapture(event.pointerId);
    return;
  }

  const startX = event.screenX;
  const startY = event.screenY;
  let pendingPosition = null;
  let moveFrame = null;

  const flushMove = () => {
    moveFrame = null;
    if (!pendingPosition) return;
    const { x, y } = pendingPosition;
    pendingPosition = null;
    void window.floatCode.moveTo(x, y);
  };

  const onPointerMove = (moveEvent) => {
    pendingPosition = {
      x: startBounds.x + moveEvent.screenX - startX,
      y: startBounds.y + moveEvent.screenY - startY,
    };
    if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
  };

  const finishMove = () => {
    titlebar.removeEventListener("pointermove", onPointerMove);
    titlebar.removeEventListener("pointerup", finishMove);
    titlebar.removeEventListener("pointercancel", finishMove);
    if (moveFrame) cancelAnimationFrame(moveFrame);
    flushMove();
  };

  titlebar.addEventListener("pointermove", onPointerMove);
  titlebar.addEventListener("pointerup", finishMove, { once: true });
  titlebar.addEventListener("pointercancel", finishMove, { once: true });
});

resizeHandle.addEventListener("pointerdown", async (event) => {
  event.preventDefault();
  const startBounds = await window.floatCode.getBounds();
  if (!startBounds) return;

  const startX = event.screenX;
  const startY = event.screenY;
  let pendingSize = null;
  let resizeFrame = null;

  resizeHandle.setPointerCapture(event.pointerId);

  const flushResize = () => {
    resizeFrame = null;
    if (!pendingSize) return;
    const { width, height } = pendingSize;
    pendingSize = null;
    void window.floatCode.resizeTo(width, height);
  };

  const onPointerMove = (moveEvent) => {
    pendingSize = {
      width: startBounds.width + moveEvent.screenX - startX,
      height: startBounds.height + moveEvent.screenY - startY,
    };
    if (!resizeFrame) resizeFrame = requestAnimationFrame(flushResize);
  };

  const finishResize = () => {
    resizeHandle.removeEventListener("pointermove", onPointerMove);
    resizeHandle.removeEventListener("pointerup", finishResize);
    resizeHandle.removeEventListener("pointercancel", finishResize);
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    flushResize();
  };

  resizeHandle.addEventListener("pointermove", onPointerMove);
  resizeHandle.addEventListener("pointerup", finishResize, { once: true });
  resizeHandle.addEventListener("pointercancel", finishResize, { once: true });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") collabPanel.classList.remove("open");
  if (!event.metaKey) return;

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    setFontSize(fontSize + 1);
  } else if (event.key === "-") {
    event.preventDefault();
    setFontSize(fontSize - 1);
  } else if (event.key === "0") {
    event.preventDefault();
    setFontSize(17);
  }
});

function isOverlayControl(target) {
  return target instanceof Element && Boolean(target.closest(
    "#titlebar, #resize-handle, .hover-tools, .collab-panel.open, .account-panel.open",
  ));
}

function isUpperScrollZone(event) {
  return event.clientY >= 44 && event.clientY <= window.innerHeight / 2;
}

function syncControlsInteraction() {
  const nextInteractive = overlayState.clickThrough && pointerOnControls;
  if (nextInteractive === controlsInteractive) return;

  controlsInteractive = nextInteractive;
  void window.floatCode.setControlsInteractive(nextInteractive);
}

document.addEventListener("mousemove", (event) => {
  pointerOnControls = isOverlayControl(event.target) || isUpperScrollZone(event);
  syncControlsInteraction();
}, true);

document.documentElement.addEventListener("mouseleave", () => {
  pointerOnControls = false;
  syncControlsInteraction();
});

function applyOverlayState(state) {
  const transparent = state.transparent ?? true;
  const pinned = state.pinned ?? state.floating ?? true;
  overlayState = { ...state, transparent, pinned };
  localStorage.setItem(STORAGE.transparent, String(transparent));
  localStorage.setItem(STORAGE.pinned, String(pinned));
  shell.classList.toggle("click-through", state.clickThrough);
  shell.classList.toggle("editing", !state.clickThrough);
  shell.classList.toggle("pinned", pinned);
  shell.classList.toggle("normal-window", !transparent);
  backgroundModeButton.textContent = transparent ? "透明" : "白底";
  backgroundModeButton.setAttribute("aria-pressed", String(transparent));
  backgroundModeButton.title = transparent
    ? "当前为透明背景，点击切换为白色背景"
    : "当前为白色背景，点击切换为透明背景";
  pinnedModeButton.textContent = pinned ? "置顶" : "未置顶";
  pinnedModeButton.setAttribute("aria-pressed", String(pinned));
  pinnedModeButton.title = pinned
    ? "已开启置顶，点击取消"
    : "已取消置顶，点击让窗口始终显示在最上方";
  passThroughButton.textContent = state.clickThrough ? "编辑模式" : "鼠标穿透";
  passThroughButton.setAttribute("aria-pressed", String(state.clickThrough));
  passThroughButton.title = state.clickThrough
    ? "恢复代码编辑和滚动（⌥2）"
    : "让代码区域的鼠标点击穿透到下方应用（⌥2）";
  windowMaximizeButton.title = state.maximized
    ? "恢复 FloatCode 原来的窗口大小"
    : "最大化 FloatCode";
  windowMaximizeButton.setAttribute(
    "aria-label",
    state.maximized ? "还原 FloatCode" : "最大化 FloatCode",
  );
  syncControlsInteraction();
  editor.dispatch({
    effects: [
      fontCompartment.reconfigure(fontTheme(fontSize, transparent)),
      highlightCompartment.reconfigure(highlightTheme(transparent)),
    ],
  });
}

setConnectionStatus("offline");
updatePeerCount();
window.floatCode.onStateChanged(applyOverlayState);

async function initialize() {
  let state = await window.floatCode.getState();
  const savedPinned = localStorage.getItem(STORAGE.pinned);
  if (savedPinned !== null) {
    state = await window.floatCode.setPinned(savedPinned !== "false");
  }
  const savedTransparent = localStorage.getItem(STORAGE.transparent);
  if (savedTransparent !== null) {
    state = await window.floatCode.setTransparent(savedTransparent !== "false");
  }
  applyOverlayState(state);

  authController = await setupAuth({
    showToast,
    onSessionChange: async (session) => {
      authSession = session;
      await window.floatCode.setAuthLocked(!session);

      if (!session) {
        disconnectCollaboration({ announce: false });
        activeDocumentId = null;
        activeDocumentRole = null;
        activeInviteLink = null;
        activeInviteId = null;
        revokeInviteButton.hidden = true;
        localStorage.removeItem(STORAGE.documentId);
        await window.floatCode.setClickThrough(false, false);
        return;
      }

      if (!session.user.is_anonymous && /^(Guest |访客 )/.test(displayNameInput.value)) {
        displayNameInput.value = session.user.email?.split("@")[0] || displayNameInput.value;
      }

      // Keep mouse interaction available for immediate scrolling and editing.
      // The window itself was shown inactive, so launch still does not steal focus.
      await window.floatCode.setClickThrough(false, false);
      showToast("可编辑和滚动代码 · ⌥2 切换鼠标穿透", 3400);
    },
  });

  const pendingInvite = await window.floatCode.getPendingInvite();
  if (pendingInvite) await joinFromInvitation(pendingInvite);
}

window.floatCode.onInviteReceived((url) => void joinFromInvitation(url));
void initialize();

window.addEventListener("beforeunload", () => disconnectCollaboration({ announce: false }));
