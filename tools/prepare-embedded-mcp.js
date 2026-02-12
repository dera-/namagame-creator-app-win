import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mcpDir = path.join(root, "akashic-mcp");
const mcpNodeModulesDir = path.join(mcpDir, "node_modules");
const requiredPackageDir = path.join(mcpNodeModulesDir, "@modelcontextprotocol", "sdk");

function runInstall() {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const hasLockfile = fs.existsSync(path.join(mcpDir, "package-lock.json"));
  const args = hasLockfile ? ["ci", "--omit=dev"] : ["install", "--omit=dev"];
  const result = spawnSync(npmCmd, args, {
    cwd: mcpDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to install akashic-mcp dependencies. exit=${result.status ?? "unknown"}`);
  }
}

if (!fs.existsSync(requiredPackageDir)) {
  runInstall();
}
