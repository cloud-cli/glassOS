const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "glassOS",
  Object.freeze({
    closeWindow: () => ipcRenderer.send("glassos:window:close"),
    minimizeWindow: () => ipcRenderer.send("glassos:window:minimize"),
    toggleMaximize: () => ipcRenderer.send("glassos:window:toggle-maximize"),
    getBackendToken: () => ipcRenderer.invoke("glassos:backend:token"),
    isMaximized: () => ipcRenderer.invoke("glassos:window:is-maximized"),
    onMaximizedChange: (callback) => {
      if (typeof callback !== "function") {
        throw new TypeError("A callback function is required");
      }

      const listener = (_event, isMaximized) => callback(isMaximized);
      ipcRenderer.on("glassos:window:maximized", listener);
      return () => ipcRenderer.removeListener("glassos:window:maximized", listener);
    },
  }),
);
