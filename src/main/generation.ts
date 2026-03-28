import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import OpenAI from "openai";
import type {
  AiConfig,
  GenerateRequest,
  GenerateResult,
  GameInfo,
  LlmRole,
} from "../shared/types.js";
import {
  callMcpTool,
  ensureMcpServer,
  fetchMcpPrompt,
  getToolCallMaxIterations,
  toDeveloperMessagesFromPrompt,
  toInputMessagesFromPrompt,
  type ResponseFunctionToolCall,
} from "./mcp.js";
import {
  assertZipBuffer,
  createProjectSnapshot,
  guardGameJsonAfterModify,
  hasProjectSnapshotChanges,
  normalizeBase64,
  parseJsonFromText,
  readGameJsonIfExists,
  removeIgnoredMetadataFiles,
  validateGenerationPayload,
  type GenerationPayload,
  type GameJson,
} from "./project.js";

export type ConversationEntry = {
  role: LlmRole;
  content: string;
  summary?: string;
  hidden?: boolean;
};

export type GenerationMutableState = {
  aiConfig: AiConfig | null;
  aiClient: OpenAI | null;
  conversation: ConversationEntry[];
  currentGenerationController: AbortController | null;
  cachedImplementPrompt: Array<{ role: LlmRole; content: string }> | null;
  currentProjectOrigin: "none" | "generated" | "imported";
  currentGame: GameInfo;
  lastStableGame: GameInfo | null;
  lastSuccessfulGame: GameInfo | null;
};

type CreateGenerationServiceOptions = {
  state: GenerationMutableState;
  getGenerationTimeoutMs: () => number;
  ensureProjectsDir: () => Promise<string>;
  prepareGameFromProject: (projectDir: string, projectName: string) => Promise<GameInfo>;
};

type ToolExecutionTrace = {
  name: string;
  output: string;
};

function selectConversationEntries(
  entries: ConversationEntry[],
  mode: "create" | "modify",
  attempt: number
): { entries: ConversationEntry[]; omittedCount: number } {
  const limit = mode === "modify" ? (attempt > 1 ? 4 : 8) : 12;
  if (entries.length <= limit) {
    return { entries, omittedCount: 0 };
  }
  return {
    entries: entries.slice(-limit),
    omittedCount: entries.length - limit,
  };
}

export function toUiHistory(
  entries: ConversationEntry[]
): Array<{ role: LlmRole; content: string }> {
  return entries
    .filter((entry) => !entry.hidden)
    .map((entry) => ({
      role: entry.role,
      content: entry.role === "assistant" ? entry.summary ?? entry.content : entry.content,
    }));
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "不明なエラーが発生しました。";
}

export function toErrorCode(error: unknown): string | undefined {
  const anyError = error as { status?: number; code?: string; message?: string } | null;
  if (!anyError) return undefined;
  if (anyError.code === "invalid_api_key") return "invalid_api_key";
  if (anyError.status === 401) return "invalid_api_key";
  if (anyError.message && anyError.message.includes("Invalid API key")) {
    return "invalid_api_key";
  }
  return undefined;
}

function buildDeveloperInstruction(
  mode: "create" | "modify",
  targetDir: string
): string {
  const modifyPolicy =
    mode === "modify"
      ? `
【重要: 既存プロジェクトの修正】
- read_project_files を使ってプロジェクト内容を確認する。
- 既存ファイルを最大限維持し、変更が必要な部分だけを編集すること。
- 変更対象ファイルを先に列挙し、そのファイルのみを編集すること。
- 不要なファイルの削除・全面置換は行わないこと。
- game.json は指定がない限り修正しない。
- 最終JSONを返す前に、必ず read_project_files を使って対象プロジェクトを確認すること。
- 最終JSONを返す前に、必ず少なくとも1回は書き込み系ツールを成功させること。通常は create_game_file を使って実ファイルを更新すること。
- ツールを1回も使わずに、説明文と projectDir だけを返して完了してはいけない。
- 既存の設計・ゲーム性を尊重し、ユーザーの指示に必要な最小変更で対応すること。
- 変更点は最小限で明確に。改修対象外のファイルは触らないこと。
`
      : "";

  return `
あなたはニコ生ゲームの生成AIです。
MCPサーバーを使ってゲームを生成し、次のJSONのみを返してください。
JSON形式: {"projectName":"...","projectDir":"...","summary":"...","detail":"..."}
projectDirは必ず指定されたパスを使用してください。
projectDirの直下に game.json を配置してください。projectDir配下に別の子ディレクトリを作ってその中にプロジェクト本体を置くことは禁止です。
summaryは日本語で2〜3行の簡潔な内容にしてください。
detailには修正・生成内容の全文を日本語で入れてください。
${modifyPolicy}

テンプレート生成は1回のみです。複数回のテンプレート生成は禁止します。
game.json が存在する場合は init_project を実行しないでください。
テンプレート生成は ${targetDir} のみで行い、別のディレクトリは作らないでください。
create_game_file を使うときは directoryName に必ず ${targetDir} を指定し、filePath はその配下の相対パスだけを使ってください。game.json を更新する場合の filePath は必ず game.json にしてください。
新規ゲーム生成では、最終JSONを返す前に validate_niconama_spec と akashic_serve を必ず実行してください。
ツールが Error: で始まる結果を返した場合、その操作は失敗です。失敗したまま修正完了と報告してはいけません。原因を直して再実行してください。
TypeScriptテンプレートは禁止です。JavaScriptテンプレートのみを使用してください。
出力は必ず単一のJSONオブジェクトのみで返してください(説明文や余計な出力は禁止)。
`;
}

function buildRepairPrompt(originalPrompt: string, errorMessage: string): string {
  const toolGuidance =
    errorMessage.includes("書き込み系ツールが呼ばれていません")
      ? `

重要:
- 今回の前回応答では書き込み系ツールが一度も呼ばれていませんでした。
- 必ず read_project_files で現状を確認し、その後 create_game_file などの書き込み系ツールで実ファイルを変更してください。
- ツール呼び出しが成功したことを確認してから、最後に JSON を返してください。
`
      : errorMessage.includes("akashic_serve") || errorMessage.includes("validate_niconama_spec")
        ? `

重要:
- 新規ゲーム生成では validate_niconama_spec と akashic_serve の両方が必須です。
- 実装後に validate_niconama_spec を実行し、続けて akashic_serve で動作確認してください。
- どちらかを省略したまま完了してはいけません。
`
      : "";

  return `${originalPrompt}

以下の検証エラーを修正してください。既存のファイルは可能な限り保持し、必要な差分のみを修正してください。
エラー: ${errorMessage}
${toolGuidance}`;
}

function normalizeTemperature(value: unknown, fallback = 0.3): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function createGenerationService({
  state,
  getGenerationTimeoutMs,
  ensureProjectsDir,
  prepareGameFromProject,
}: CreateGenerationServiceOptions) {
  async function createResponseWithTemperature(
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<OpenAI.Responses.Response> {
    if (!state.aiClient) {
      throw new Error("AI設定が未設定です。");
    }
    try {
      return await state.aiClient.responses.create(body as never, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Unsupported parameter: 'temperature'")) {
        const { temperature: _ignored, ...rest } = body;
        return await state.aiClient.responses.create(rest as never, options);
      }
      throw error;
    }
  }

  async function createResponseWithMcpTools(
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<{ response: OpenAI.Responses.Response; toolTraces: ToolExecutionTrace[] }> {
    const mcpInfo = await ensureMcpServer(options?.signal);
    const baseBody = {
      ...body,
      tools: mcpInfo.tools,
      parallel_tool_calls: true,
    };
    const toolTraces: ToolExecutionTrace[] = [];

    let response = await createResponseWithTemperature(baseBody, options);
    let iterations = 0;
    const maxIterations = getToolCallMaxIterations();

    while (true) {
      const toolCalls = (response.output ?? []).filter(
        (item) => item.type === "function_call"
      ) as ResponseFunctionToolCall[];
      if (!toolCalls || toolCalls.length === 0) {
        return { response, toolTraces };
      }
      iterations += 1;
      if (iterations > maxIterations) {
        throw new Error(`ツール呼び出しが多すぎるため中断しました。上限: ${maxIterations}`);
      }

      const outputs = await Promise.all(
        toolCalls.map((call) => callMcpTool(mcpInfo.baseUrl, call.name, call.arguments, options?.signal))
      );
      toolCalls.forEach((call, index) => {
        toolTraces.push({
          name: call.name,
          output: outputs[index],
        });
      });
      const toolOutputItems = toolCalls.map((call, index) => ({
        type: "function_call_output",
        call_id: call.call_id,
        output: outputs[index],
      }));

      response = await createResponseWithTemperature(
        {
          ...baseBody,
          input: toolOutputItems,
          previous_response_id: response.id,
        },
        options
      );
    }
  }

  async function runDesign(
    prompt: string,
    temperature: number,
    signal?: AbortSignal
  ): Promise<string> {
    if (!state.aiClient || !state.aiConfig) {
      throw new Error("AI設定が未設定です。");
    }

    const mcpInfo = await ensureMcpServer(signal);
    let promptMessages: Array<{ role: LlmRole; content: string }> = [];
    try {
      const rawMessages = await fetchMcpPrompt(mcpInfo.baseUrl, "design_niconama_game", {}, signal);
      promptMessages = toInputMessagesFromPrompt(rawMessages);
    } catch (error) {
      console.warn("MCP設計プロンプトの取得に失敗しました。", error);
    }

    const { response } = await createResponseWithMcpTools({
      model: state.aiConfig.designModel ?? state.aiConfig.model,
      input: [
        ...promptMessages,
        { role: "user", content: `ゲーム設計文のみを出力してください。\nユーザー入力:\n${prompt}` },
      ],
      temperature,
    }, signal ? { signal } : undefined);

    return response.output_text?.trim() ?? "";
  }

  async function runGeneration(
    prompt: string,
    mode: "create" | "modify",
    targetDir: string,
    designTemperature?: number,
    forbidGameJsonUpdate?: boolean,
    useDesignModel?: boolean
  ): Promise<{
    payload: GenerationPayload;
    outputText: string;
    designDoc: string;
    toolTraces: ToolExecutionTrace[];
  }> {
    if (!state.aiClient || !state.aiConfig) {
      throw new Error("AI設定が未設定です。");
    }

    console.log("targetDir", targetDir);
    const developerInstruction = buildDeveloperInstruction(mode, targetDir);
    const maxAttempts = 1;
    let lastError: unknown = null;

    const controller = new AbortController();
    state.currentGenerationController?.abort();
    state.currentGenerationController = controller;
    const timeoutMs = getGenerationTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const shouldUseDesignModel =
      useDesignModel !== false &&
      state.aiConfig.designModel &&
      state.aiConfig.designModel !== state.aiConfig.model;
    const designStart = Date.now();
    const designTemp = normalizeTemperature(designTemperature, 0.3);
    const designDoc = shouldUseDesignModel ? await runDesign(prompt, designTemp, controller.signal) : "";
    if (shouldUseDesignModel) {
      console.log(`[timing] design: ${Date.now() - designStart}ms`);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        let implementPromptMessages = state.cachedImplementPrompt;
        try {
          const rawMessages = await fetchMcpPrompt(
            (await ensureMcpServer(controller.signal)).baseUrl,
            "implement_niconama_game",
            { targetDir },
            controller.signal
          );
          implementPromptMessages = toDeveloperMessagesFromPrompt(rawMessages);
          state.cachedImplementPrompt = implementPromptMessages;
        } catch (error) {
          console.warn("MCP実装プロンプトの取得に失敗しました。", error);
        }

        const inputMessages: OpenAI.Responses.ResponseInput = [];
        if (implementPromptMessages && implementPromptMessages.length > 0) {
          implementPromptMessages.forEach((entry) => {
            inputMessages.push({
              role: entry.role,
              content: entry.content,
            });
          });
        }
        const trimmedInstruction = developerInstruction.trim();
        if (trimmedInstruction) {
          inputMessages.push({ role: "developer", content: trimmedInstruction });
        }
        const conversationContext = selectConversationEntries(state.conversation, mode, attempt);
        if (conversationContext.omittedCount > 0) {
          inputMessages.push({
            role: "developer",
            content:
              `過去の会話履歴が長くなったため、古い ${conversationContext.omittedCount} 件は今回の推論から省略しています。` +
              "直近の依頼と現在の projectDir 上の実ファイル状態を優先し、必要な場合は必ず read_project_files で確認してください。",
          });
        }
        conversationContext.entries.forEach((entry) => {
          inputMessages.push({
            role: entry.role,
            content: entry.content,
          });
        });
        if (designDoc) {
          inputMessages.push({ role: "user", content: `ゲーム設計文:\n${designDoc}` });
        }
        const promptContent = forbidGameJsonUpdate
          ? `${prompt}\n\n[注意] game.jsonはakashic_scan_asset以外で更新しないでください。`
          : prompt;
        inputMessages.push({ role: "user", content: promptContent });

        const selectedModel = state.aiConfig.model;
        if (selectedModel !== state.aiConfig.model) {
          console.log(`[model] override create-mode model: ${state.aiConfig.model} -> ${selectedModel}`);
        }
        const { response, toolTraces } = await createResponseWithMcpTools({
          model: selectedModel,
          input: inputMessages,
          temperature: 0,
        }, { signal: controller.signal });

        const outputText = response.output_text?.trim() ?? "";
        try {
          return { payload: parseJsonFromText(outputText), outputText, designDoc, toolTraces };
        } catch (error) {
          if (/init_project/i.test(outputText)) {
            throw new Error("init_project");
          }
          throw error;
        }
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        if (error instanceof Error && /init_project/i.test(error.message)) {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
            continue;
          }
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (state.currentGenerationController === controller) {
          state.currentGenerationController = null;
        }
      }
    }

    throw lastError ?? new Error("init_project");
  }

  async function handleGenerateGame(request: GenerateRequest): Promise<GenerateResult> {
    const prompt = request.prompt.trim();
    if (!prompt) {
      return { ok: false, errorMessage: "テキストを入力してください。" };
    }

    const previousGameJson =
      request.mode === "modify" && state.currentGame.projectDir
        ? await readGameJsonIfExists(state.currentGame.projectDir)
        : null;
    const previousProjectSnapshot =
      request.mode === "modify" && state.currentGame.projectDir
        ? await createProjectSnapshot(state.currentGame.projectDir)
        : null;
    const previousGame = state.currentGame;

    let projectDir = "";
    if (request.mode === "modify") {
      const fallbackProjectDir = state.currentGame.projectDir ?? state.lastStableGame?.projectDir;
      if (!fallbackProjectDir) {
        return { ok: false, errorMessage: "修正対象のゲームが見つかりません。" };
      }
      projectDir = fallbackProjectDir;
    } else {
      const projectsDir = await ensureProjectsDir();
      const projectId = crypto.randomUUID();
      projectDir = path.join(projectsDir, projectId);
      await fs.rm(projectDir, { recursive: true, force: true });
      await fs.mkdir(projectDir, { recursive: true });
    }

    state.lastStableGame = previousGame;
    state.currentGame = { status: "generating" };

    const maxFixAttempts = 2;
    let promptForAttempt = prompt;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxFixAttempts; attempt += 1) {
      try {
        const generationStart = Date.now();
        const { payload, outputText, designDoc, toolTraces } = await runGeneration(
          promptForAttempt,
          request.mode,
          projectDir,
          request.designTemperature,
          request.forbidGameJsonUpdate,
          request.useDesignModel
        );
        console.log(`[timing] runGeneration: ${Date.now() - generationStart}ms`);

        const payloadErrors = validateGenerationPayload(payload);
        if (payloadErrors.length > 0) {
          throw new Error(payloadErrors.join(" "));
        }

        if (payload.projectDir) {
          const resolvedTarget = path.resolve(projectDir);
          const resolvedPayload = path.resolve(payload.projectDir);
          if (resolvedPayload !== resolvedTarget) {
            throw new Error("projectDirが指定先と完全一致しませんでした。projectDir直下にgame.jsonを配置してください。");
          }
        } else if (payload.projectZipBase64) {
          const extractStart = Date.now();
          const normalizedBase64 = normalizeBase64(payload.projectZipBase64);
          const zipBuffer = Buffer.from(normalizedBase64, "base64");
          assertZipBuffer(zipBuffer);
          const zip = new AdmZip(zipBuffer);
          zip.extractAllTo(projectDir, true);
          await removeIgnoredMetadataFiles(projectDir);
          console.log(`[timing] extractZip: ${Date.now() - extractStart}ms`);
        } else {
          throw new Error("projectDirまたはprojectZipBase64がありません。");
        }

        const gameJsonPath = path.join(projectDir, "game.json");
        try {
          await fs.access(gameJsonPath);
        } catch {
          throw new Error("game.jsonがprojectDir直下に見つかりません。ネストしたディレクトリを作らずに projectDir 直下へ出力してください。");
        }

        const projectName = payload.projectName || "namagame";
        let warningMessage: string | undefined;
        if (request.mode === "modify") {
          const writeToolNames = new Set([
            "create_game_file",
            "import_local_assets",
            "akashic_scan_asset",
            "init_project",
            "init_minimal_template",
            "run_complete_audio",
            "akashic_install_extension",
          ]);
          const usedWriteTool = toolTraces.some((trace) => writeToolNames.has(trace.name));
          if (!usedWriteTool) {
            const usedTools = toolTraces.map((trace) => trace.name).join(", ") || "none";
            throw new Error(`修正処理で書き込み系ツールが呼ばれていません。使用ツール: ${usedTools}`);
          }

          const guardResult = await guardGameJsonAfterModify(previousGameJson, projectDir);
          if (guardResult.restored) {
            warningMessage = "game.jsonの内容が不正だったため、元のgame.jsonに復元して続行しました。";
          }
          if (previousProjectSnapshot) {
            const nextProjectSnapshot = await createProjectSnapshot(projectDir);
            if (!hasProjectSnapshotChanges(previousProjectSnapshot, nextProjectSnapshot)) {
              const traceSummary = toolTraces
                .map((trace) => `${trace.name}: ${trace.output.slice(0, 120)}`)
                .join(" | ");
              throw new Error(`修正内容がプロジェクトに反映されていません。ファイル差分を作成してください。ツール実行: ${traceSummary || "none"}`);
            }
          }
        }
        // else {
        //   const usedValidate = toolTraces.some((trace) => trace.name === "validate_niconama_spec");
        //   const usedServe = toolTraces.some((trace) => trace.name === "akashic_serve");
        //   if (!usedValidate || !usedServe) {
        //     const usedTools = toolTraces.map((trace) => trace.name).join(", ") || "none";
        //     throw new Error(
        //       `新規ゲーム生成では validate_niconama_spec と akashic_serve の両方が必要です。使用ツール: ${usedTools}`
        //     );
        //   }
        // }
        const prepareStart = Date.now();
        state.currentGame = await prepareGameFromProject(projectDir, projectName);
        state.lastStableGame = state.currentGame;
        state.lastSuccessfulGame = state.currentGame;
        console.log(`[timing] prepareGame: ${Date.now() - prepareStart}ms`);
        state.currentProjectOrigin = "generated";

        if (designDoc) {
          state.conversation.push({
            role: "user",
            content: `ゲーム設計文:\n${designDoc}`,
            hidden: true,
          });
        }
        state.conversation.push({ role: "user", content: prompt });
        const assistantContent = payload.detail?.trim() || outputText;
        console.log(assistantContent);
        console.log("modify targetDir:", projectDir);
        console.log("payload projectDir:", payload.projectDir);
        if (payload.summary) {
          state.conversation.push({ role: "assistant", content: assistantContent, summary: payload.summary });
        } else {
          state.conversation.push({ role: "assistant", content: assistantContent });
        }

        return {
          ok: true,
          game: state.currentGame,
          summary: payload.summary,
          history: toUiHistory(state.conversation),
          warningMessage,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === "AbortError") {
          state.currentGame = previousGame;
          return { ok: false, errorMessage: "キャンセルされました。", errorCode: "canceled" };
        }
        if (attempt < maxFixAttempts) {
          promptForAttempt = buildRepairPrompt(prompt, toErrorMessage(error));
          continue;
        }
        const errorCode = toErrorCode(error);
        const errorMessage = toErrorMessage(error);
        if (request.mode === "modify") {
          state.currentGame = previousGame;
        } else {
          state.currentGame = { status: "error", errorMessage, errorCode };
        }
        return { ok: false, errorMessage, errorCode };
      }
    }

    const errorCode = toErrorCode(lastError);
    const errorMessage = toErrorMessage(lastError);
    if (request.mode === "modify") {
      state.currentGame = previousGame;
    } else {
      state.currentGame = { status: "error", errorMessage, errorCode };
    }
    return { ok: false, errorMessage, errorCode };
  }

  function cancelGeneration(): { ok: boolean } {
    if (state.currentGenerationController) {
      state.currentGenerationController.abort();
      if (state.currentGame.status === "generating" && state.lastStableGame) {
        state.currentGame = state.lastStableGame;
      }
      return { ok: true };
    }
    return { ok: false };
  }

  return {
    cancelGeneration,
    handleGenerateGame,
  };
}
