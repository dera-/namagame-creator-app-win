import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
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
  LoadProjectResult,
  UpdateStatus,
} from "./shared/types.js";

const { autoUpdater } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const PROJECTS_DIR_NAME = "projects";
const PLAYGROUND_PATH = "/playground";
const GAME_PATH = "/game";
const SANDBOX_PATH = "/sandbox";
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

type SandboxServer = {
  port: number;
  process: ChildProcess;
  projectDir: string;
};

type GenerationPayload = {
  projectName?: string;
  projectZipBase64?: string;
  projectDir?: string;
  summary?: string;
};

let mainWindow: BrowserWindow | null = null;
let debugWindow: BrowserWindow | null = null;
let aiConfig: AiConfig | null = null;
let aiClient: OpenAI | null = null;
let localServer: LocalServer | null = null;
let sandboxServer: SandboxServer | null = null;
const projectRegistry = new Map<string, string>();
let currentGame: GameInfo = { status: "idle" };
let currentProjectOrigin: "none" | "generated" | "imported" = "none";
type ConversationEntry = {
  role: "user" | "assistant";
  content: string;
  summary?: string;
};

let conversation: Array<ConversationEntry> = [];
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
  const encoded = encodeURIComponent(
    Buffer.from(payload, "utf-8").toString("base64")
  );
  return `http://127.0.0.1:${port}${PLAYGROUND_PATH}/#/snippets/${encoded}?nodl`;
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
  throw new Error("playgroundのビルド成果物が見つかりません。");
}

function resolveSandboxBin(): string {
  const binName = process.platform === "win32"
    ? "akashic-cli-sandbox.cmd"
    : "akashic-cli-sandbox";
  const binPath = path.join(app.getAppPath(), "node_modules", ".bin", binName);
  if (fsSync.existsSync(binPath)) {
    return binPath;
  }
  throw new Error("akashic-sandboxが見つかりません。");
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function startSandboxServer(projectDir: string): Promise<SandboxServer> {
  if (sandboxServer && sandboxServer.projectDir === projectDir) {
    return sandboxServer;
  }
  if (sandboxServer) {
    sandboxServer.process.kill();
    sandboxServer = null;
  }

  const port = await getAvailablePort();
  const binPath = resolveSandboxBin();
  const child = spawn(binPath, ["-p", String(port), projectDir], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  sandboxServer = { port, process: child, projectDir };
  child.on("exit", () => {
    if (sandboxServer?.process === child) {
      sandboxServer = null;
    }
  });
  return sandboxServer;
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

      if (requestPath.startsWith(`${SANDBOX_PATH}`)) {
        if (!sandboxServer) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const redirectTarget = `http://127.0.0.1:${sandboxServer.port}/game/`;
        res.writeHead(302, { Location: redirectTarget });
        res.end();
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

  throw new Error("projectDirまたはprojectZipBase64がありません。");
}

function buildDeveloperInstruction(mode: "create" | "modify", targetDir: string): string {
  const modifyPolicy =
    mode === "modify"
      ? `
【重要: 既存プロジェクトの修正】
- 既存ファイルを最大限維持し、変更が必要な部分だけを編集すること。
- 変更対象ファイルを先に列挙し、そのファイルのみを編集すること。
- 不要なファイルの削除・全面置換は行わないこと。
- game.json は指定がない限り修正しない。
- 既存の設計・ゲーム性を尊重し、ユーザーの指示に必要な最小変更で対応すること。
- 変更点は最小限で明確に。改修対象外のファイルは触らないこと。
`
      : "";

  return `
あなたはニコ生ゲームの生成AIです。
MCPサーバーを使ってゲームを生成し、次のJSONのみを返してください。
JSON形式: {"projectName":"...","projectDir":"...","summary":"..."}
projectDirは必ず指定されたパスを使用してください。
summaryは日本語で簡潔にまとめてください。
${modifyPolicy}

テンプレート生成は1回のみです。複数回のテンプレート生成は禁止します。
game.json が存在する場合は init_project を実行しないでください。
テンプレート生成は ${targetDir} のみで行い、別のディレクトリは作らないでください。
TypeScriptテンプレートは禁止です。JavaScriptテンプレートのみを使用してください。

implement_niconama_game を使って、ニコ生ゲームを実装してください。
`;
}

function validateGenerationPayload(payload: GenerationPayload): string[] {
  const errors: string[] = [];
  if (!payload.projectName || typeof payload.projectName !== "string") {
    errors.push("projectNameがありません。");
  }
  if (!payload.summary || typeof payload.summary !== "string") {
    errors.push("summaryがありません。");
  }
  const hasDir = typeof payload.projectDir === "string" && payload.projectDir.length > 0;
  const hasZip =
    typeof payload.projectZipBase64 === "string" && payload.projectZipBase64.length > 0;
  if (!hasDir && !hasZip) {
    errors.push("projectDirまたはprojectZipBase64がありません。");
  }
  return errors;
}

function buildRepairPrompt(originalPrompt: string, errorMessage: string): string {
  return `${originalPrompt}\n\n以下の検証エラーを修正してください。既存のファイルは可能な限り保持し、必要な差分のみを修正してください。\nエラー: ${errorMessage}`;
}

async function createResponseWithTemperature(
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal }
): Promise<OpenAI.Responses.Response> {
  if (!aiClient) {
    throw new Error("AI設定が未設定です。");
  }
  try {
    return await aiClient.responses.create(body as never, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unsupported parameter: 'temperature'")) {
      const { temperature: _ignored, ...rest } = body;
      return await aiClient.responses.create(rest as never, options);
    }
    throw error;
  }
}

async function runDesign(prompt: string): Promise<string> {
  if (!aiClient || !aiConfig) {
    throw new Error("AI設定が未設定です。");
  }
  if (!MCP_SERVER_URL) {
    throw new Error("MCPサーバーURLが未設定です。");
  }

  const response = await createResponseWithTemperature({
    model: aiConfig.designModel ?? aiConfig.model,
    tools: [
      {
        type: "mcp",
        server_label: "namagame_generator",
        server_description: "Nicolive game generator MCP server",
        server_url: MCP_SERVER_URL,
        require_approval: "never",
      },
    ],
    input: `design_niconama_game を使って、ゲーム設計文のみを出力してください。\nユーザー入力:\n${prompt}`,
    temperature: 0.3,
  });

  return response.output_text?.trim() ?? "";
}

async function runGeneration(
  prompt: string,
  mode: "create" | "modify",
  targetDir: string
): Promise<{ payload: GenerationPayload; outputText: string }> {
  if (!aiClient || !aiConfig) {
    throw new Error("AI設定が未設定です。");
  }
  if (!MCP_SERVER_URL) {
    throw new Error("MCPサーバーURLが未設定です。");
  }

  console.log("targetDir", targetDir);
  const effectiveMode =
    mode === "modify" && currentProjectOrigin === "imported" ? "modify" : "create";
  const developerInstruction = buildDeveloperInstruction(effectiveMode, targetDir);
  const maxAttempts = 3;
  let lastError: unknown = null;

  const shouldUseDesignModel =
    aiConfig.designModel && aiConfig.designModel !== aiConfig.model;
  const designDoc = shouldUseDesignModel ? await runDesign(prompt) : "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    currentGenerationController?.abort();
    currentGenerationController = controller;
                const timeoutMs = Number(process.env.GENERATION_TIMEOUT_MS ?? 1200000); // タイムアウト時間: デフォルト20分
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const historyText = conversation
        .map((entry) => `${entry.role === "user" ? "User" : "AI"}: ${entry.content}`)
        .join("\n");
      const inputText = [
        developerInstruction.trim(),
        designDoc ? `\nゲーム設計文:\n${designDoc}` : "",
        historyText ? `\n直前までの会話:\n${historyText}` : "",
        `\nユーザー入力:\n${prompt}`,
      ].join("\n");

      const response = await createResponseWithTemperature({
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
        temperature: 0.3,
      }, { signal: controller.signal });

      const outputText = response.output_text?.trim() ?? "";
      try {
        return { payload: parseJsonFromText(outputText), outputText };
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

function toUiHistory(entries: ConversationEntry[]): Array<{ role: "user" | "assistant"; content: string }> {
  return entries.map((entry) => ({
    role: entry.role,
    content: entry.role === "assistant" ? entry.summary ?? entry.content : entry.content,
  }));
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
    throw new Error("zipデータが空です。");
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("zipデータの署名が不正です。");
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
    throw new Error("game.jsonが正しいJSONではありません。");
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

async function readGameSize(projectDir: string): Promise<{ width: number; height: number }> {
  const gameJsonPath = path.join(projectDir, "game.json");
  const raw = await fs.readFile(gameJsonPath, "utf-8").catch(() => "");
  if (!raw) {
    return { width: 640, height: 480 };
  }
  try {
    const data = JSON.parse(raw) as { width?: number; height?: number };
    const width = Number(data.width) || 640;
    const height = Number(data.height) || 480;
    return { width, height };
  } catch {
    return { width: 640, height: 480 };
  }
}

async function openDebugWindow(): Promise<void> {
  if (!currentGame.debugUrl || !currentGame.projectDir) {
    throw new Error("デバッグ画面を開くための情報がありません。");
  }

  const { width, height } = await readGameSize(currentGame.projectDir);
  if (!debugWindow || debugWindow.isDestroyed()) {
    debugWindow = new BrowserWindow({
      width,
      height,
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
    debugWindow.setContentSize(width, height);
  }

  await debugWindow.loadURL(currentGame.debugUrl);
  debugWindow.webContents.openDevTools({ mode: "detach" });
  debugWindow.show();
  debugWindow.focus();
}

async function createZipFromDir(sourceDir: string, outputPath: string): Promise<void> {
  const zip = new AdmZip();
  zip.addLocalFolder(sourceDir);
  zip.writeZip(outputPath);
}

async function prepareGameFromProject(projectDir: string, projectName: string): Promise<GameInfo> {
  await ensureEntryPoint(projectDir);

  await startSandboxServer(projectDir);

  const playgroundDir = resolvePlaygroundDir();
  const serverInfo = await startLocalServer(playgroundDir);

  const projectId = crypto.randomUUID();
  projectRegistry.set(projectId, projectDir);

  const gameJsonUrl = `http://127.0.0.1:${serverInfo.port}${GAME_PATH}/${projectId}/game.json`;
  const playgroundUrl = buildPlaygroundUrl(serverInfo.port, gameJsonUrl, projectName);
  const debugUrl = `http://127.0.0.1:${serverInfo.port}${SANDBOX_PATH}/`;

  return {
    status: "success",
    projectName,
    playgroundUrl,
    debugUrl,
    projectDir,
  };
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
  await fs.cp(sourceDir, targetDir, { recursive: true });

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
  if (sandboxServer) {
    sandboxServer.process.kill();
    sandboxServer = null;
  }
  if (debugWindow) {
    debugWindow.close();
    debugWindow = null;
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

    const projectsDir = await ensureProjectsDir();
    const projectId = crypto.randomUUID();
    let projectDir = path.join(projectsDir, projectId);
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.mkdir(projectDir, { recursive: true });

    const maxFixAttempts = 2;
    let promptForAttempt = prompt;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxFixAttempts; attempt += 1) {
      try {
        const { payload, outputText } = await runGeneration(promptForAttempt, request.mode, projectDir);
        const payloadErrors = validateGenerationPayload(payload);
        if (payloadErrors.length > 0) {
          throw new Error(payloadErrors.join(" "));
        }

        if (payload.projectDir) {
          const resolvedTarget = path.resolve(projectDir);
          const resolvedPayload = path.resolve(payload.projectDir);
          if (resolvedPayload !== resolvedTarget) {
            if (!resolvedPayload.startsWith(`${resolvedTarget}${path.sep}`)) {
              throw new Error("projectDirが指定先と一致しませんでした。");
            }
            const nestedGameJson = path.join(resolvedPayload, "game.json");
            try {
              await fs.access(nestedGameJson);
            } catch {
              throw new Error("projectDirが指定先と一致しませんでした。");
            }
            projectDir = resolvedPayload;
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

        const projectName = payload.projectName || "namagame";
        currentGame = await prepareGameFromProject(projectDir, projectName);
        currentProjectOrigin = "generated";

        conversation.push({ role: "user", content: prompt });
        if (payload.summary) {
          conversation.push({ role: "assistant", content: outputText, summary: payload.summary });
        } else {
          conversation.push({ role: "assistant", content: outputText });
        }

        return { ok: true, game: currentGame, summary: payload.summary, history: toUiHistory(conversation) };
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") {
          return { ok: false, errorMessage: "キャンセルされました。", errorCode: "canceled" };
        }
        if (attempt < maxFixAttempts) {
          promptForAttempt = buildRepairPrompt(prompt, toErrorMessage(error));
          continue;
        }
        const errorCode = toErrorCode(error);
        const errorMessage = toErrorMessage(error);
        currentGame = { status: "error", errorMessage, errorCode };
        return { ok: false, errorMessage, errorCode };
      }
    }

    const errorCode = toErrorCode(lastError);
    const errorMessage = toErrorMessage(lastError);
    currentGame = { status: "error", errorMessage, errorCode };
    return { ok: false, errorMessage, errorCode };
  }
);


ipcMain.handle("download-project-zip", async (): Promise<DownloadResult> => {
  if (!currentGame.projectDir || !currentGame.projectName) {
    return { ok: false, errorMessage: "ダウンロードするゲームがありません。" };
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
    return { ok: false, errorMessage: "ダウンロードするゲームがありません。" };
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
