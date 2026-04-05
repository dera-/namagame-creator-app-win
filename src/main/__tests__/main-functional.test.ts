import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildImportedProjectConversationPrompt,
  IMPLEMENT_PROMPT_HISTORY_MARKER,
} from "../generation.js";
import { createMainController } from "../controller.js";

type ResponseRecord = {
  model: unknown;
  input: unknown;
  previousResponseId?: unknown;
};

type ToolCallRecord = {
  name: string;
  args: Record<string, unknown>;
};

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "namagame-main-test-"));
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition timed out");
}

async function writeProject(projectDir: string, mainContent = "console.log('initial');\n"): Promise<void> {
  await fs.mkdir(path.join(projectDir, "script"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "game.json"),
    JSON.stringify(
      {
        width: 640,
        height: 480,
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
  await fs.writeFile(path.join(projectDir, "script", "main.js"), mainContent, "utf-8");
}

function toDeveloperMessagesFromPrompt(
  messages: Array<{ role?: string; content?: unknown }>
): Array<{ role: "developer"; content: string }> {
  return messages
    .map((message) => ({
      role: "developer" as const,
      content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
    }))
    .filter((entry) => entry.content.trim().length > 0);
}

function toInputMessagesFromPrompt(
  messages: Array<{ role?: string; content?: unknown }>
): Array<{ role: "user" | "assistant" | "developer"; content: string }> {
  return messages
    .map((message) => ({
      role: (
        message.role === "assistant" || message.role === "developer"
          ? message.role
          : "user"
      ) as "user" | "assistant" | "developer",
      content: typeof message.content === "string" ? message.content : String(message.content ?? ""),
    }))
    .filter((entry) => entry.content.trim().length > 0);
}

function createHarness(options?: {
  listError?: Error;
  onResponseCreate?: (
    body: Record<string, unknown>,
    request: { signal?: AbortSignal },
    records: ResponseRecord[]
  ) => Promise<Record<string, unknown>>;
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<string>;
}) {
  const responseRecords: ResponseRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const abortSignals: AbortSignal[] = [];
  const preparedProjects: Array<{ projectDir: string; projectName: string }> = [];
  const promptArgs: Array<{ name: string; args: Record<string, unknown> }> = [];

  const controller = createMainController({
    createAiClient: () => ({
      models: {
        list: async ({ signal } = {}) => {
          if (signal) abortSignals.push(signal);
          if (options?.listError) {
            throw options.listError;
          }
          return { data: [] };
        },
      },
      responses: {
        create: async (body, request) => {
          if (request?.signal) {
            abortSignals.push(request.signal);
          }
          responseRecords.push({
            model: body.model,
            input: body.input,
            previousResponseId: body.previous_response_id,
          });
          return (await options?.onResponseCreate?.(body, request ?? {}, responseRecords)) as never;
        },
      },
    }),
    getGenerationTimeoutMs: () => 60_000,
    ensureProjectsDir: async () => {
      const dir = await createTempDir();
      return dir;
    },
    prepareGameFromProject: async (projectDir, projectName) => {
      preparedProjects.push({ projectDir, projectName });
      return {
        status: "success",
        projectDir,
        projectName,
        playgroundUrl: `play://${projectName}`,
        debugUrl: `debug://${projectName}`,
        isMultiplayer: false,
      };
    },
    generationDeps: {
      ensureMcpServer: async () => ({
        baseUrl: "http://mock-mcp",
        tools: [
          {
            type: "function",
            name: "create_game_file",
            parameters: { type: "object", properties: {}, additionalProperties: true },
          },
          {
            type: "function",
            name: "read_project_files",
            parameters: { type: "object", properties: {}, additionalProperties: true },
          },
        ],
      }),
      fetchMcpPrompt: async (_baseUrl, name, args) => {
        promptArgs.push({ name, args });
        if (name === "implement_niconama_game") {
          return [{ role: "developer", content: "IMPLEMENT REQUIREMENTS PROMPT" }];
        }
        if (name === "design_niconama_game") {
          return [{ role: "developer", content: "DESIGN REQUIREMENTS PROMPT" }];
        }
        return [];
      },
      toDeveloperMessagesFromPrompt,
      toInputMessagesFromPrompt,
      callMcpTool: async (_baseUrl, name, rawArgs) => {
        const args = JSON.parse(rawArgs) as Record<string, unknown>;
        toolCalls.push({ name, args });
        if (name === "create_game_file") {
          const directoryName = String(args.directoryName);
          const filePath = String(args.filePath);
          const content = String(args.content ?? "");
          await fs.mkdir(path.join(directoryName, path.dirname(filePath)), { recursive: true });
          await fs.writeFile(path.join(directoryName, filePath), content, "utf-8");
          if (options?.onToolCall) {
            return options.onToolCall(name, args);
          }
          return "ok";
        }
        if (options?.onToolCall) {
          return options.onToolCall(name, args);
        }
        return "ok";
      },
      getToolCallMaxIterations: () => 8,
    },
  });

  return { abortSignals, controller, preparedProjects, promptArgs, responseRecords, toolCalls };
}

function jsonResult(projectDir: string, projectName = "demo"): string {
  return JSON.stringify({
    projectName,
    projectDir,
    summary: "summary",
    detail: "detail",
  });
}

function getInputTexts(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const content = (entry as { content?: unknown }).content;
      return typeof content === "string" ? content : "";
    })
    .filter(Boolean);
}

function getLastImplementTargetDir(
  promptArgs: Array<{ name: string; args: Record<string, unknown> }>
): string {
  for (let index = promptArgs.length - 1; index >= 0; index -= 1) {
    const entry = promptArgs[index];
    if (entry.name === "implement_niconama_game" && typeof entry.args.targetDir === "string") {
      return entry.args.targetDir;
    }
  }
  return "";
}

function getLastNonEmptyPromptTexts(promptHistory: string[][]): string[] {
  for (let index = promptHistory.length - 1; index >= 0; index -= 1) {
    if (promptHistory[index].length > 0) {
      return promptHistory[index];
    }
  }
  return [];
}

test("生成AI設定: 有効なトークンで選択した設計モデルと実装モデルが利用される", async () => {
  let targetDir = "";
  const harness = createHarness({
    onResponseCreate: async (body, _request, records) => {
      if (records.length === 1) {
        return { id: "design-1", output: [], output_text: "designed prompt" };
      }
      const inputTexts = getInputTexts(body.input);
      if (records.length === 2) {
        targetDir = getLastImplementTargetDir(harness.promptArgs);
        assert.equal(body.model, "impl-model");
        assert.ok(inputTexts.includes("ゲーム設計文:\ndesigned prompt"));
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: targetDir,
                filePath: "game.json",
                content:
                  '{"main":"./script/main.js","assets":{"main":{"type":"script","path":"script/main.js"}}}',
              }),
              call_id: "call-1",
            },
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: targetDir,
                filePath: "script/main.js",
                content: "console.log('configured');\n",
              }),
              call_id: "call-2",
            },
          ],
          output_text: "",
        };
      }
      return { id: "impl-2", output: [], output_text: jsonResult(targetDir, "configured") };
    },
  });
  const config = await harness.controller.setAiConfig({
    apiKey: "valid-token",
    designModel: "design-model",
    model: "impl-model",
  });
  assert.equal(config.ok, true);
  const result = await harness.controller.generateGame({
    mode: "create",
    prompt: "モデル確認",
    useDesignModel: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    harness.responseRecords.map((record) => record.model),
    ["design-model", "impl-model", "impl-model"]
  );
});

test("生成AI設定: 設定後も会話履歴はクリアされない", async () => {
  const harness = createHarness({
    onResponseCreate: async (_body) => {
      const targetDir = getLastImplementTargetDir(harness.promptArgs);
      await writeProject(targetDir);
      return {
        id: `impl-${randomUUID()}`,
        output: [],
        output_text: jsonResult(targetDir, "history-demo"),
      };
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token-1",
    designModel: "design-model",
    model: "impl-model",
  });
  const result = await harness.controller.generateGame({
    mode: "create",
    prompt: "履歴を残して生成",
    useDesignModel: false,
  });
  assert.equal(result.ok, true);
  const before = harness.controller.getHistory().history;
  const reconfig = await harness.controller.setAiConfig({
    apiKey: "token-2",
    designModel: "design-model-2",
    model: "impl-model-2",
  });
  assert.equal(reconfig.ok, true);
  assert.deepEqual(harness.controller.getHistory().history, before);
});

test("生成AI設定: 設計モデル未選択・実装モデル未選択・トークン未入力はエラーになる", async () => {
  const harness = createHarness();
  const missingDesign = await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "",
    model: "impl-model",
  });
  assert.equal(missingDesign.ok, false);
  assert.match(missingDesign.errorMessage ?? "", /設計モデル/);

  const missingImpl = await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "",
  });
  assert.equal(missingImpl.ok, false);
  assert.match(missingImpl.errorMessage ?? "", /実装モデル/);

  const missingToken = await harness.controller.setAiConfig({
    apiKey: "",
    designModel: "design-model",
    model: "impl-model",
  });
  assert.equal(missingToken.ok, false);
  assert.match(missingToken.errorMessage ?? "", /トークン/);
});

test("生成AI設定: 無効なトークンはエラーになる", async () => {
  const error = Object.assign(new Error("Invalid API key"), { status: 401 });
  const harness = createHarness({ listError: error });
  const result = await harness.controller.setAiConfig({
    apiKey: "invalid-token",
    designModel: "design-model",
    model: "impl-model",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "invalid_api_key");
});

test("ゲーム生成: 入力テキスト・実装要件・設計モデル生成文・game.json更新禁止が実装モデルに渡る", async () => {
  let targetDir = "";
  const harness = createHarness({
    onResponseCreate: async (body, _request, records) => {
      if (records.length === 1) {
        assert.equal(body.model, "design-model");
        return { id: "design-1", output: [], output_text: "DESIGN DOC" };
      }
      if (records.length === 2) {
        targetDir = getLastImplementTargetDir(harness.promptArgs);
        const inputTexts = getInputTexts(body.input);
        assert.equal(body.model, "impl-model");
        assert.ok(inputTexts.includes("IMPLEMENT REQUIREMENTS PROMPT"));
        assert.ok(inputTexts.includes("ゲーム設計文:\nDESIGN DOC"));
        assert.ok(inputTexts.some((text) => text.includes("ユーザーの生成依頼")));
        assert.ok(
          inputTexts.some((text) =>
            text.includes("[注意] game.jsonはakashic_scan_asset以外で更新しないでください。")
          )
        );
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: targetDir,
                filePath: "game.json",
                content:
                  '{"main":"./script/main.js","assets":{"main":{"type":"script","path":"script/main.js"}}}',
              }),
              call_id: "call-1",
            },
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: targetDir,
                filePath: "script/main.js",
                content: "console.log('generated');\n",
              }),
              call_id: "call-2",
            },
          ],
          output_text: "",
        };
      }
      return { id: "impl-2", output: [], output_text: jsonResult(targetDir, "generated") };
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const result = await harness.controller.generateGame({
    mode: "create",
    prompt: "ユーザーの生成依頼",
    forbidGameJsonUpdate: true,
    useDesignModel: true,
  });
  assert.equal(result.ok, true);
});

test("ゲーム生成: 既存プロジェクトを読み込める", async () => {
  const sourceDir = await createTempDir();
  await writeProject(sourceDir, "console.log('loaded');\n");
  const harness = createHarness();
  const loaded = await harness.controller.loadProjectDir(sourceDir);
  assert.equal(loaded.ok, true);
  assert.ok(loaded.game?.projectDir);
  assert.notEqual(loaded.game?.projectDir, sourceDir);
  const copiedMain = await fs.readFile(path.join(loaded.game!.projectDir!, "script", "main.js"), "utf-8");
  assert.equal(copiedMain, "console.log('loaded');\n");
});

test("ゲーム生成キャンセル: APIを中断し、生成前のプロジェクト状態へ戻す", async () => {
  let started = false;
  let resolveToolWrite: (() => void) | null = null;
  const toolWritten = new Promise<void>((resolve) => {
    resolveToolWrite = resolve;
  });
  const originalDir = await createTempDir();
  await writeProject(originalDir, "console.log('stable');\n");
  const harness = createHarness({
    onResponseCreate: async (body, request, records) => {
      if (records.length === 1) {
        const targetDir = path.join(await createTempDir(), randomUUID());
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: targetDir,
                filePath: "game.json",
                content:
                  '{"main":"./script/main.js","assets":{"main":{"type":"script","path":"script/main.js"}}}',
              }),
              call_id: "call-1",
            },
          ],
          output_text: "",
        };
      }
      started = true;
      return await new Promise((_resolve, reject) => {
        if (request.signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        request.signal?.addEventListener(
          "abort",
          () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true }
        );
      });
    },
    onToolCall: async () => {
      resolveToolWrite?.();
      return "ok";
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const loaded = await harness.controller.loadProjectDir(originalDir);
  assert.equal(loaded.ok, true);

  const generatePromise = harness.controller.generateGame({
    mode: "create",
    prompt: "キャンセルしたい生成",
    useDesignModel: false,
  });
  await toolWritten;
  const cancel = harness.controller.cancelGeneration();
  assert.equal(cancel.ok, true);
  const result = await generatePromise;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "canceled");
  assert.equal(started, true);
  assert.ok(harness.abortSignals.some((signal) => signal.aborted));
  const stableMain = await fs.readFile(path.join(loaded.game!.projectDir!, "script", "main.js"), "utf-8");
  assert.equal(stableMain, "console.log('stable');\n");
});

test("ゲーム修正: コード更新と会話履歴更新が行われる", async () => {
  const sourceDir = await createTempDir();
  await writeProject(sourceDir);
  let loadedDir = "";
  const harness = createHarness({
    onResponseCreate: async (body, _request, records) => {
      if (records.length === 1) {
        const inputTexts = getInputTexts(body.input);
        const projectPrompt = buildImportedProjectConversationPrompt();
        assert.equal(inputTexts[0], "IMPLEMENT REQUIREMENTS PROMPT");
        assert.ok(inputTexts.includes(projectPrompt));
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: loadedDir,
                filePath: "script/main.js",
                content: "console.log('modified once');\n",
              }),
              call_id: "call-1",
            },
          ],
          output_text: "",
        };
      }
      return {
        id: "impl-2",
        output: [],
        output_text: jsonResult(loadedDir, "loaded-project"),
      };
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const loaded = await harness.controller.loadProjectDir(sourceDir);
  assert.equal(loaded.ok, true);
  loadedDir = loaded.game!.projectDir!;
  const result = await harness.controller.generateGame({
    mode: "modify",
    prompt: "敵の動きを変えて",
    useDesignModel: false,
  });
  assert.equal(result.ok, true);
  const mainJs = await fs.readFile(path.join(loaded.game!.projectDir!, "script", "main.js"), "utf-8");
  assert.equal(mainJs, "console.log('modified once');\n");
  const history = harness.controller.getHistory().history;
  assert.equal(history.length, 2);
  assert.equal(history[0].content, "敵の動きを変えて");
});

test("ゲーム修正: 実装要件プロンプトと既存プロジェクト修正用プロンプトが先頭に残り続ける", async () => {
  const sourceDir = await createTempDir();
  await writeProject(sourceDir);
  let modifyCount = 0;
  let loadedDir = "";
  const harness = createHarness({
    onResponseCreate: async (body, _request, records) => {
      if (!body.previous_response_id) {
        modifyCount += 1;
        const inputTexts = getInputTexts(body.input);
        assert.equal(inputTexts[0], "IMPLEMENT REQUIREMENTS PROMPT");
        assert.ok(inputTexts.includes(buildImportedProjectConversationPrompt()));
        assert.ok(
          inputTexts.findIndex((text) => text.includes(IMPLEMENT_PROMPT_HISTORY_MARKER)) <
            inputTexts.findIndex((text) => text.includes("1回目の修正"))
        );
        return {
          id: `impl-${records.length}`,
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: loadedDir,
                filePath: "script/main.js",
                content: `console.log('modify ${modifyCount}');\n`,
              }),
              call_id: `call-${records.length}`,
            },
          ],
          output_text: "",
        };
      }
      return { id: `done-${records.length}`, output: [], output_text: jsonResult(loadedDir, "loaded-project") };
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const loaded = await harness.controller.loadProjectDir(sourceDir);
  assert.equal(loaded.ok, true);
  loadedDir = loaded.game!.projectDir!;
  const first = await harness.controller.generateGame({
    mode: "modify",
    prompt: "1回目の修正",
    useDesignModel: false,
  });
  assert.equal(first.ok, true);
  const second = await harness.controller.generateGame({
    mode: "modify",
    prompt: "2回目の修正",
    useDesignModel: false,
  });
  assert.equal(second.ok, true);
});

test("ゲーム修正キャンセル: APIを中断し、修正前のプロジェクト状態へ戻す", async () => {
  const sourceDir = await createTempDir();
  await writeProject(sourceDir, "console.log('before modify');\n");
  let resolveToolWrite: (() => void) | null = null;
  const toolWritten = new Promise<void>((resolve) => {
    resolveToolWrite = resolve;
  });
  const harness = createHarness({
    onResponseCreate: async (body, request) => {
      const loadedDir = harness.controller.getState().currentGame.projectDir!;
      if (!body.previous_response_id) {
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: loadedDir,
                filePath: "script/main.js",
                content: "console.log('modified then canceled');\n",
              }),
              call_id: "call-1",
            },
          ],
          output_text: "",
        };
      }
      return await new Promise((_resolve, reject) => {
        if (request.signal?.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        request.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true }
        );
      });
    },
    onToolCall: async () => {
      resolveToolWrite?.();
      return "ok";
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const loaded = await harness.controller.loadProjectDir(sourceDir);
  assert.equal(loaded.ok, true);
  const modifyPromise = harness.controller.generateGame({
    mode: "modify",
    prompt: "修正中にキャンセル",
    useDesignModel: false,
  });
  await toolWritten;
  const cancel = harness.controller.cancelGeneration();
  assert.equal(cancel.ok, true);
  const result = await modifyPromise;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "canceled");
  const mainJs = await fs.readFile(path.join(loaded.game!.projectDir!, "script", "main.js"), "utf-8");
  assert.equal(mainJs, "console.log('before modify');\n");
});

test("ゲーム生成キャンセル後の再生成では、キャンセル時の入力やAPI処理が残らず新しい入力だけで実行される", async () => {
  let pendingApiRuns = 0;
  let resolveToolWrite: (() => void) | null = null;
  const toolWritten = new Promise<void>((resolve) => {
    resolveToolWrite = resolve;
  });
  const seenPrompts: string[][] = [];

  const harness = createHarness({
    onResponseCreate: async (body, request, records) => {
      const inputTexts = getInputTexts(body.input);
      seenPrompts.push(inputTexts);
      const targetDir = getLastImplementTargetDir(harness.promptArgs);

      if (records.length === 1) {
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: targetDir,
                filePath: "game.json",
                content:
                  '{"main":"./script/main.js","assets":{"main":{"type":"script","path":"script/main.js"}}}',
              }),
              call_id: "call-1",
            },
          ],
          output_text: "",
        };
      }

      if (records.length === 2) {
        pendingApiRuns += 1;
        return await new Promise((_resolve, reject) => {
          if (request.signal?.aborted) {
            pendingApiRuns -= 1;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          request.signal?.addEventListener(
            "abort",
            () => {
              pendingApiRuns -= 1;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        });
      }

      await writeProject(targetDir, "console.log('after cancel');\n");
      return {
        id: `impl-${records.length}`,
        output: [],
        output_text: jsonResult(targetDir, "after-cancel"),
      };
    },
    onToolCall: async () => {
      resolveToolWrite?.();
      return "ok";
    },
  });

  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });

  const canceledPromise = harness.controller.generateGame({
    mode: "create",
    prompt: "キャンセルする生成",
    useDesignModel: false,
  });
  await toolWritten;
  await waitForCondition(() => pendingApiRuns === 1);
  assert.equal(pendingApiRuns, 1);
  assert.equal(harness.controller.cancelGeneration().ok, true);
  const canceled = await canceledPromise;
  assert.equal(canceled.ok, false);
  assert.equal(canceled.errorCode, "canceled");
  assert.equal(pendingApiRuns, 0);
  assert.deepEqual(harness.controller.getHistory().history, []);

  const retried = await harness.controller.generateGame({
    mode: "create",
    prompt: "キャンセル後の再生成",
    useDesignModel: false,
  });
  assert.equal(retried.ok, true);
  const retryInputTexts = getLastNonEmptyPromptTexts(seenPrompts);
  assert.ok(retryInputTexts.some((text) => text.includes("キャンセル後の再生成")));
  assert.ok(retryInputTexts.every((text) => !text.includes("キャンセルする生成")));
  const history = harness.controller.getHistory().history;
  assert.equal(history.length, 2);
  assert.equal(history[0].content, "キャンセル後の再生成");
});

test("ゲーム修正キャンセル後の再修正では、キャンセル時の入力やAPI処理が残らず新しい入力だけで実行される", async () => {
  const sourceDir = await createTempDir();
  await writeProject(sourceDir, "console.log('before retry modify');\n");
  let loadedDir = "";
  let pendingApiRuns = 0;
  let resolveToolWrite: (() => void) | null = null;
  const toolWritten = new Promise<void>((resolve) => {
    resolveToolWrite = resolve;
  });
  const seenPrompts: string[][] = [];

  const harness = createHarness({
    onResponseCreate: async (body, request, records) => {
      const inputTexts = getInputTexts(body.input);
      seenPrompts.push(inputTexts);
      const isContinuation = Boolean(body.previous_response_id);
      const hasCanceledPrompt = inputTexts.some((text) => text.includes("キャンセルする修正"));
      const hasRetryPrompt = inputTexts.some((text) => text.includes("キャンセル後の再修正"));

      if (!isContinuation && hasCanceledPrompt) {
        return {
          id: "impl-1",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: loadedDir,
                filePath: "script/main.js",
                content: "console.log('modified then canceled');\n",
              }),
              call_id: "call-1",
            },
          ],
          output_text: "",
        };
      }

      if (isContinuation && records.length === 2) {
        pendingApiRuns += 1;
        return await new Promise((_resolve, reject) => {
          if (request.signal?.aborted) {
            pendingApiRuns -= 1;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          request.signal?.addEventListener(
            "abort",
            () => {
              pendingApiRuns -= 1;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            },
            { once: true }
          );
        });
      }

      if (!isContinuation && hasRetryPrompt) {
        return {
          id: "impl-3",
          output: [
            {
              type: "function_call",
              name: "create_game_file",
              arguments: JSON.stringify({
                directoryName: loadedDir,
                filePath: "script/main.js",
                content: "console.log('retry modify');\n",
              }),
              call_id: "call-3",
            },
          ],
          output_text: "",
        };
      }

      return {
        id: `impl-${records.length}`,
        output: [],
        output_text: jsonResult(loadedDir, "retry-modify"),
      };
    },
    onToolCall: async () => {
      resolveToolWrite?.();
      return "ok";
    },
  });

  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const loaded = await harness.controller.loadProjectDir(sourceDir);
  assert.equal(loaded.ok, true);
  loadedDir = loaded.game!.projectDir!;

  const canceledPromise = harness.controller.generateGame({
    mode: "modify",
    prompt: "キャンセルする修正",
    useDesignModel: false,
  });
  await toolWritten;
  await waitForCondition(() => pendingApiRuns === 1);
  assert.equal(pendingApiRuns, 1);
  assert.equal(harness.controller.cancelGeneration().ok, true);
  const canceled = await canceledPromise;
  assert.equal(canceled.ok, false);
  assert.equal(canceled.errorCode, "canceled");
  assert.equal(pendingApiRuns, 0);
  assert.deepEqual(harness.controller.getHistory().history, []);

  const retried = await harness.controller.generateGame({
    mode: "modify",
    prompt: "キャンセル後の再修正",
    useDesignModel: false,
  });
  assert.equal(retried.ok, true);
  const retryInputTexts = getLastNonEmptyPromptTexts(seenPrompts);
  assert.ok(retryInputTexts.some((text) => text.includes("キャンセル後の再修正")));
  assert.ok(retryInputTexts.every((text) => !text.includes("キャンセルする修正")));
  const history = harness.controller.getHistory().history;
  assert.equal(history.length, 2);
  assert.equal(history[0].content, "キャンセル後の再修正");
  const mainJs = await fs.readFile(path.join(loaded.game!.projectDir!, "script", "main.js"), "utf-8");
  assert.equal(mainJs, "console.log('retry modify');\n");
});

test("リセット: 次回生成は新規プロジェクトになり、会話履歴もリセットされる", async () => {
  let createdDirs: string[] = [];
  const harness = createHarness({
    onResponseCreate: async (_body, _request, records) => {
      const targetDir = getLastImplementTargetDir(harness.promptArgs);
      createdDirs.push(targetDir);
      await writeProject(targetDir, `console.log('create ${records.length}');\n`);
      return { id: `impl-${records.length}`, output: [], output_text: jsonResult(targetDir, `project-${records.length}`) };
    },
  });
  await harness.controller.setAiConfig({
    apiKey: "token",
    designModel: "design-model",
    model: "impl-model",
  });
  const first = await harness.controller.generateGame({
    mode: "create",
    prompt: "最初の生成",
    useDesignModel: false,
  });
  assert.equal(first.ok, true);
  assert.equal(harness.controller.getHistory().history.length, 2);
  harness.controller.resetSession();
  assert.equal(harness.controller.getHistory().history.length, 0);
  const second = await harness.controller.generateGame({
    mode: "create",
    prompt: "リセット後の生成",
    useDesignModel: false,
  });
  assert.equal(second.ok, true);
  assert.notEqual(createdDirs[0], createdDirs[1]);
  const history = harness.controller.getHistory().history;
  assert.equal(history.length, 2);
  assert.equal(history[0].content, "リセット後の生成");
});
