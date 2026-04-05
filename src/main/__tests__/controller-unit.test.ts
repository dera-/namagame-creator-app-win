import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMainController } from "../controller.js";

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "namagame-controller-unit-"));
}

async function createSourceProject(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "script"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "game.json"),
    JSON.stringify(
      {
        main: "./script/main.js",
        assets: {
          main: {
            type: "script",
            path: "script/main.js",
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );
  await fs.writeFile(path.join(dir, "script", "main.js"), "console.log('source');\n", "utf-8");
  await fs.writeFile(path.join(dir, ".DS_Store"), "ignored", "utf-8");
}

function createControllerHarness(options?: {
  listError?: Error;
  skipApiKeyCheck?: boolean;
}) {
  const prepareCalls: Array<{ projectDir: string; projectName: string }> = [];
  let generationCanceled = false;

  const controller = createMainController({
    createAiClient: () => ({
      models: {
        list: async () => {
          if (options?.listError) {
            throw options.listError;
          }
          return { data: [] };
        },
      },
      responses: {
        create: async () => {
          throw new Error("not used in unit test");
        },
      },
    }),
    getGenerationTimeoutMs: () => 1000,
    ensureProjectsDir: createTempDir,
    prepareGameFromProject: async (projectDir, projectName) => {
      prepareCalls.push({ projectDir, projectName });
      return {
        status: "success",
        projectDir,
        projectName,
        playgroundUrl: "play://unit",
        debugUrl: "debug://unit",
      };
    },
    generationDeps: {
      ensureMcpServer: async () => ({
        baseUrl: "http://mock",
        tools: [],
      }),
      fetchMcpPrompt: async () => [],
      toDeveloperMessagesFromPrompt: () => [],
      toInputMessagesFromPrompt: () => [],
      callMcpTool: async () => "ok",
      getToolCallMaxIterations: () => 1,
    },
    skipApiKeyCheck: options?.skipApiKeyCheck,
  });

  const originalCancel = controller.cancelGeneration;
  controller.cancelGeneration = () => {
    generationCanceled = true;
    return originalCancel();
  };

  return { controller, generationCanceledRef: () => generationCanceled, prepareCalls };
}

test("setAiConfig は skipApiKeyCheck 時でも入力値検証を行う", async () => {
  const { controller } = createControllerHarness({ skipApiKeyCheck: true });
  const result = await controller.setAiConfig({
    apiKey: "",
    designModel: "design",
    model: "impl",
  });
  assert.equal(result.ok, false);
  assert.match(result.errorMessage ?? "", /トークン/);
});

test("setAiConfig は API エラーを invalid_api_key に変換する", async () => {
  const error = Object.assign(new Error("Invalid API key"), { status: 401 });
  const { controller } = createControllerHarness({ listError: error });
  const result = await controller.setAiConfig({
    apiKey: "bad",
    designModel: "design",
    model: "impl",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "invalid_api_key");
});

test("loadProjectDir はプロジェクトをコピーして ignored metadata を除外する", async () => {
  const sourceDir = await createTempDir();
  await createSourceProject(sourceDir);
  const { controller, prepareCalls } = createControllerHarness({ skipApiKeyCheck: true });

  await controller.setAiConfig({
    apiKey: "token",
    designModel: "design",
    model: "impl",
  });
  const result = await controller.loadProjectDir(sourceDir);

  assert.equal(result.ok, true);
  assert.equal(prepareCalls.length, 1);
  assert.notEqual(result.game?.projectDir, sourceDir);
  await assert.rejects(fs.access(path.join(result.game!.projectDir!, ".DS_Store")));
  const historyState = controller.getState().conversation;
  assert.equal(historyState[0]?.pinned, true);
  assert.equal(historyState[0]?.hidden, true);
});

test("resetSession は状態を初期化し進行中生成を中断する", async () => {
  const { controller, generationCanceledRef } = createControllerHarness({ skipApiKeyCheck: true });

  await controller.setAiConfig({
    apiKey: "token",
    designModel: "design",
    model: "impl",
  });
  const sourceDir = await createTempDir();
  await createSourceProject(sourceDir);
  await controller.loadProjectDir(sourceDir);

  const result = controller.resetSession();
  assert.equal(result.ok, true);
  assert.deepEqual(controller.getHistory().history, []);
  assert.equal(controller.getState().currentGame.status, "idle");
  assert.equal(controller.getState().currentProjectOrigin, "none");
  assert.equal(generationCanceledRef(), false);
});
