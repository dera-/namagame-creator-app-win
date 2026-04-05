import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertZipBuffer,
  createProjectSnapshot,
  ensureEntryPoint,
  hasProjectSnapshotChanges,
  isIgnoredMetadataPath,
  normalizeBase64,
  parseJsonFromText,
  prepareProjectForNicoliveExport,
  readGameSize,
  restoreProjectSnapshot,
  validateGameJson,
  validateGenerationPayload,
} from "../project.js";

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "namagame-project-unit-"));
}

async function writeGameJson(projectDir: string, gameJson: object): Promise<void> {
  await fs.writeFile(path.join(projectDir, "game.json"), JSON.stringify(gameJson, null, 2), "utf-8");
}

test("parseJsonFromText は通常JSONと fenced json を解釈できる", () => {
  const plain = parseJsonFromText('{"projectName":"a","projectDir":"/tmp/a"}');
  assert.equal(plain.projectDir, "/tmp/a");

  const fenced = parseJsonFromText('```json\n{"projectName":"b","projectZipBase64":"UEs="}\n```');
  assert.equal(fenced.projectZipBase64, "UEs=");
});

test("validateGenerationPayload は不足項目を列挙する", () => {
  const errors = validateGenerationPayload({});
  assert.deepEqual(errors, [
    "projectNameがありません。",
    "summaryがありません。",
    "detailがありません。",
    "projectDirまたはprojectZipBase64がありません。",
  ]);
});

test("normalizeBase64 は data URL と空白を正規化する", () => {
  assert.equal(normalizeBase64("data:application/zip;base64,UE s"), "UEs=");
});

test("validateGameJson は main/assets の不整合を検出する", () => {
  const errors = validateGameJson({
    main: "script/main.js",
    assets: {
      main: {
        type: "text",
        path: "script/main.js",
      },
    },
  });
  assert.ok(errors.some((error) => error.includes("mainの表記形式")));
  assert.ok(errors.some((error) => error.includes("typeがscriptではありません")));
});

test("assertZipBuffer は zip 署名を検証する", () => {
  assert.doesNotThrow(() => assertZipBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
  assert.throws(() => assertZipBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03])), /署名/);
});

test("ensureEntryPoint は fallback のエントリポイントを書き戻す", async () => {
  const projectDir = await createTempDir();
  await fs.mkdir(path.join(projectDir, "script"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "script", "main.js"), "console.log('ok');\n", "utf-8");
  await writeGameJson(projectDir, {
    main: "./missing.js",
    assets: {
      main: {
        type: "script",
        path: "script/main.js",
      },
    },
  });

  await ensureEntryPoint(projectDir);

  const gameJson = JSON.parse(await fs.readFile(path.join(projectDir, "game.json"), "utf-8")) as {
    main: string;
  };
  assert.equal(gameJson.main, "script/main.js");
});

test("readGameSize は不正値時にデフォルト値を返す", async () => {
  const projectDir = await createTempDir();
  await writeGameJson(projectDir, { width: "x", height: null });
  const size = await readGameSize(projectDir);
  assert.deepEqual(size, { width: 640, height: 480 });
});

test("isIgnoredMetadataPath は無視対象ファイルを判定する", () => {
  assert.equal(isIgnoredMetadataPath("/tmp/.DS_Store"), true);
  assert.equal(isIgnoredMetadataPath("/tmp/game.json"), false);
});

test("snapshot 系は差分検知と復元ができる", async () => {
  const projectDir = await createTempDir();
  await fs.mkdir(path.join(projectDir, "script"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "script", "main.js"), "console.log('before');\n", "utf-8");

  const before = await createProjectSnapshot(projectDir);

  await fs.writeFile(path.join(projectDir, "script", "main.js"), "console.log('after');\n", "utf-8");
  await fs.writeFile(path.join(projectDir, "extra.txt"), "extra\n", "utf-8");
  const after = await createProjectSnapshot(projectDir);

  assert.equal(hasProjectSnapshotChanges(before, after), true);

  await restoreProjectSnapshot(projectDir, before);
  const restored = await fs.readFile(path.join(projectDir, "script", "main.js"), "utf-8");
  assert.equal(restored, "console.log('before');\n");
  await assert.rejects(fs.access(path.join(projectDir, "extra.txt")));
});

test("prepareProjectForNicoliveExport は必要な environment を補完した別ディレクトリを返す", async () => {
  const projectDir = await createTempDir();
  await writeGameJson(projectDir, {
    main: "./script/main.js",
    assets: {
      main: { type: "script", path: "script/main.js" },
    },
  });

  const exportDir = await prepareProjectForNicoliveExport(projectDir);
  assert.notEqual(exportDir, projectDir);

  const gameJson = JSON.parse(await fs.readFile(path.join(exportDir, "game.json"), "utf-8")) as {
    environment?: { "sandbox-runtime"?: string; nicolive?: { supportedModes?: string[] } };
  };
  assert.equal(gameJson.environment?.["sandbox-runtime"], "3");
  assert.deepEqual(gameJson.environment?.nicolive?.supportedModes, ["ranking"]);
});
