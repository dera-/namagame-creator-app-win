import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "src", "renderer");
const targetDir = path.join(root, "script", "renderer");

await fs.mkdir(targetDir, { recursive: true });

for (const fileName of ["index.html", "index.css"]) {
  await fs.copyFile(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}
await fs.copyFile(path.join(root, "src", "preload.cjs"), path.join(root, "script", "preload.cjs"));

const playgroundDist = path.join(root, "playground", "dist");
const playgroundTarget = path.join(root, "script", "playground");

try {
  await fs.access(playgroundDist);
  await fs.rm(playgroundTarget, { recursive: true, force: true });
  await fs.cp(playgroundDist, playgroundTarget, { recursive: true });
} catch {
  // playground is optional during build.
}
