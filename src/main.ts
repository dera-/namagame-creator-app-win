import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import OpenAI from "openai";
import pkg from 'electron-updater';
import type {
  AiConfig,
  DownloadResult,
  GameInfo,
  LoadProjectResult,
  UpdateStatus,
} from "./shared/types.js";
import { GAME_PATH, PROJECTS_DIR_NAME, SANDBOX_PATH } from "./main/constants.js";
import { shutdownMcpServer } from "./main/mcp.js";
import { toErrorMessage } from "./main/generation.js";
import {
  createNicoliveZip,
  createZipFromDir,
  ensureEntryPoint,
  isMultiplayerGame,
  readGameSize,
} from "./main/project.js";
import { createMainController } from "./main/controller.js";
import {
  buildPlaygroundUrl,
  closeSandboxServer,
  closeMultiplayerServeServer,
  getRendererHtmlPath,
  resolvePlaygroundDir,
  startLocalServer,
  startMultiplayerServeServer,
  startSandboxServer,
} from "./main/servers.js";

const { autoUpdater } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let debugWindow: BrowserWindow | null = null;
const projectRegistry = new Map<string, string>();

function getGenerationTimeoutMs(): number {
  const parsed = Number(process.env.GENERATION_TIMEOUT_MS ?? 1800000);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1800000;
  }
  return parsed;
}

function sendUpdateStatus(status: UpdateStatus): void {
  if (!mainWindow) return;
  mainWindow.webContents.send("update-status", status);
}

async function ensureProjectsDir(): Promise<string> {
  const dir = path.join(app.getPath("userData"), PROJECTS_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const controller = createMainController({
  createAiClient: (config) => new OpenAI({ apiKey: config.apiKey, timeout: getGenerationTimeoutMs() }),
  getGenerationTimeoutMs,
  ensureProjectsDir,
  prepareGameFromProject,
  skipApiKeyCheck: process.env.SKIP_API_KEY_CHECK === "1",
});

async function openDebugWindow(): Promise<void> {
  const { currentGame } = controller.getState();
  if (!currentGame.debugUrl || !currentGame.projectDir) {
    throw new Error("デバッグ画面を開くための情報がありません。");
  }

  const { width, height } = await readGameSize(currentGame.projectDir);
  const windowWidth = currentGame.isMultiplayer ? Math.max(width + 420, 1280) : width;
  const windowHeight = currentGame.isMultiplayer ? Math.max(height + 240, 900) : height;
  if (!debugWindow || debugWindow.isDestroyed()) {
    debugWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      useContentSize: true,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
      },
    });
    debugWindow.on("closed", () => {
      debugWindow = null;
    });
  } else {
    debugWindow.setContentSize(windowWidth, windowHeight);
  }

  await debugWindow.loadURL(currentGame.debugUrl);
  debugWindow.webContents.openDevTools({ mode: "detach" });
  debugWindow.show();
  debugWindow.focus();
}

async function prepareGameFromProject(projectDir: string, projectName: string): Promise<GameInfo> {
  await ensureEntryPoint(projectDir);
  const isMultiplayer = await isMultiplayerGame(projectDir);

  if (isMultiplayer) {
    closeSandboxServer();
    const serverInfo = await startMultiplayerServeServer(projectDir, { forceRestart: true });
    return {
      status: "success",
      projectName,
      debugUrl: `http://127.0.0.1:${serverInfo.port}/public/`,
      projectDir,
      isMultiplayer: true,
    };
  }

  await closeMultiplayerServeServer();

  // Debug server may cache project contents; restart to reflect latest modified files.
  await startSandboxServer(projectDir, { forceRestart: true });

  const playgroundDir = resolvePlaygroundDir();
  const serverInfo = await startLocalServer(playgroundDir, projectRegistry);

  const projectId = crypto.randomUUID();
  projectRegistry.set(projectId, projectDir);

  const gameJsonUrl = `http://127.0.0.1:${serverInfo.port}${GAME_PATH}/${projectId}/game.json`;
  const playgroundUrl = buildPlaygroundUrl(serverInfo.port, gameJsonUrl, projectName);
  const debugUrl = `http://127.0.0.1:${serverInfo.port}${SANDBOX_PATH}/${projectId}/`;

  return {
    status: "success",
    projectName,
    playgroundUrl,
    debugUrl,
    projectDir,
    isMultiplayer: false,
  };
}

function getDownloadableGame(): GameInfo | null {
  const { currentGame, lastSuccessfulGame } = controller.getState();
  if (currentGame.projectDir && currentGame.projectName) {
    return currentGame;
  }
  if (lastSuccessfulGame?.projectDir && lastSuccessfulGame.projectName) {
    return lastSuccessfulGame;
  }
  return null;
}

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ state: "checking" });
  });
  autoUpdater.on("update-available", () => {
    sendUpdateStatus({ state: "available" });
  });
  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({ state: "not-available" });
  });
  autoUpdater.on("update-downloaded", () => {
    sendUpdateStatus({ state: "downloaded" });
  });
  autoUpdater.on("error", (error) => {
    sendUpdateStatus({ state: "error", message: toErrorMessage(error) });
  });

  autoUpdater.checkForUpdates().catch(() => {
    sendUpdateStatus({ state: "error", message: "更新確認に失敗しました。" });
  });
}

async function createWindow(): Promise<void> {
  const appPath = app.getAppPath();
  const preloadCandidates = [
    path.join(appPath, "script", "preload.cjs"),
    path.join(__dirname, "preload.cjs"),
    path.join(appPath, "script", "preload.js"),
    path.join(__dirname, "preload.js"),
  ];
  const resolvedPreloadPath =
    preloadCandidates.find((candidate) => fsSync.existsSync(candidate)) ??
    preloadCandidates[preloadCandidates.length - 1];

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: resolvedPreloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  await mainWindow.loadFile(getRendererHtmlPath());
  if (process.env.NODE_ENV === "development" || process.env.ELECTRON_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  setupAutoUpdater();
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeSandboxServer();
  void closeMultiplayerServeServer();
  if (debugWindow) {
    debugWindow.close();
    debugWindow = null;
  }
  shutdownMcpServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("get-app-info", () => {
  return {
    version: app.getVersion(),
    platform: process.platform,
  };
});

ipcMain.handle("set-ai-config", async (_event, config: AiConfig) => {
  return controller.setAiConfig(config);
});

ipcMain.handle("get-history", () => {
  return controller.getHistory();
});

ipcMain.handle("reset-session", () => {
  const result = controller.resetSession();
  closeSandboxServer();
  void closeMultiplayerServeServer();
  return result;
});

ipcMain.handle("open-project-dir", async (): Promise<LoadProjectResult> => {
  const result = await dialog.showOpenDialog({
    title: "プロジェクトフォルダを選択",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false };
  }
  return controller.loadProjectDir(result.filePaths[0]);
});

ipcMain.handle("load-project-dir", async (_event, sourceDir: string): Promise<LoadProjectResult> => {
  return controller.loadProjectDir(sourceDir);
});

ipcMain.handle("open-debug-window", async () => {
  try {
    await openDebugWindow();
    return { ok: true };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

ipcMain.handle("open-debug-external", async () => {
  const { currentGame } = controller.getState();
  if (!currentGame.debugUrl) {
    return { ok: false, errorMessage: "デバッグURLがありません。" };
  }
  try {
    await shell.openExternal(currentGame.debugUrl);
    return { ok: true };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

ipcMain.handle("cancel-generation", () => {
  return controller.cancelGeneration();
});

ipcMain.handle(
  "generate-game",
  async (_event, request) =>
    controller.generateGame(request)
);


ipcMain.handle("download-project-zip", async (): Promise<DownloadResult> => {
  const targetGame = getDownloadableGame();
  if (!targetGame?.projectDir || !targetGame.projectName) {
    return { ok: false, errorMessage: "ダウンロードするゲームがありません。" };
  }

  const defaultPath = path.join(
    app.getPath("downloads"),
    `${targetGame.projectName}.zip`
  );
  const result = await dialog.showSaveDialog({
    title: "プロジェクトを保存",
    defaultPath,
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: true, canceled: true };
  }

  try {
    await createZipFromDir(targetGame.projectDir, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

ipcMain.handle("download-nicolive-zip", async (): Promise<DownloadResult> => {
  const targetGame = getDownloadableGame();
  if (!targetGame?.projectDir || !targetGame.projectName) {
    return { ok: false, errorMessage: "ダウンロードするゲームがありません。" };
  }

  const defaultPath = path.join(
    app.getPath("downloads"),
    `${targetGame.projectName}-nicolive.zip`
  );
  const result = await dialog.showSaveDialog({
    title: "ニコ生ゲーム用に保存",
    defaultPath,
    filters: [{ name: "Zip", extensions: ["zip"] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: true, canceled: true };
  }

  try {
    await createNicoliveZip(targetGame.projectDir, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});
