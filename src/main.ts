import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import AdmZip from "adm-zip";
import { ConsoleLogger } from "@akashic/akashic-cli-commons";
import { promiseExportZip } from "@akashic/akashic-cli-export/lib/zip/exportZip.js";
import pkg from 'electron-updater';
import type {
  AiConfig,
  DownloadResult,
  GenerateRequest,
  GenerateResult,
  GameInfo,
  UpdateStatus,
} from "./shared/types.js";

const { autoUpdater } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const PROJECTS_DIR_NAME = "projects";
const PLAYGROUND_PATH = "/playground";
const GAME_PATH = "/game";
const PLAYGROUND_DIST_DIRNAME = "playground";

const require = createRequire(import.meta.url);
const exportPackageJson = require("@akashic/akashic-cli-export/package.json") as {
  version?: string;
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

type LocalServer = {
  playgroundDir: string;
  port: number;
  server: ReturnType<typeof createServer>;
};

type GenerationPayload = {
  projectName?: string;
  projectZipBase64?: string;
  projectDir?: string;
  summary?: string;
};

let mainWindow: BrowserWindow | null = null;
let aiConfig: AiConfig | null = null;
let aiClient: OpenAI | null = null;
let localServer: LocalServer | null = null;
const projectRegistry = new Map<string, string>();
let currentGame: GameInfo = { status: "idle" };
let conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
let currentGenerationController: AbortController | null = null;

function getRendererHtmlPath(): string {
  const appPath = app.getAppPath();
  return path.join(appPath, "script", "renderer", "index.html");
}

function sendUpdateStatus(status: UpdateStatus): void {
  if (!mainWindow) return;
  mainWindow.webContents.send("update-status", status);
}

function buildPlaygroundUrl(
  port: number,
  gameJsonUrl: string,
  name: string
): string {
  const payload = JSON.stringify({
    type: "gameJsonUri",
    name,
    uri: gameJsonUrl,
  });
  const encoded = Buffer.from(payload, "utf-8").toString("base64");
  return `http://127.0.0.1:${port}${PLAYGROUND_PATH}/#/edit/${encoded}?nodl&notab`;
}

function resolvePlaygroundDir(): string {
  const packagedPath = path.join(app.getAppPath(), "script", PLAYGROUND_DIST_DIRNAME);
  if (fsSync.existsSync(path.join(packagedPath, "index.html"))) {
    return packagedPath;
  }
  const submoduleDist = path.join(app.getAppPath(), "playground", "dist");
  if (fsSync.existsSync(path.join(submoduleDist, "index.html"))) {
    return submoduleDist;
  }
  const cwdDist = path.join(process.cwd(), "playground", "dist");
  if (fsSync.existsSync(path.join(cwdDist, "index.html"))) {
    return cwdDist;
  }
  throw new Error("playgroundのビルド済みファイルが見つかりません。");
}

async function serveStaticFile(
  rootDir: string,
  requestPath: string,
  res: ServerResponse,
  fallbackToIndex: boolean
): Promise<void> {
  const safePath = requestPath.replace(/\\/g, "/");
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(path.join(rootDir, safePath));

  if (!resolved.startsWith(resolvedRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) {
    if (fallbackToIndex) {
      const indexPath = path.join(rootDir, "index.html");
      const indexStat = await fs.stat(indexPath).catch(() => null);
      if (indexStat?.isFile()) {
        res.writeHead(200, { "Content-Type": "text/html" });
        fsSync.createReadStream(indexPath).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fsSync.createReadStream(resolved).pipe(res);
}

function startLocalServer(playgroundDir: string): Promise<LocalServer> {
  if (localServer) {
    return Promise.resolve(localServer);
  }

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      const requestPath = decodeURIComponent(requestUrl.pathname);

      if (requestPath === "/" || requestPath === PLAYGROUND_PATH) {
        await serveStaticFile(playgroundDir, "/index.html", res, false);
        return;
      }

      if (requestPath.startsWith(`${PLAYGROUND_PATH}/`)) {
        const relativePath = requestPath.slice(PLAYGROUND_PATH.length);
        const normalized = relativePath === "" || relativePath.endsWith("/")
          ? `${relativePath}index.html`
          : relativePath;
        await serveStaticFile(playgroundDir, normalized, res, true);
        return;
      }

      if (requestPath.startsWith(`${GAME_PATH}/`)) {
        const parts = requestPath.split("/").filter(Boolean);
        const projectId = parts[1];
        const projectDir = projectRegistry.get(projectId);
        if (!projectDir) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const relativePath = parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/game.json";
        await serveStaticFile(projectDir, relativePath, res, false);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    } catch (error) {
      res.writeHead(500);
      res.end("Server Error");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      localServer = { playgroundDir, port: address.port, server };
      resolve(localServer);
    });
  });
}

async function ensureProjectsDir(): Promise<string> {
  const dir = path.join(app.getPath("userData"), PROJECTS_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function parseJsonFromText(text: string): GenerationPayload {
  const trimmed = text.trim();
  const candidates: string[] = [];

  if (trimmed.startsWith("{")) {
    candidates.push(trimmed);
  }

  const fenced = trimmed.match(/```json\s*([\s\S]+?)```/i);
  if (fenced) {
    candidates.push(fenced[1]);
  }

  const objectMatches = trimmed.match(/\{[\s\S]*?\}/g);
  if (objectMatches) {
    candidates.push(...objectMatches);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<GenerationPayload>;
      if (typeof parsed.projectDir === "string" && parsed.projectDir.length > 0) {
        return parsed as GenerationPayload;
      }
      if (typeof parsed.projectZipBase64 === "string" && parsed.projectZipBase64.length > 0) {
        return parsed as GenerationPayload;
      }
    } catch {
      // ignore parse errors and continue
    }
  }

  throw new Error("projectDirまたはprojectZipBase64を含むJSONが見つかりませんでした。");
}

function buildDeveloperInstruction(mode: "create" | "modify", targetDir: string): string {
  return `
あなたはニコ生ゲーム生成専用の技術アシスタントです。
必ずMCPサーバーのツールを使ってゲームを生成してください。
出力はJSONのみ。コードブロック不要。
JSON形式: {"projectName":"...","projectDir":"...","summary":"..."}
projectDir はプロジェクトを作成した絶対パス。
summary はユーザー向けの簡潔な説明。

ゲーム生成前の準備:
1) search_akashic_docs で、Akashic Engine の最新仕様を確認してください。
2) 生成先ディレクトリは次のパスに固定する: ${targetDir}
3) 既存プロジェクトが無ければ init_project を実行
  - templateType は ゲームの形式に合わせて以下のように変える
    - ランキング形式: javascript-shin-ichiba-ranking
    - マルチプレイ形式: javascript-multi
    - それ以外: javascript
  - skipNpmInstall は true にする

ゲーム生成:
- search_akashic_docs で、実装に必要なAPI（例: 音声再生、当たり判定、乱数生成）を都度確認
- ゲームプロジェクトのファイル構造は以下のようにしてください
  - script: ソースコード(javascriptファイル)
  - image: 画像ファイル
  - audio: 音声ファイル
  - text: テキストファイル
  - game.json
- create_game_file で、ゲームのソースコード を作成してください
- akashic_scan_asset を使用してgame.jsonを更新してください。

注意:
- init_project に失敗した場合は、代わりに init_minimal_template を実行する
- projectDir には ${targetDir} を返す
- 失敗時もJSONのみで理由を簡潔に返す
- create_game_file で game.json は更新しないでください
- JavaScript でコードを書く際は、CommonJS 形式且つ ES2015 以降の記法でコードを作成してください。
- Akashic Engine v3系のAPIを使用してください。

今回の目的: ${mode === "create" ? "新規生成" : "既存ゲームの修正"}
`;
}

async function runGeneration(
  prompt: string,
  mode: "create" | "modify",
  targetDir: string
): Promise<GenerationPayload> {
  if (!aiClient || !aiConfig) {
    throw new Error("AI設定が未完了です。");
  }
  if (!MCP_SERVER_URL) {
    throw new Error("MCPサーバーURLが未設定です。");
  }

  console.log("targetDir", targetDir);
  const developerInstruction = buildDeveloperInstruction(mode, targetDir);
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    currentGenerationController?.abort();
    currentGenerationController = controller;
    const timeoutMs = Number(process.env.GENERATION_TIMEOUT_MS ?? 600000); // タイムアウト時間は長めに10分とする
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const historyText = conversation
        .map((entry) => `${entry.role === "user" ? "User" : "AI"}: ${entry.content}`)
        .join("\n");
      const inputText = [
        developerInstruction.trim(),
        historyText ? `\n直前までの会話:\n${historyText}` : "",
        `\nユーザー入力:\n${prompt}`,
      ].join("\n");

      const response = await aiClient.responses.create({
        model: aiConfig.model,
        tools: [
          {
            type: "mcp",
            server_label: "namagame_generator",
            server_description: "Nicolive game generator MCP server",
            server_url: MCP_SERVER_URL,
            require_approval: "never",
          },
        ],
        input: inputText,
      }, { signal: controller.signal });

      const outputText = response.output_text?.trim() ?? "";
      try {
        return parseJsonFromText(outputText);
      } catch (error) {
        if (/init_project/i.test(outputText)) {
          throw new Error("init_project");
        }
        throw error;
      }
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof Error && /init_project/i.test(error.message)) {
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          continue;
        }
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (currentGenerationController === controller) {
        currentGenerationController = null;
      }
    }
  }

  throw lastError ?? new Error("init_project");
}

function normalizeBase64(input: string): string {
  let value = input.trim();
  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    if (commaIndex >= 0) {
      value = value.slice(commaIndex + 1);
    }
  }
  value = value.replace(/\s+/g, "");
  const padding = value.length % 4;
  if (padding !== 0) {
    value = value.padEnd(value.length + (4 - padding), "=");
  }
  return value;
}

function assertZipBuffer(buffer: Buffer): void {
  if (buffer.length < 4) {
    throw new Error("zipデータが短すぎます。");
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("zipデータではありません。");
  }
}

async function ensureEntryPoint(projectDir: string): Promise<void> {
  const gameJsonPath = path.join(projectDir, "game.json");
  const raw = await fs.readFile(gameJsonPath, "utf-8").catch(() => "");
  if (!raw) {
    throw new Error("game.jsonが見つかりません。");
  }
  let gameJson: { main?: string } & Record<string, unknown>;
  try {
    gameJson = JSON.parse(raw) as { main?: string } & Record<string, unknown>;
  } catch {
    throw new Error("game.jsonが不正なJSONです。");
  }

  const candidates = [
    "script/main.js",
    "main.js",
    "src/main.js",
  ];

  const resolveEntry = (entry: string): string =>
    entry.replace(/^\.\//, "");

  if (gameJson.main) {
    const entryPath = path.join(projectDir, resolveEntry(gameJson.main));
    if (fsSync.existsSync(entryPath)) {
      return;
    }
  }

  const fallback = candidates.find((candidate) =>
    fsSync.existsSync(path.join(projectDir, candidate))
  );

  if (!fallback) {
    throw new Error("エントリポイントのJSファイルが見つかりません。");
  }

  gameJson.main = fallback;
  await fs.writeFile(gameJsonPath, JSON.stringify(gameJson, null, 2), "utf-8");
}

async function createZipFromDir(sourceDir: string, outputPath: string): Promise<void> {
  const zip = new AdmZip();
  zip.addLocalFolder(sourceDir);
  zip.writeZip(outputPath);
}

async function createNicoliveZip(projectDir: string, outputPath: string): Promise<void> {
  const logger = new ConsoleLogger({ quiet: true });
  const version = exportPackageJson.version ?? "unknown";

  await promiseExportZip({
    bundle: true,
    babel: true,
    minify: undefined,
    minifyJs: undefined,
    minifyJson: undefined,
    terser: undefined,
    packImage: undefined,
    strip: true,
    source: projectDir,
    dest: outputPath,
    force: true,
    hashLength: 20,
    logger,
    omitUnbundledJs: false,
    targetService: "nicolive",
    nicolive: true,
    resolveAkashicRuntime: true,
    preservePackageJson: undefined,
    exportInfo: {
      version,
      option: {
        quiet: true,
        force: true,
        strip: true,
        minify: undefined,
        minifyJs: undefined,
        minifyJson: undefined,
        bundle: true,
        babel: true,
        hashFilename: true,
        targetService: "nicolive",
        nicolive: true,
        preservePackageJson: undefined,
      },
    },
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "不明なエラーが発生しました。";
}

function toErrorCode(error: unknown): string | undefined {
  const anyError = error as { status?: number; code?: string; message?: string } | null;
  if (!anyError) return undefined;
  if (anyError.code === "invalid_api_key") return "invalid_api_key";
  if (anyError.status === 401) return "invalid_api_key";
  if (anyError.message && anyError.message.includes("Invalid API key")) {
    return "invalid_api_key";
  }
  return undefined;
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
  aiClient = new OpenAI({ apiKey: config.apiKey });
  conversation = [];

  if (process.env.SKIP_API_KEY_CHECK === "1") {
    return { ok: true };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      await aiClient.models.list({ signal: controller.signal });
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
      errorMessage: "APIキーの確認に失敗しました。ネットワーク設定をご確認ください。",
      errorCode: toErrorCode(error),
    };
  }
});

ipcMain.handle("get-history", () => {
  return { history: conversation };
});

ipcMain.handle("cancel-generation", () => {
  if (currentGenerationController) {
    currentGenerationController.abort();
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle(
  "generate-game",
  async (_event, request: GenerateRequest): Promise<GenerateResult> => {
    const prompt = request.prompt.trim();
    if (!prompt) {
      return { ok: false, errorMessage: "テキストを入力してください。" };
    }

    currentGame = { status: "generating" };

    try {
      const projectsDir = await ensureProjectsDir();
      const projectId = crypto.randomUUID();
      const projectDir = path.join(projectsDir, projectId);
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.mkdir(projectDir, { recursive: true });

      const payload = await runGeneration(prompt, request.mode, projectDir);
      if (payload.projectDir) {
        if (path.resolve(payload.projectDir) !== path.resolve(projectDir)) {
          throw new Error("projectDirが指定と一致しませんでした。");
        }
      } else if (payload.projectZipBase64) {
        const normalizedBase64 = normalizeBase64(payload.projectZipBase64);
        const zipBuffer = Buffer.from(normalizedBase64, "base64");
        assertZipBuffer(zipBuffer);
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(projectDir, true);
      } else {
        throw new Error("projectDirまたはprojectZipBase64がありません。");
      }

      await ensureEntryPoint(projectDir);

      const playgroundDir = resolvePlaygroundDir();
      const serverInfo = await startLocalServer(playgroundDir);
      projectRegistry.set(projectId, projectDir);
      const gameJsonUrl = `http://127.0.0.1:${serverInfo.port}${GAME_PATH}/${projectId}/game.json`;
      const projectName = payload.projectName || "namagame";
      const playgroundUrl = buildPlaygroundUrl(serverInfo.port, gameJsonUrl, projectName);

      currentGame = {
        status: "success",
        projectName,
        playgroundUrl,
        projectDir,
      };

      conversation.push({ role: "user", content: prompt });
      if (payload.summary) {
        conversation.push({ role: "assistant", content: payload.summary });
      }

      return { ok: true, game: currentGame, summary: payload.summary, history: conversation };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, errorMessage: "キャンセルしました。", errorCode: "canceled" };
      }
      const errorCode = toErrorCode(error);
      const errorMessage = toErrorMessage(error);
      currentGame = { status: "error", errorMessage, errorCode };
      return { ok: false, errorMessage, errorCode };
    }
  }
);

ipcMain.handle("download-project-zip", async (): Promise<DownloadResult> => {
  if (!currentGame.projectDir || !currentGame.projectName) {
    return { ok: false, errorMessage: "ダウンロードできるゲームがありません。" };
  }

  const defaultPath = path.join(
    app.getPath("downloads"),
    `${currentGame.projectName}.zip`
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
    await createZipFromDir(currentGame.projectDir, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

ipcMain.handle("download-nicolive-zip", async (): Promise<DownloadResult> => {
  if (!currentGame.projectDir || !currentGame.projectName) {
    return { ok: false, errorMessage: "ダウンロードできるゲームがありません。" };
  }

  const defaultPath = path.join(
    app.getPath("downloads"),
    `${currentGame.projectName}-nicolive.zip`
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
    await createNicoliveZip(currentGame.projectDir, result.filePath);
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, errorMessage: toErrorMessage(error) };
  }
});

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  app.quit();
});
