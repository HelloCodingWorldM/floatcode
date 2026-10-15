// Real Electron renderer + IPC tests, using an isolated profile and no accounts.
const assert = require('node:assert/strict');
const { app, BrowserWindow, globalShortcut } = require('electron');
app.setPath('userData', process.env.FLOATCODE_TEST_USER_DATA);
app.setAsDefaultProtocolClient = () => true;
let workspaceChanges = 0;
const originalWorkspaces = BrowserWindow.prototype.setVisibleOnAllWorkspaces;
BrowserWindow.prototype.setVisibleOnAllWorkspaces = function (...args) {
  workspaceChanges++;
  return originalWorkspaces.apply(this, args);
};
require('../electron/main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    assert.ok(win);
    const js = source => win.webContents.executeJavaScript(source);
    for (let i = 0; i < 100; i++) {
      if (!win.webContents.isLoadingMainFrame() && await js('Boolean(document.querySelector(".cm-content"))')) break;
      await delay(100);
    }
    await delay(500);
    assert.ok(await js('Boolean(document.querySelector(".cm-content"))'));
    assert.equal(await js('typeof window.require'), 'undefined');
    const initialWorkspaces = workspaceChanges;
    win.emit('blur'); win.emit('blur');
    await delay(100);
    assert.equal(workspaceChanges, initialWorkspaces, 'Blur must not transform/hide/show the native app');

    async function click(selector) {
      const point = await js(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const r = button.getBoundingClientRect();
        const x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2);
        if (document.elementFromPoint(x,y) !== button) throw new Error('Button is covered: ' + button.id);
        return { x, y };
      })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await delay(350);
    }
    async function verifyHide(selector, label) {
      if (!win.isVisible()) await js('window.floatCode.toggleVisibility()');
      win.blur();
      await click(selector);
      assert.equal(win.isVisible(), false, label + ' hides the native window');
      win.emit('blur');
      await delay(250);
      assert.equal(win.isVisible(), false, label + ' stays hidden after blur');
      assert.equal(win.isAlwaysOnTop(), false, 'Hidden window releases pinning');
      app.emit('second-instance', {}, [process.execPath]);
      await delay(150);
      assert.equal(win.isVisible(), true, 'Reopening restores hidden window');
    }
    assert.equal(await js('document.querySelector("#auth-gate").hidden'), false);
    await verifyHide('#window-close', 'Close before login');
    await verifyHide('#hide-window', 'Hide before login');
    // Simulate the already-signed-in UI only in this disposable test profile.
    await js('document.querySelector("#auth-gate").hidden = true; window.floatCode.setAuthLocked(false)');
    await verifyHide('#window-close', 'Close while editing');
    await verifyHide('#hide-window', 'Hide while editing');
    await js('window.floatCode.setClickThrough(true, false)');
    await verifyHide('#hide-window', 'Hide in click-through mode');
    await js('window.floatCode.setClickThrough(false, false)');
    // Standard keyboard/assistive activation sends click, not pointerdown.
    await js('document.querySelector("#window-close").click()');
    await delay(200);
    assert.equal(win.isVisible(), false, 'Keyboard close works');
    await js('window.floatCode.toggleVisibility()');
    assert.ok(globalShortcut.isRegistered('Alt+1'), 'Show/hide recovery shortcut registered');

    for (const transparent of [true, false]) {
      await js(`window.floatCode.setTransparent(${transparent})`);
      const style = await js(`(() => {
        const content = getComputedStyle(document.querySelector('.cm-content'));
        const gutter = getComputedStyle(document.querySelector('.cm-gutters'));
        const editor = getComputedStyle(document.querySelector('.cm-editor'));
        return { textShadow: content.textShadow, gutterShadow: gutter.textShadow,
          ink: editor.color, background: editor.backgroundColor,
          tokens: [...document.querySelectorAll('.cm-line span')].map(s => getComputedStyle(s).textShadow) };
      })()`);
      assert.equal(style.textShadow, 'none');
      assert.equal(style.gutterShadow, 'none');
      assert.ok(style.tokens.every(s => s === 'none'));
      assert.equal(style.ink, 'rgb(17, 24, 39)', 'Dark ink is legible over white');
      assert.equal(style.background, transparent ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)');
    }
    assert.equal(workspaceChanges, initialWorkspaces, 'Hide/show/theme changes do not reconfigure workspaces');
    console.log(`PASS Mac UI: unshadowed text, close/hide hit-testing, native visibility and recovery (${process.arch})`);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
