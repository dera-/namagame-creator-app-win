const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  setAiConfig: (config) => ipcRenderer.invoke("set-ai-config", config),
  generateGame: (prompt, options = {}) =>
    ipcRenderer.invoke("generate-game", { prompt, mode: "create", ...options }),
  modifyGame: (prompt, options = {}) =>
    ipcRenderer.invoke("generate-game", { prompt, mode: "modify", ...options }),
  cancelGeneration: () => ipcRenderer.invoke("cancel-generation"),
  openDebugWindow: () => ipcRenderer.invoke("open-debug-window"),
  openDebugExternal: () => ipcRenderer.invoke("open-debug-external"),
  getHistory: () => ipcRenderer.invoke("get-history"),
  resetSession: () => ipcRenderer.invoke("reset-session"),
  downloadProjectZip: () => ipcRenderer.invoke("download-project-zip"),
  downloadNicoliveZip: () => ipcRenderer.invoke("download-nicolive-zip"),
  openProjectDir: () => ipcRenderer.invoke("open-project-dir"),
  loadProjectDir: (sourceDir) => ipcRenderer.invoke("load-project-dir", sourceDir),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => {
      callback(status);
    };
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
};

contextBridge.exposeInMainWorld("namagame", api);
