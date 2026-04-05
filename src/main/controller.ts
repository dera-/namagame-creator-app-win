import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AiConfig, GameInfo, LoadProjectResult } from "../shared/types.js";
import {
  buildImportedProjectConversationPrompt,
  createGenerationService,
  toErrorCode,
  toErrorMessage,
  toUiHistory,
  type AiClientLike,
  type ConversationEntry,
} from "./generation.js";
import {
  ensureEntryPoint,
  isIgnoredMetadataPath,
  removeIgnoredMetadataFiles,
} from "./project.js";

type CurrentProjectOrigin = "none" | "generated" | "imported";

type MainControllerDeps = {
  createAiClient: (config: AiConfig) => AiClientLike;
  getGenerationTimeoutMs: () => number;
  ensureProjectsDir: () => Promise<string>;
  prepareGameFromProject: (projectDir: string, projectName: string) => Promise<GameInfo>;
  generationDeps?: Parameters<typeof createGenerationService>[1];
  skipApiKeyCheck?: boolean;
};

type MainControllerState = {
  aiConfig: AiConfig | null;
  aiClient: AiClientLike | null;
  currentGame: GameInfo;
  lastStableGame: GameInfo | null;
  lastSuccessfulGame: GameInfo | null;
  currentProjectOrigin: CurrentProjectOrigin;
  conversation: ConversationEntry[];
  currentGenerationController: AbortController | null;
  generationCanceled: boolean;
  cachedImplementPrompt: Array<{ role: "user" | "assistant" | "developer"; content: string }> | null;
};

function validateAiConfig(config: AiConfig): string | null {
  if (!config.model?.trim()) {
    return "実装モデルを選択してください。";
  }
  if (!config.designModel?.trim()) {
    return "設計モデルを選択してください。";
  }
  if (!config.apiKey?.trim()) {
    return "トークンを入力してください。";
  }
  return null;
}

export function createMainController(deps: MainControllerDeps) {
  let aiConfig: AiConfig | null = null;
  let aiClient: AiClientLike | null = null;
  let currentGame: GameInfo = { status: "idle" };
  let lastStableGame: GameInfo | null = null;
  let lastSuccessfulGame: GameInfo | null = null;
  let currentProjectOrigin: CurrentProjectOrigin = "none";
  let conversation: ConversationEntry[] = [];
  let currentGenerationController: AbortController | null = null;
  let generationCanceled = false;
  let cachedImplementPrompt: Array<{ role: "user" | "assistant" | "developer"; content: string }> | null = null;

  const state: MainControllerState = {
    get aiConfig() {
      return aiConfig;
    },
    set aiConfig(value) {
      aiConfig = value;
    },
    get aiClient() {
      return aiClient;
    },
    set aiClient(value) {
      aiClient = value;
    },
    get currentGame() {
      return currentGame;
    },
    set currentGame(value) {
      currentGame = value;
    },
    get lastStableGame() {
      return lastStableGame;
    },
    set lastStableGame(value) {
      lastStableGame = value;
    },
    get lastSuccessfulGame() {
      return lastSuccessfulGame;
    },
    set lastSuccessfulGame(value) {
      lastSuccessfulGame = value;
    },
    get currentProjectOrigin() {
      return currentProjectOrigin;
    },
    set currentProjectOrigin(value) {
      currentProjectOrigin = value;
    },
    get conversation() {
      return conversation;
    },
    set conversation(value) {
      conversation = value;
    },
    get currentGenerationController() {
      return currentGenerationController;
    },
    set currentGenerationController(value) {
      currentGenerationController = value;
    },
    get generationCanceled() {
      return generationCanceled;
    },
    set generationCanceled(value) {
      generationCanceled = value;
    },
    get cachedImplementPrompt() {
      return cachedImplementPrompt;
    },
    set cachedImplementPrompt(value) {
      cachedImplementPrompt = value;
    },
  };

  const generationService = createGenerationService(
    {
      state,
      getGenerationTimeoutMs: deps.getGenerationTimeoutMs,
      ensureProjectsDir: deps.ensureProjectsDir,
      prepareGameFromProject: deps.prepareGameFromProject,
    },
    deps.generationDeps
  );

  async function setAiConfig(config: AiConfig): Promise<{
    ok: boolean;
    errorMessage?: string;
    errorCode?: string;
  }> {
    const validationError = validateAiConfig(config);
    if (validationError) {
      return { ok: false, errorMessage: validationError, errorCode: "invalid_config" };
    }

    const nextClient = deps.createAiClient(config);
    if (deps.skipApiKeyCheck) {
      aiConfig = config;
      aiClient = nextClient;
      return { ok: true };
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      try {
        await nextClient.models.list({ signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return {
          ok: false,
          errorMessage: "APIキーの確認がタイムアウトしました。",
          errorCode: "timeout",
        };
      }
      return {
        ok: false,
        errorMessage: "APIキーの確認に失敗しました。ネットワーク設定を確認してください。",
        errorCode: toErrorCode(error),
      };
    }

    aiConfig = config;
    aiClient = nextClient;
    return { ok: true };
  }

  async function loadProjectDir(sourceDir: string): Promise<LoadProjectResult> {
    try {
      const stats = await fs.stat(sourceDir).catch(() => null);
      if (!stats?.isDirectory()) {
        throw new Error("指定されたパスはディレクトリではありません。");
      }
      const sourceGameJson = path.join(sourceDir, "game.json");
      try {
        await fs.access(sourceGameJson);
      } catch {
        throw new Error("game.jsonが見つかりません。");
      }

      const projectsDir = await deps.ensureProjectsDir();
      const projectId = crypto.randomUUID();
      const targetDir = path.join(projectsDir, projectId);
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(targetDir, { recursive: true });
      await fs.cp(sourceDir, targetDir, {
        recursive: true,
        filter: (entryPath) => !isIgnoredMetadataPath(entryPath),
      });
      await removeIgnoredMetadataFiles(targetDir);
      await ensureEntryPoint(targetDir);

      const game = await deps.prepareGameFromProject(targetDir, path.basename(sourceDir));
      currentGame = game;
      lastSuccessfulGame = game;
      currentProjectOrigin = "imported";
      const importedPrompt = buildImportedProjectConversationPrompt();
      const hasImportedPrompt = conversation.some(
        (entry) => entry.pinned && entry.content === importedPrompt
      );
      if (!hasImportedPrompt) {
        conversation = [
          {
            role: "developer",
            content: importedPrompt,
            hidden: true,
            pinned: true,
          },
          ...conversation,
        ];
      }
      return { ok: true, game };
    } catch (error) {
      return { ok: false, errorMessage: toErrorMessage(error) };
    }
  }

  function getHistory(): { history: Array<{ role: "user" | "assistant" | "developer"; content: string }> } {
    return { history: toUiHistory(conversation) };
  }

  function resetSession(): { ok: boolean } {
    conversation = [];
    currentGame = { status: "idle" };
    lastStableGame = null;
    lastSuccessfulGame = null;
    currentProjectOrigin = "none";
    cachedImplementPrompt = null;
    generationCanceled = false;
    if (currentGenerationController) {
      currentGenerationController.abort();
      currentGenerationController = null;
    }
    return { ok: true };
  }

  return {
    cancelGeneration: generationService.cancelGeneration,
    generateGame: generationService.handleGenerateGame,
    getHistory,
    getState: () => ({
      aiConfig,
      currentGame,
      lastSuccessfulGame,
      conversation,
      currentProjectOrigin,
    }),
    loadProjectDir,
    resetSession,
    setAiConfig,
  };
}
