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
  GenerateRequest,
  GenerateResult,
  GameInfo,
  LoadProjectResult,
  UpdateStatus,
} from "./shared/types.js";
import { GAME_PATH, PROJECTS_DIR_NAME, SANDBOX_PATH } from "./main/constants.js";
import { shutdownMcpServer } from "./main/mcp.js";
import {
  createGenerationService,
  toErrorCode,
  toErrorMessage,
  toUiHistory,
  type ConversationEntry,
} from "./main/generation.js";
import {
  createNicoliveZip,
  createZipFromDir,
  ensureEntryPoint,
  isMultiplayerGame,
  isIgnoredMetadataPath,
  readGameSize,
  removeIgnoredMetadataFiles,
} from "./main/project.js";
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
let aiConfig: AiConfig | null = null;
let aiClient: OpenAI | null = null;
const projectRegistry = new Map<string, string>();
let currentGame: GameInfo = { status: "idle" };
let lastStableGame: GameInfo | null = null;
let currentProjectOrigin: "none" | "generated" | "imported" = "none";
let lastSuccessfulGame: GameInfo | null = null;
let conversation: Array<ConversationEntry> = [];
let currentGenerationController: AbortController | null = null;
let cachedImplementPrompt: ConversationEntry[] | null = null;

const generationState = {
  get aiConfig(): AiConfig | null {
    return aiConfig;
  },
  set aiConfig(value: AiConfig | null) {
    aiConfig = value;
  },
  get aiClient(): OpenAI | null {
    return aiClient;
  },
  set aiClient(value: OpenAI | null) {
    aiClient = value;
  },
  get conversation(): ConversationEntry[] {
    return conversation;
  },
  set conversation(value: ConversationEntry[]) {
    conversation = value;
  },
  get currentGenerationController(): AbortController | null {
    return currentGenerationController;
  },
  set currentGenerationController(value: AbortController | null) {
    currentGenerationController = value;
  },
  get cachedImplementPrompt(): ConversationEntry[] | null {
    return cachedImplementPrompt;
  },
  set cachedImplementPrompt(value: ConversationEntry[] | null) {
    cachedImplementPrompt = value;
  },
  get currentProjectOrigin(): "none" | "generated" | "imported" {
    return currentProjectOrigin;
  },
  set currentProjectOrigin(value: "none" | "generated" | "imported") {
    currentProjectOrigin = value;
  },
  get currentGame(): GameInfo {
    return currentGame;
  },
  set currentGame(value: GameInfo) {
    currentGame = value;
  },
  get lastStableGame(): GameInfo | null {
    return lastStableGame;
  },
  set lastStableGame(value: GameInfo | null) {
    lastStableGame = value;
  },
  get lastSuccessfulGame(): GameInfo | null {
    return lastSuccessfulGame;
  },
  set lastSuccessfulGame(value: GameInfo | null) {
    lastSuccessfulGame = value;
  },
};

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

const generationService = createGenerationService({
  state: generationState,
  getGenerationTimeoutMs,
  ensureProjectsDir,
  prepareGameFromProject,
});

async function openDebugWindow(): Promise<void> {
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
  if (currentGame.projectDir && currentGame.projectName) {
    return currentGame;
  }
  if (lastSuccessfulGame?.projectDir && lastSuccessfulGame.projectName) {
    return lastSuccessfulGame;
  }
  return null;
}

async function loadProjectDirectory(sourceDir: string): Promise<GameInfo> {
  const stats = await fs.stat(sourceDir).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error("指定されたパスはディレクトリではありません。");
  }
  const sourceGameJson = path.join(sourceDir, "game.json");
  try {
    await fs.access(sourceGameJson);
  } catch {
    throw new Error("game.jsonが見つかりません。");
  }

  const projectsDir = await ensureProjectsDir();
  const projectId = crypto.randomUUID();
  const targetDir = path.join(projectsDir, projectId);
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    filter: (entryPath) => !isIgnoredMetadataPath(entryPath),
  });
  await removeIgnoredMetadataFiles(targetDir);

  const projectName = path.basename(sourceDir);
  return prepareGameFromProject(targetDir, projectName);
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
  aiConfig = config;
  aiClient = new OpenAI({ apiKey: config.apiKey, timeout: getGenerationTimeoutMs() });
  conversation = [];
  cachedImplementPrompt = null;

  if (process.env.SKIP_API_KEY_CHECK === "1") {
    return { ok: true };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const list = await aiClient.models.list({ signal: controller.signal });
      // const sortedModels = [...list.data].sort(
      //   (a, b) => (b.created ?? 0) - (a.created ?? 0)
      // );
      // console.log(sortedModels);
    } finally {
      clearTimeout(timeoutId);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        errorMessage: "APIキーの確認がタイムアウトしました。",
        errorCode: "timeout",
      };
    }
    return {
      ok: false,
      errorMessage: "APIキーの確認に失敗しました。ネットワーク設定を確認してください。",
      errorCode: toErrorCode(error),
    };
  }
});

ipcMain.handle("get-history", () => {
  return { history: toUiHistory(conversation) };
});

ipcMain.handle("reset-session", () => {
  conversation = [];
  currentGame = { status: "idle" };
  lastStableGame = null;
  lastSuccessfulGame = null;
  currentProjectOrigin = "none";
  cachedImplementPrompt = null;
  if (currentGenerationController) {
    currentGenerationController.abort();
    currentGenerationController = null;
  }
  closeSandboxServer();
  void closeMultiplayerServeServer();
  return { ok: true };
});

ipcMain.handle("open-project-dir", async (): Promise<LoadProjectResult> => {
  const result = await dialog.showOpenDialog({
    title: "プロジェクトフォルダを選択",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false };
  }
  try {
    const game = await loadProjectDirectory(result.filePaths[0]);
    currentGame = game;
    lastSuccessfulGame = game;
    currentProjectOrigin = "imported";
    return { ok: true, game };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

ipcMain.handle("load-project-dir", async (_event, sourceDir: string): Promise<LoadProjectResult> => {
  try {
    const game = await loadProjectDirectory(sourceDir);
    currentGame = game;
    lastSuccessfulGame = game;
    currentProjectOrigin = "imported";
    return { ok: true, game };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
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
  return generationService.cancelGeneration();
});

ipcMain.handle(
  "generate-game",
  async (_event, request: GenerateRequest): Promise<GenerateResult> =>
    generationService.handleGenerateGame(request)
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
