import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import fsSync from "node:fs";
import { app } from "electron";
import type { LlmRole } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type FunctionToolDef = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type ResponseFunctionToolCall = {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
};

export type McpPromptMessage = {
  role?: string;
  content?: unknown;
};

type McpPromptResponse = {
  messages?: McpPromptMessage[];
};

export type McpServerInfo = {
  baseUrl: string;
  port?: number;
  process?: ReturnType<typeof spawn>;
  tools: FunctionToolDef[];
};

let mcpServer: McpServerInfo | null = null;

export function getToolCallMaxIterations(): number {
  const parsed = Number(process.env.MCP_TOOL_CALL_MAX_ITERATIONS ?? 24);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 24;
  }
  return Math.floor(parsed);
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

function resolveMcpServerEntry(): { entryPath: string; serverDir: string } {
  const appPath = app.getAppPath();
  const resourcesPath =
    app.isPackaged && process.resourcesPath
      ? path.join(process.resourcesPath, "akashic-mcp", "index.js")
      : null;
  const unpackedBase = appPath.endsWith(".asar")
    ? path.join(path.dirname(appPath), "app.asar.unpacked")
    : null;
  const candidates = [
    ...(resourcesPath ? [resourcesPath] : []),
    path.join(appPath, "akashic-mcp", "index.js"),
    ...(unpackedBase ? [path.join(unpackedBase, "akashic-mcp", "index.js")] : []),
    path.join(process.cwd(), "akashic-mcp", "index.js"),
    path.join(__dirname, "..", "akashic-mcp", "index.js"),
  ];
  const entryPath = candidates.find((candidate) => fsSync.existsSync(candidate));
  if (!entryPath) {
    throw new Error("akashic-mcpのサーバーが見つかりません。");
  }
  return { entryPath, serverDir: path.dirname(entryPath) };
}

function getNodeBinary(): string {
  return process.env.NODE_BINARY ?? "node";
}

function getNpmBinary(): string {
  return process.env.NPM_BINARY ?? "npm";
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => console.log(String(chunk)));
    child.stderr?.on("data", (chunk) => console.error(String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with code ${code ?? "unknown"}`));
    });
  });
}

async function ensureMcpDependencies(serverDir: string): Promise<void> {
  const nodeModulesDir = path.join(serverDir, "node_modules");
  if (fsSync.existsSync(nodeModulesDir)) {
    return;
  }
  try {
    await runCommand(getNpmBinary(), ["install"], { cwd: serverDir, env: process.env });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new Error(`akashic-mcpの依存インストールに失敗しました: ${message}`);
  }
}

async function fetchMcpTools(baseUrl: string, signal?: AbortSignal): Promise<FunctionToolDef[]> {
  const response = await fetch(`${baseUrl}/proxy/tools`, { signal });
  if (!response.ok) {
    throw new Error(`MCPツール一覧の取得に失敗しました: ${response.status}`);
  }
  const data = (await response.json().catch(() => null)) as
    | { tools?: McpTool[] }
    | McpTool[]
    | null;
  const tools = Array.isArray(data)
    ? data
    : Array.isArray(data?.tools)
      ? data.tools
      : [];

  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error("MCPツール一覧が空です。");
  }

  return tools.map((tool) => {
    const parameters =
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? { type: "object", ...tool.inputSchema }
        : { type: "object", properties: {}, additionalProperties: true };
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters,
    };
  });
}

export async function fetchMcpPrompt(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<McpPromptMessage[]> {
  const response = await fetch(`${baseUrl}/proxy/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`MCPプロンプトの取得に失敗しました: ${response.status}`);
  }
  const data = (await response.json().catch(() => null)) as McpPromptResponse | null;
  if (!data?.messages || !Array.isArray(data.messages)) {
    throw new Error("MCPプロンプトの形式が不正です。");
  }
  return data.messages;
}

function normalizePromptContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const anyContent = content as { type?: string; text?: string };
    if (typeof anyContent.text === "string") return anyContent.text;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => normalizePromptContent(item))
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
}

export function toInputMessagesFromPrompt(
  messages: McpPromptMessage[]
): Array<{ role: LlmRole; content: string }> {
  return messages
    .map((message) => {
      const role: LlmRole =
        message.role === "assistant" || message.role === "developer" ? message.role : "user";
      const content = normalizePromptContent(message.content);
      return { role, content };
    })
    .filter((entry) => entry.content.trim().length > 0);
}

export function toDeveloperMessagesFromPrompt(
  messages: McpPromptMessage[]
): Array<{ role: LlmRole; content: string }> {
  return messages
    .map((message) => {
      const content = normalizePromptContent(message.content);
      return { role: "developer" as LlmRole, content };
    })
    .filter((entry) => entry.content.trim().length > 0);
}

async function startLocalMcpServer(signal?: AbortSignal): Promise<McpServerInfo> {
  if (mcpServer?.process && mcpServer.process.exitCode == null) {
    return mcpServer;
  }

  const { entryPath, serverDir } = resolveMcpServerEntry();
  await ensureMcpDependencies(serverDir);
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(getNodeBinary(), [entryPath], {
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
  child.stdout?.on("data", (chunk) => console.log(String(chunk)));
  child.stderr?.on("data", (chunk) => console.error(String(chunk)));
  child.on("exit", () => {
    if (mcpServer?.process === child) {
      mcpServer = null;
    }
  });

  const deadline = Date.now() + 15000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error("MCPサーバー起動がキャンセルされました。");
    }
    try {
      const tools = await fetchMcpTools(baseUrl, signal);
      return { baseUrl, port, process: child, tools };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("MCPサーバーの起動に失敗しました。");
}

export async function ensureMcpServer(signal?: AbortSignal): Promise<McpServerInfo> {
  if (mcpServer?.tools && (!mcpServer.process || mcpServer.process.exitCode == null)) {
    return mcpServer;
  }
  mcpServer = await startLocalMcpServer(signal);
  return mcpServer;
}

function toToolOutputString(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  const anyPayload = payload as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  if (Array.isArray(anyPayload.content)) {
    const text = anyPayload.content
      .map((item) => (typeof item?.text === "string" ? item.text : JSON.stringify(item)))
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export async function callMcpTool(
  baseUrl: string,
  name: string,
  argsJson: string,
  signal?: AbortSignal
): Promise<string> {
  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      return JSON.stringify({ error: "ツール引数のJSON解析に失敗しました。", raw: argsJson });
    }
  }

  const response = await fetch(`${baseUrl}/proxy/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
    signal,
  });

  if (!response.ok) {
    return JSON.stringify({ error: `ツール呼び出しに失敗しました: ${response.status}` });
  }

  const data = await response.json().catch(() => null);
  return toToolOutputString(data);
}

export function shutdownMcpServer(): void {
  if (mcpServer?.process && mcpServer.process.exitCode == null) {
    mcpServer.process.kill();
  }
  mcpServer = null;
}
