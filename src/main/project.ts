import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import { ConsoleLogger } from "@akashic/akashic-cli-commons";
import { promiseExportZip } from "@akashic/akashic-cli-export/lib/zip/exportZip.js";

const require = createRequire(import.meta.url);
const exportPackageJson = require("@akashic/akashic-cli-export/package.json") as {
  version?: string;
};

export type GenerationPayload = {
  projectName?: string;
  projectZipBase64?: string;
  projectDir?: string;
  summary?: string;
  detail?: string;
};

export type GameJson = {
  main?: string;
  assets?: Record<string, { type?: string; path?: string }>;
  environment?: {
    "sandbox-runtime"?: string;
    nicolive?: {
      supportedModes?: string[];
    };
  };
  width?: number;
  height?: number;
};

export function parseJsonFromText(text: string): GenerationPayload {
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

export function validateGenerationPayload(payload: GenerationPayload): string[] {
  const errors: string[] = [];
  if (!payload.projectName || typeof payload.projectName !== "string") {
    errors.push("projectNameがありません。");
  }
  if (!payload.summary || typeof payload.summary !== "string") {
    errors.push("summaryがありません。");
  }
  if (!payload.detail || typeof payload.detail !== "string") {
    errors.push("detailがありません。");
  }
  const hasDir = typeof payload.projectDir === "string" && payload.projectDir.length > 0;
  const hasZip =
    typeof payload.projectZipBase64 === "string" && payload.projectZipBase64.length > 0;
  if (!hasDir && !hasZip) {
    errors.push("projectDirまたはprojectZipBase64がありません。");
  }
  return errors;
}

export function normalizeBase64(input: string): string {
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

export async function readGameJsonIfExists(projectDir: string): Promise<GameJson | null> {
  const gameJsonPath = path.join(projectDir, "game.json");
  const raw = await fs.readFile(gameJsonPath, "utf-8").catch(() => "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameJson;
  } catch {
    return null;
  }
}

export function validateGameJson(gameJson: GameJson): string[] {
  const errors: string[] = [];
  if (!gameJson.main || typeof gameJson.main !== "string") {
    errors.push("game.jsonのmainがありません。");
  }
  if (!gameJson.assets || typeof gameJson.assets !== "object") {
    errors.push("game.jsonのassetsがありません。");
    return errors;
  }

  const assetKeys = Object.keys(gameJson.assets);
  if (assetKeys.length === 0) {
    errors.push("game.jsonのassetsが空です。");
  }

  if (gameJson.main) {
    if (!(/^\.\/.+\.js$/).test(gameJson.main)) {
      errors.push("mainの表記形式が誤っています。main: " + gameJson.main);
    }
    const mainScriptPath = gameJson.main.replace(/^\.\//, "");
    const assets = gameJson.assets as Record<string, { path?: string; type?: string }>;
    const mainAssets = Object.keys(assets)
      .filter((key) => assets[key].path === mainScriptPath)
      .map((key) => assets[key]);
    if (mainAssets.length === 0) {
      errors.push("mainに対応するassetsが見つかりません。");
    } else if (mainAssets[0].type && mainAssets[0].type !== "script") {
      errors.push("mainに対応するassetsのtypeがscriptではありません。");
    }
  }

  return errors;
}

export async function guardGameJsonAfterModify(
  previous: GameJson | null,
  projectDir: string
): Promise<{ restored: boolean; errors: string[] }> {
  const current = await readGameJsonIfExists(projectDir);
  if (!current) {
    console.warn("game.jsonが読み込めませんでした。");
    return { restored: false, errors: ["missing"] };
  }
  const errors = validateGameJson(current);
  console.log(errors);
  console.log(await fs.readFile(path.join(projectDir, "game.json")).toString());
  if (errors.length === 0) return { restored: false, errors: [] };

  if (previous) {
    const gameJsonPath = path.join(projectDir, "game.json");
    await fs.writeFile(gameJsonPath, JSON.stringify(previous, null, 2), "utf-8");
    console.warn(`game.jsonを復元しました: ${errors.join(" ")}`);
    return { restored: true, errors };
  }
  console.warn(`game.jsonの検証に失敗しました: ${errors.join(" ")}`);
  return { restored: false, errors };
}

export function assertZipBuffer(buffer: Buffer): void {
  if (buffer.length < 4) {
    throw new Error("zipデータが空です。");
  }
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("zipデータの署名が不正です。");
  }
}

export async function ensureEntryPoint(projectDir: string): Promise<void> {
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

  const candidates = ["script/main.js", "main.js", "src/main.js"];
  const resolveEntry = (entry: string): string => entry.replace(/^\.\//, "");

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

export async function readGameSize(projectDir: string): Promise<{ width: number; height: number }> {
  const raw = await fs.readFile(path.join(projectDir, "game.json"), "utf-8").catch(() => "");
  if (!raw) {
    return { width: 640, height: 480 };
  }
  try {
    const data = JSON.parse(raw) as GameJson;
    const width = Number(data.width) || 640;
    const height = Number(data.height) || 480;
    return { width, height };
  } catch {
    return { width: 640, height: 480 };
  }
}

function isIgnoredMetadataName(name: string): boolean {
  if (
    name === "__MACOSX" ||
    name === ".DS_Store" ||
    name === "Thumbs.db" ||
    name === "desktop.ini" ||
    name.startsWith("._")
  ) {
    return true;
  }
  return /Zone\.Identifier$/i.test(name);
}

export function isIgnoredMetadataPath(targetPath: string): boolean {
  return isIgnoredMetadataName(path.basename(targetPath));
}

export async function removeIgnoredMetadataFiles(rootDir: string): Promise<void> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (isIgnoredMetadataName(entry.name)) {
      await fs.rm(fullPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      await removeIgnoredMetadataFiles(fullPath);
    }
  }
}

type ProjectSnapshot = Map<string, string>;

async function collectProjectSnapshot(
  rootDir: string,
  currentDir: string,
  snapshot: ProjectSnapshot
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (isIgnoredMetadataName(entry.name) || entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectProjectSnapshot(rootDir, fullPath, snapshot);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const buffer = await fs.readFile(fullPath).catch(() => null);
    if (!buffer) {
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    snapshot.set(relativePath, digest);
  }
}

export async function createProjectSnapshot(projectDir: string): Promise<ProjectSnapshot> {
  const snapshot: ProjectSnapshot = new Map();
  await collectProjectSnapshot(projectDir, projectDir, snapshot);
  return snapshot;
}

export function hasProjectSnapshotChanges(
  previous: ProjectSnapshot,
  next: ProjectSnapshot
): boolean {
  if (previous.size !== next.size) {
    return true;
  }
  for (const [relativePath, digest] of previous.entries()) {
    if (next.get(relativePath) !== digest) {
      return true;
    }
  }
  return false;
}

function addDirectoryToZipFiltered(zip: AdmZip, rootDir: string, currentDir: string): void {
  const entries = fsSync.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (isIgnoredMetadataPath(fullPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      addDirectoryToZipFiltered(zip, rootDir, fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath);
    const zipDir = path.dirname(relativePath).replace(/\\/g, "/").replace(/^\.$/, "");
    zip.addLocalFile(fullPath, zipDir, path.basename(fullPath));
  }
}

export async function createZipFromDir(sourceDir: string, outputPath: string): Promise<void> {
  const zip = new AdmZip();
  addDirectoryToZipFiltered(zip, sourceDir, sourceDir);
  zip.writeZip(outputPath);
}

export async function createNicoliveZip(projectDir: string, outputPath: string): Promise<void> {
  const logger = new ConsoleLogger({ quiet: true });
  const version = exportPackageJson.version ?? "unknown";
  const exportSourceDir = await prepareProjectForNicoliveExport(projectDir);

  try {
    await promiseExportZip({
      bundle: true,
      babel: true,
      minify: undefined,
      minifyJs: undefined,
      minifyJson: undefined,
      terser: undefined,
      packImage: undefined,
      strip: true,
      source: exportSourceDir,
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
  } finally {
    if (exportSourceDir !== projectDir) {
      await fs.rm(exportSourceDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function prepareProjectForNicoliveExport(projectDir: string): Promise<string> {
  const gameJson = await readGameJsonIfExists(projectDir);
  if (!gameJson) {
    throw new Error("game.jsonが見つかりません。");
  }

  const nextGameJson = structuredClone(gameJson);
  nextGameJson.environment ??= {};
  nextGameJson.environment["sandbox-runtime"] ??= "3";
  nextGameJson.environment.nicolive ??= {};
  nextGameJson.environment.nicolive.supportedModes =
    nextGameJson.environment.nicolive.supportedModes?.length
      ? nextGameJson.environment.nicolive.supportedModes
      : ["ranking"];

  if (JSON.stringify(nextGameJson) === JSON.stringify(gameJson)) {
    return projectDir;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "namagame-nicolive-"));
  await fs.cp(projectDir, tempDir, { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "game.json"),
    `${JSON.stringify(nextGameJson, null, 2)}\n`,
    "utf-8"
  );
  return tempDir;
}
