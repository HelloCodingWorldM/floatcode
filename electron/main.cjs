const path = require("node:path");
const fs = require("node:fs");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  Tray,
} = require("electron");

const SHORTCUTS = {
  clickThrough: "Alt+2",
  emergencyQuit: "Alt+3",
};

let mainWindow = null;
let tray = null;
let clickThrough = false;
let controlsInteractive = false;
let transparentMode = true;
let pinnedMode = true;
let contentProtected = false;
let authLocked = true;
let quitting = false;
let pendingInviteUrl = null;
let interactionMonitor = null;

const PROTOCOL = "floatcode";
const SESSION_KEY_PATTERN = /^sb-[a-z0-9]+-auth-token$/i;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function inviteUrlFromArgs(args) {
  return args.find((value) => typeof value === "string" && value.startsWith(`${PROTOCOL}://`)) || null;
}

function receiveInviteUrl(url) {
  if (!url || !url.startsWith(`${PROTOCOL}://`)) return;
  pendingInviteUrl = url.slice(0, 1024);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("invite:received", pendingInviteUrl);
    mainWindow.showInactive();
    applyPinnedMode();
  }
}

if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => receiveInviteUrl(inviteUrlFromArgs(argv)));
  app.on("open-url", (event, url) => {
    event.preventDefault();
    receiveInviteUrl(url);
  });
  receiveInviteUrl(inviteUrlFromArgs(process.argv));
} else {
  app.quit();
}

function sessionStorePath() {
  return path.join(app.getPath("userData"), "secure-sessions.json");
}

function readSessionStore() {
  try {
    return JSON.parse(fs.readFileSync(sessionStorePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeSessionStore(store) {
  const target = sessionStorePath();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function secureSessionGet(key) {
  if (!SESSION_KEY_PATTERN.test(String(key)) || !safeStorage.isEncryptionAvailable()) return null;
  const encoded = readSessionStore()[key];
  if (!encoded) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
}

function secureSessionSet(key, value) {
  if (!SESSION_KEY_PATTERN.test(String(key)) || !safeStorage.isEncryptionAvailable()) return false;
  const store = readSessionStore();
  store[key] = safeStorage.encryptString(String(value)).toString("base64");
  writeSessionStore(store);
  return true;
}

function secureSessionRemove(key) {
  if (!SESSION_KEY_PATTERN.test(String(key))) return false;
  const store = readSessionStore();
  delete store[key];
  writeSessionStore(store);
  return true;
}

function releaseWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    mainWindow.setIgnoreMouseEvents(true);
  } catch (error) {
    console.error("Unable to release mouse events:", error);
  }

  try {
    mainWindow.setAlwaysOnTop(false);
  } catch (error) {
    console.error("Unable to lower FloatCode window:", error);
  }

  try {
    mainWindow.hide();
  } catch (error) {
    console.error("Unable to hide FloatCode window:", error);
  }
}

function quitImmediately() {
  quitting = true;
  releaseWindow();
  app.exit(0);
}

function exitAfterFatalError(error) {
  console.error("FloatCode stopped after an unexpected error:", error);
  quitting = true;
  releaseWindow();
  app.exit(1);
}

process.on("uncaughtException", exitAfterFatalError);
process.on("unhandledRejection", exitAfterFatalError);

function currentState() {
  return {
    clickThrough,
    transparent: transparentMode,
    floating: pinnedMode,
    pinned: pinnedMode,
    contentProtected,
    authLocked,
    visible: Boolean(mainWindow && mainWindow.isVisible()),
    minimized: Boolean(mainWindow && mainWindow.isMinimized()),
    maximized: Boolean(mainWindow && mainWindow.isMaximized()),
    shortcuts: SHORTCUTS,
  };
}

function applyPinnedMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) {
    mainWindow.setAlwaysOnTop(false);
    return;
  }

  try {
    if (pinnedMode) {
      // pop-up-menu is stronger than the default floating level while still
      // staying below macOS system dialogs.
      mainWindow.setAlwaysOnTop(true, "pop-up-menu");
      mainWindow.moveTop();
    } else {
      mainWindow.setAlwaysOnTop(false);
    }
  } catch (error) {
    console.error("Unable to change FloatCode pin state:", error);
  }

  try {
    mainWindow.setVisibleOnAllWorkspaces(pinnedMode, {
      visibleOnFullScreen: pinnedMode,
    });
  } catch (error) {
    console.error("All-workspaces mode is unavailable:", error);
  }
}

function protectAndConfigureWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  applyPinnedMode();

  // Best-effort OS content protection. On recent macOS versions, apps using
  // ScreenCaptureKit may still capture the window despite this setting.
  try {
    mainWindow.setContentProtection(true);
    contentProtected = true;
  } catch (error) {
    contentProtected = false;
    console.error("Content protection is unavailable:", error);
  }
}

function setTransparentMode(enabled) {
  transparentMode = Boolean(enabled);
  applyPinnedMode();
  broadcastState();
  return currentState();
}

function setPinnedMode(enabled) {
  pinnedMode = Boolean(enabled);
  applyPinnedMode();
  broadcastState();
  return currentState();
}

function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("overlay:state-changed", currentState());
  }
  refreshTrayMenu();
}

function setClickThrough(enabled, focusWhenEditable = true) {
  if (!mainWindow || mainWindow.isDestroyed()) return currentState();
  if (enabled && authLocked) return currentState();

  clickThrough = Boolean(enabled);
  controlsInteractive = false;
  if (clickThrough) startInteractionMonitor();
  else stopInteractionMonitor();
  applyMouseInteraction();

  if (clickThrough) {
    mainWindow.blur();
  } else if (focusWhenEditable) {
    mainWindow.show();
    mainWindow.focus();
  }

  applyPinnedMode();
  broadcastState();
  return currentState();
}

function cursorIsInInteractiveZone() {
  if (!clickThrough || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
    return false;
  }
  const point = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  const insideHorizontally = point.x >= bounds.x && point.x < bounds.x + bounds.width;
  const localY = point.y - bounds.y;
  return insideHorizontally && localY >= 0 && localY <= bounds.height / 2;
}

function refreshInteractionFromCursor() {
  const nextInteractive = cursorIsInInteractiveZone();
  if (nextInteractive === controlsInteractive) return;
  controlsInteractive = nextInteractive;
  applyMouseInteraction();
}

function startInteractionMonitor() {
  stopInteractionMonitor();
  refreshInteractionFromCursor();
  interactionMonitor = setInterval(refreshInteractionFromCursor, 32);
}

function stopInteractionMonitor() {
  if (interactionMonitor) clearInterval(interactionMonitor);
  interactionMonitor = null;
}

function applyMouseInteraction() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const allowControls = clickThrough && controlsInteractive;
  mainWindow.setIgnoreMouseEvents(clickThrough && !allowControls, { forward: true });
  mainWindow.setFocusable(!clickThrough || allowControls);
}

function setControlsInteractive(_enabled) {
  refreshInteractionFromCursor();
  return currentState();
}

function setAuthLocked(enabled) {
  authLocked = Boolean(enabled);
  if (authLocked) return setClickThrough(false, false);
  broadcastState();
  return currentState();
}

function toggleVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return currentState();

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.showInactive();
    applyPinnedMode();
  } else if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    // Showing the overlay must not take focus away from the active app.
    mainWindow.showInactive();
    applyPinnedMode();
  }

  broadcastState();
  return currentState();
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return currentState();
  mainWindow.hide();
  broadcastState();
  return currentState();
}

function minimizeWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return currentState();
  mainWindow.setAlwaysOnTop(false);
  mainWindow.minimize();
  broadcastState();
  return currentState();
}

function toggleMaximizeWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return currentState();

  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();

  applyPinnedMode();
  broadcastState();
  return currentState();
}

function toggleClickThrough() {
  if (authLocked) return currentState();
  return setClickThrough(!clickThrough);
}

function resizeWindow(width, height) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const [minimumWidth, minimumHeight] = mainWindow.getMinimumSize();
  const bounds = mainWindow.getBounds();
  const nextWidth = Math.max(minimumWidth, Math.min(10000, Math.round(Number(width))));
  const nextHeight = Math.max(minimumHeight, Math.min(10000, Math.round(Number(height))));

  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) return bounds;
  mainWindow.setBounds({ ...bounds, width: nextWidth, height: nextHeight });
  return mainWindow.getBounds();
}

function moveWindow(x, y) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const nextX = Math.round(Number(x));
  const nextY = Math.round(Number(y));
  if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
    return mainWindow.getBounds();
  }

  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({ ...bounds, x: nextX, y: nextY });
  return mainWindow.getBounds();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 520,
    minWidth: 360,
    minHeight: 180,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: -100, y: -100 },
    hasShadow: false,
    resizable: true,
    movable: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  protectAndConfigureWindow();

  if (process.env.FLOATCODE_DEV === "1") {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.once("ready-to-show", () => {
    // FloatCode appears without interrupting whatever the user is typing in.
    mainWindow.showInactive();
    applyPinnedMode();
    broadcastState();
  });

  mainWindow.on("show", () => {
    applyPinnedMode();
    broadcastState();
  });
  mainWindow.on("blur", applyPinnedMode);
  mainWindow.on("hide", broadcastState);
  mainWindow.on("minimize", broadcastState);
  mainWindow.on("restore", broadcastState);
  mainWindow.on("maximize", broadcastState);
  mainWindow.on("unmaximize", broadcastState);
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      broadcastState();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    contentProtected = false;
  });
}

function registerShortcuts() {
  globalShortcut.register(SHORTCUTS.clickThrough, toggleClickThrough);
  globalShortcut.register(SHORTCUTS.emergencyQuit, quitImmediately);
}

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path fill="black" d="M11.6 7.2 3 16l8.6 8.8 2.8-2.8L8.5 16l5.9-6-2.8-2.8Zm8.8 0-2.8 2.8 5.9 6-5.9 6 2.8 2.8L29 16l-8.6-8.8Z"/>
    </svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const image = nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
  image.setTemplateImage(true);
  return image;
}

function refreshTrayMenu() {
  if (!tray) return;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: mainWindow?.isVisible() && !mainWindow?.isMinimized()
          ? "Hide FloatCode"
          : "Show FloatCode",
        click: toggleVisibility,
      },
      {
        label: clickThrough ? "Switch to edit mode" : "Enable mouse pass-through",
        accelerator: SHORTCUTS.clickThrough,
        click: toggleClickThrough,
      },
      {
        label: "Transparent background",
        type: "checkbox",
        checked: transparentMode,
        click: () => setTransparentMode(!transparentMode),
      },
      {
        label: "Always on top",
        type: "checkbox",
        checked: pinnedMode,
        click: () => setPinnedMode(!pinnedMode),
      },
      { type: "separator" },
      {
        label: "Quit FloatCode",
        accelerator: SHORTCUTS.emergencyQuit,
        click: quitImmediately,
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip("FloatCode");
  tray.on("click", toggleVisibility);
  refreshTrayMenu();
}

function createApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Show or Hide",
            click: toggleVisibility,
          },
          {
            label: "Toggle Mouse Pass-through",
            accelerator: SHORTCUTS.clickThrough,
            click: toggleClickThrough,
          },
          { type: "separator" },
          {
            label: "Emergency Quit",
            accelerator: SHORTCUTS.emergencyQuit,
            click: quitImmediately,
          },
        ],
      },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]),
  );
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  app.setName("FloatCode");
  app.setAsDefaultProtocolClient(PROTOCOL);
  createApplicationMenu();
  createWindow();
  createTray();
  registerShortcuts();

  app.on("activate", () => {
    if (!mainWindow) createWindow();
    else if (!mainWindow.isVisible()) toggleVisibility();
  });
});

app.on("before-quit", () => {
  quitting = true;
  stopInteractionMonitor();
  releaseWindow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep the menu-bar app alive so the global show shortcut still works.
});

ipcMain.handle("overlay:get-state", () => currentState());
ipcMain.handle("overlay:set-click-through", (_event, enabled, focusWhenEditable) =>
  setClickThrough(enabled, focusWhenEditable),
);
ipcMain.handle("overlay:set-controls-interactive", (_event, enabled) =>
  setControlsInteractive(enabled),
);
ipcMain.handle("overlay:set-transparent", (_event, enabled) =>
  setTransparentMode(enabled),
);
ipcMain.handle("overlay:set-pinned", (_event, enabled) =>
  setPinnedMode(enabled),
);
ipcMain.handle("overlay:toggle-click-through", toggleClickThrough);
ipcMain.handle("overlay:toggle-visibility", toggleVisibility);
ipcMain.handle("overlay:hide-window", hideWindow);
ipcMain.handle("overlay:minimize-window", minimizeWindow);
ipcMain.handle("overlay:toggle-maximize-window", toggleMaximizeWindow);
ipcMain.handle("overlay:set-auth-locked", (_event, enabled) => setAuthLocked(enabled));
ipcMain.handle("overlay:get-bounds", () => mainWindow?.getBounds() || null);
ipcMain.handle("overlay:resize-to", (_event, width, height) => resizeWindow(width, height));
ipcMain.handle("overlay:move-to", (_event, x, y) => moveWindow(x, y));
ipcMain.handle("invite:get-pending", () => pendingInviteUrl);
ipcMain.handle("invite:consume", () => {
  const invite = pendingInviteUrl;
  pendingInviteUrl = null;
  return invite;
});
ipcMain.handle("secure-storage:get", (_event, key) => secureSessionGet(key));
ipcMain.handle("secure-storage:set", (_event, key, value) => secureSessionSet(key, value));
ipcMain.handle("secure-storage:remove", (_event, key) => secureSessionRemove(key));
