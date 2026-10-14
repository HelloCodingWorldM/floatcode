const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("floatCode", {
  getState: () => ipcRenderer.invoke("overlay:get-state"),
  setClickThrough: (enabled, focusWhenEditable = true) =>
    ipcRenderer.invoke(
      "overlay:set-click-through",
      Boolean(enabled),
      Boolean(focusWhenEditable),
    ),
  toggleClickThrough: () => ipcRenderer.invoke("overlay:toggle-click-through"),
  setControlsInteractive: (enabled) =>
    ipcRenderer.invoke("overlay:set-controls-interactive", Boolean(enabled)),
  setTransparent: (enabled) =>
    ipcRenderer.invoke("overlay:set-transparent", Boolean(enabled)),
  setPinned: (enabled) =>
    ipcRenderer.invoke("overlay:set-pinned", Boolean(enabled)),
  toggleVisibility: () => ipcRenderer.invoke("overlay:toggle-visibility"),
  hideWindow: () => ipcRenderer.invoke("overlay:hide-window"),
  minimizeWindow: () => ipcRenderer.invoke("overlay:minimize-window"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("overlay:toggle-maximize-window"),
  getBounds: () => ipcRenderer.invoke("overlay:get-bounds"),
  resizeTo: (width, height) =>
    ipcRenderer.invoke("overlay:resize-to", Number(width), Number(height)),
  moveTo: (x, y) =>
    ipcRenderer.invoke("overlay:move-to", Number(x), Number(y)),
  setAuthLocked: (enabled) =>
    ipcRenderer.invoke("overlay:set-auth-locked", Boolean(enabled)),
  onStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("overlay:state-changed", listener);
    return () => ipcRenderer.removeListener("overlay:state-changed", listener);
  },
  getPendingInvite: () => ipcRenderer.invoke("invite:get-pending"),
  consumeInvite: () => ipcRenderer.invoke("invite:consume"),
  onInviteReceived: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("invite:received", listener);
    return () => ipcRenderer.removeListener("invite:received", listener);
  },
  secureStorage: {
    getItem: (key) => ipcRenderer.invoke("secure-storage:get", String(key)),
    setItem: (key, value) => ipcRenderer.invoke("secure-storage:set", String(key), String(value)),
    removeItem: (key) => ipcRenderer.invoke("secure-storage:remove", String(key)),
  },
});
