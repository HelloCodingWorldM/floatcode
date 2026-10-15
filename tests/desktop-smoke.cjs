// Exercise real Electron windows and the shipped sandboxed preload on CI.
// This file is excluded from the desktop package.
const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, globalShortcut, nativeImage, screen, safeStorage } = require("electron");
app.setPath("userData", process.env.FLOATCODE_TEST_USER_DATA);
// Do not register the test harness as the user's default protocol handler.
const registrations = [];
app.setAsDefaultProtocolClient = (...args) => { registrations.push(args); return true; };
require("../electron/main.cjs");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win, "Main window created");
    const rendererErrors = [];
    win.webContents.on("console-message", (_event, level, message) => {
      if (level >= 3) rendererErrors.push(message);
    });
    if (win.webContents.isLoadingMainFrame()) {
      await new Promise((resolve, reject) => {
        win.webContents.once("did-finish-load", resolve);
        win.webContents.once("did-fail-load", (_event, code, text) => reject(new Error(`${code}: ${text}`)));
      });
    }
    const js = (source) => win.webContents.executeJavaScript(source);
    for (let i = 0; i < 100; i++) {
      if (await js('Boolean(document.querySelector(".cm-editor"))')) break;
      await delay(100);
    }
    assert.equal(await js('Boolean(document.querySelector(".cm-editor"))'), true, "Editor rendered");
    assert.equal(await js('typeof window.require'), "undefined", "Node is isolated from renderer");
    const state = () => js("window.floatCode.getState()");
    assert.equal((await state()).platform, process.platform);
    assert.equal((await state()).authLocked, true);
    assert.equal(win.isFocused(), false, "Startup does not take keyboard focus");
    assert.ok(registrations.length, "Protocol registration attempted");
    for (const shortcut of Object.values((await state()).shortcuts)) {
      assert.ok(globalShortcut.isRegistered(shortcut), `Registered ${shortcut}`);
    }
    const asset = process.platform === "darwin" ? "trayTemplate.png" : "icon.ico";
    assert.equal(nativeImage.createFromPath(path.join(__dirname, "../electron/assets", asset)).isEmpty(), false);

    // Guest/account behavior is unchanged; unlock only this isolated test session.
    await js("window.floatCode.setClickThrough(true, false)");
    assert.equal((await state()).clickThrough, false, "Auth gate blocks pass-through");
    await js("window.floatCode.setAuthLocked(false)");
    await js("window.floatCode.setClickThrough(true, false)");
    assert.equal((await state()).clickThrough, true);
    await js("window.floatCode.setClickThrough(false, false)");
    assert.equal(win.isFocusable(), true);
    await js("window.floatCode.setPinned(false)");
    assert.equal(win.isAlwaysOnTop(), false);
    await js("window.floatCode.setPinned(true)");
    assert.equal(win.isAlwaysOnTop(), true);
    await js("window.floatCode.setTransparent(false)");
    assert.equal(await js('document.querySelector("#shell").classList.contains("normal-window")'), true);
    await js("window.floatCode.setTransparent(true)");

    const initial = win.getBounds();
    await js("window.floatCode.resizeTo(660, 420)");
    assert.equal(win.getBounds().width, 660);
    assert.equal(win.getBounds().height, 420);
    await js("window.floatCode.resizeTo(NaN, Infinity)");
    assert.equal(win.getBounds().width, 660, "Invalid size leaves bounds unchanged");
    if (process.platform === "win32") {
      const beforeMax = win.getBounds();
      await js("window.floatCode.toggleMaximizeWindow()");
      assert.equal((await state()).maximized, true);
      assert.deepEqual(win.getBounds(), screen.getDisplayMatching(beforeMax).workArea);
      await js("window.floatCode.toggleMaximizeWindow()");
      assert.equal((await state()).maximized, false);
      assert.deepEqual(win.getBounds(), beforeMax);
      const beforeFont = await js('Number(document.querySelector("#font-size-value").textContent)');
      await js('document.dispatchEvent(new KeyboardEvent("keydown", {key: "+", ctrlKey: true}))');
      assert.equal(await js('Number(document.querySelector("#font-size-value").textContent)'), beforeFont + 1);
      assert.ok((await js('document.querySelector("#pass-through").title')).includes("Alt+2"));
    }
    win.setBounds(initial);
    await js("window.floatCode.hideWindow()");
    assert.equal(win.isVisible(), false);
    app.emit("second-instance", {}, [process.execPath]);
    assert.equal(win.isVisible(), true, "Launching again restores hidden window");
    await js("window.floatCode.toggleVisibility()");
    assert.equal(win.isVisible(), false);
    await js("window.floatCode.toggleVisibility()");
    assert.equal(win.isVisible(), true);
    if (safeStorage.isEncryptionAvailable()) {
      await js('window.floatCode.secureStorage.setItem("sb-test-auth-token", "smoke-session")');
      assert.equal(await js('window.floatCode.secureStorage.getItem("sb-test-auth-token")'), "smoke-session");
      await js('window.floatCode.secureStorage.removeItem("sb-test-auth-token")');
      assert.equal(await js('window.floatCode.secureStorage.getItem("sb-test-auth-token")'), null);
    }
    assert.deepEqual(rendererErrors, [], "No renderer errors");
    console.log(`PASS: FloatCode native desktop checks (${process.platform}/${process.arch})`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
