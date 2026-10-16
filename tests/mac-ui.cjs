// Real Electron renderer + IPC tests, using an isolated profile and no accounts.
const assert = require('node:assert/strict');
const { app, BrowserWindow, globalShortcut, screen } = require('electron');
const { execFileSync } = require('node:child_process');
app.setPath('userData', process.env.FLOATCODE_TEST_USER_DATA);
app.setAsDefaultProtocolClient = () => true;
let workspaceChanges = 0;
const workspaceCalls = [];
const alwaysOnTopCalls = [];
const originalWorkspaces = BrowserWindow.prototype.setVisibleOnAllWorkspaces;
BrowserWindow.prototype.setVisibleOnAllWorkspaces = function (...args) {
  workspaceChanges++;
  workspaceCalls.push(args);
  return originalWorkspaces.apply(this, args);
};
const originalAlwaysOnTop = BrowserWindow.prototype.setAlwaysOnTop;
BrowserWindow.prototype.setAlwaysOnTop = function (...args) {
  alwaysOnTopCalls.push(args);
  return originalAlwaysOnTop.apply(this, args);
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
    assert.ok(workspaceCalls.some(args => args[0] === true && args[1]?.visibleOnFullScreen === true),
      'Pinned overlay is visible in fullscreen Spaces');
    assert.ok(alwaysOnTopCalls.some(args => args[0] === true && args[1] === 'screen-saver'),
      'Pinned overlay uses the fullscreen-safe macOS window level');
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
      const bounds = win.getBounds();
      const globalPoint = { x: bounds.x + point.x, y: bounds.y + point.y };
      execFileSync(process.env.FLOATCODE_TEST_POINTER_TOOL, [String(globalPoint.x), String(globalPoint.y)]);
      await delay(100);
      const cursor = screen.getCursorScreenPoint();
      assert.ok(Math.abs(cursor.x - globalPoint.x) <= 2 && Math.abs(cursor.y - globalPoint.y) <= 2, 'Native cursor reaches control');
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

    const defaultSpacing = await js('document.querySelector("#line-spacing").value');
    assert.equal(defaultSpacing, '1.6');
    const firstHeight = (await js('window.floatCode.getState()')).interactiveZoneHeight;
    assert.ok(firstHeight >= 80 && firstHeight <= 84, 'Click-through exception is only three default code rows');
    await js('document.querySelector("#line-spacing").value = "2"; document.querySelector("#line-spacing").dispatchEvent(new Event("change"))');
    await delay(100);
    assert.equal(await js('getComputedStyle(document.querySelector(".cm-scroller")).lineHeight'), '34px');
    assert.equal((await js('window.floatCode.getState()')).interactiveZoneHeight, 102);
    assert.equal(await js('localStorage.getItem("floatcode.line-spacing")'), '2');

    assert.equal(await js('document.querySelector("#highlight-color").options.length'), 7);
    await js(`(() => {
      const select = document.querySelector('#highlight-color');
      select.value = 'yellow';
      select.dispatchEvent(new Event('change'));
    })()`);
    await delay(100);
    const highlighted = await js(`[...document.querySelectorAll('.cm-line.cm-highlight-yellow')].map(line => ({
      text: line.textContent,
      color: getComputedStyle(line).color,
      background: getComputedStyle(line).backgroundImage,
      opacity: getComputedStyle(line).opacity,
    }))`);
    assert.equal(highlighted.length, 1, 'The current row receives line highlighting without a selection');
    assert.ok(highlighted.every(line => line.text.length > 0 && line.background !== 'none' && line.opacity === '1'),
      'Highlight remains behind fully opaque code text');
    assert.equal(JSON.parse(await js('localStorage.getItem("floatcode.highlights")')).length, 1,
      'Highlights are remembered locally');
    await js(`(() => {
      const select = document.querySelector('#highlight-color');
      select.value = 'clear';
      select.dispatchEvent(new Event('change'));
    })()`);
    assert.equal(await js('document.querySelectorAll(".cm-line.cm-manual-highlight").length'), 0,
      'Clear highlight removes the selected rows only');

    for (const transparent of [true, false]) {
      await js(`window.floatCode.setTransparent(${transparent})`);
      const style = await js(`(() => {
        const content = getComputedStyle(document.querySelector('.cm-content'));
        const gutter = getComputedStyle(document.querySelector('.cm-gutters'));
        const editor = getComputedStyle(document.querySelector('.cm-editor'));
        return { textShadow: content.textShadow, gutterShadow: gutter.textShadow,
          ink: editor.color, background: editor.backgroundColor,
          tokens: [...document.querySelectorAll('.cm-line span')].map(s => getComputedStyle(s).textShadow),
          tokenColors: [...new Set([...document.querySelectorAll('.cm-line span')].map(s => getComputedStyle(s).color))] };
      })()`);
      assert.equal(style.textShadow, 'none');
      assert.equal(style.gutterShadow, 'none');
      assert.ok(style.tokens.every(s => s === 'none'));
      assert.ok(style.tokenColors.length >= (transparent ? 5 : 2), 'Python code keeps distinct syntax colors in both background modes');
      assert.ok(style.tokenColors.includes(transparent ? 'rgb(198, 120, 221)' : 'rgb(119, 0, 136)'), 'Original syntax palette stays active in each background mode');
      assert.equal(style.ink, transparent ? 'rgb(229, 231, 235)' : 'rgb(17, 24, 39)', 'Transparent text is bright; white mode keeps dark ink');
      assert.equal(style.background, transparent ? 'rgba(0, 0, 0, 0)' : 'rgb(255, 255, 255)');
    }
    assert.equal(workspaceChanges, initialWorkspaces, 'Hide/show/theme changes do not reconfigure workspaces');
    console.log(`PASS Mac UI: unshadowed text, close/hide hit-testing, native visibility and recovery (${process.arch})`);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
