import fs from "node:fs";
import path from "node:path";

/**
 * electron-builder は extraResources 配下の node_modules も依存解析の対象にして
 * 除外することがある。アプリ本体の展開後、アーカイブ作成前に直接配置する。
 *
 * @param {{ appOutDir: string; electronPlatformName: string; packager: { appInfo: { productFilename: string } } }} context
 */
export default async function afterPackMcp(context) {
  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const source = path.join(process.cwd(), "akashic-mcp", "node_modules");
  const destination = path.join(resourcesDir, "akashic-mcp", "node_modules");

  if (!fs.existsSync(source)) {
    throw new Error("akashic-mcp の node_modules が見つかりません。npm run prepare:mcp を先に実行してください。");
  }

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
  console.log(`[after-pack-mcp] Copied MCP dependencies to ${destination}`);
}
