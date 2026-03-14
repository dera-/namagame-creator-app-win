import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import { app } from "electron";
import appLib from "@akashic/akashic-cli-sandbox/lib/app.js";
import {
  GAME_PATH,
  MIME_TYPES,
  PLAYGROUND_DIST_DIRNAME,
  PLAYGROUND_PATH,
  SANDBOX_PATH,
} from "./constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type LocalServer = {
  playgroundDir: string;
  port: number;
  server: ReturnType<typeof createServer>;
};

export type SandboxServer = {
  port: number;
  server: ReturnType<typeof createServer>;
  projectDir: string;
};

let localServer: LocalServer | null = null;
let sandboxServer: SandboxServer | null = null;

export function getRendererHtmlPath(): string {
  const appPath = app.getAppPath();
  return path.join(appPath, "script", "renderer", "index.html");
}

export function buildPlaygroundUrl(
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

export function resolvePlaygroundDir(): string {
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

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

export async function startSandboxServer(
  projectDir: string,
  options?: { forceRestart?: boolean }
): Promise<SandboxServer> {
  const forceRestart = options?.forceRestart === true;
  if (!forceRestart && sandboxServer && sandboxServer.projectDir === projectDir) {
    return sandboxServer;
  }
  if (sandboxServer) {
    await new Promise<void>((resolve) => sandboxServer?.server.close(() => resolve()));
    sandboxServer = null;
  }

  const port = await getAvailablePort();
  const appInstance = appLib({ gameBase: projectDir });
  appInstance.set("port", port);
  const server = createServer(appInstance);
  server.listen(port);
  server.on("close", () => {
    if (sandboxServer?.server === server) {
      sandboxServer = null;
    }
  });
  sandboxServer = { port, server, projectDir };
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

export function startLocalServer(
  playgroundDir: string,
  projectRegistry: Map<string, string>
): Promise<LocalServer> {
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
        const parts = requestPath.split("/").filter(Boolean);
        const projectId = parts[1];
        if (!projectId) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const projectDir = projectRegistry.get(projectId);
        if (!projectDir) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const activeSandbox = await startSandboxServer(projectDir);
        const redirectTarget = `http://127.0.0.1:${activeSandbox.port}/game/`;
        res.writeHead(302, { Location: redirectTarget });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    } catch {
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

export function closeLocalServer(): void {
  if (localServer) {
    localServer.server.close();
    localServer = null;
  }
}

export function closeSandboxServer(): void {
  if (sandboxServer) {
    sandboxServer.server.close();
    sandboxServer = null;
  }
}
