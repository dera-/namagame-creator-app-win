import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const expectedSuffix = path.join(
  "akashic-mcp",
  "node_modules",
  "@modelcontextprotocol",
  "sdk",
  "package.json"
);

if (!fs.existsSync(distDir)) {
  throw new Error("パッケージ出力ディレクトリが見つかりません。");
}

const packagedFiles = fs.readdirSync(distDir, { recursive: true });
const found = packagedFiles.some((entry) => {
  const normalized = String(entry).replace(/\\/g, "/");
  return normalized.endsWith(expectedSuffix.replace(/\\/g, "/"));
});
if (!found) {
  throw new Error("配布物に akashic-mcp の依存パッケージが同梱されていません。");
}

console.log("[verify-embedded-mcp] MCP dependencies are bundled.");
