type UpdateStatus = {
  state: "idle" | "checking" | "available" | "not-available" | "downloaded" | "error";
  message?: string;
};

type GenerateResult = {
  ok: boolean;
  game?: {
    status: "idle" | "generating" | "success" | "error";
    projectName?: string;
    playgroundUrl?: string;
    debugUrl?: string;
    errorMessage?: string;
    errorCode?: string;
  };
  summary?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  warningMessage?: string;
  errorMessage?: string;
  errorCode?: string;
};

type DownloadResult = {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  errorMessage?: string;
};

type LoadProjectResult = {
  ok: boolean;
  game?: {
    status: "idle" | "generating" | "success" | "error";
    projectName?: string;
    playgroundUrl?: string;
    debugUrl?: string;
    errorMessage?: string;
    errorCode?: string;
  };
  errorMessage?: string;
};

declare global {
  interface Window {
    namagame: {
      getAppInfo: () => Promise<{ version: string; platform: string }>;
      setAiConfig: (config: { model: string; designModel?: string; apiKey: string }) => Promise<{
        ok: boolean;
        errorMessage?: string;
        errorCode?: string;
      }>;
      generateGame: (
        prompt: string,
        options?: { designTemperature?: number; forbidGameJsonUpdate?: boolean; useDesignModel?: boolean }
      ) => Promise<GenerateResult>;
      modifyGame: (
        prompt: string,
        options?: { designTemperature?: number; forbidGameJsonUpdate?: boolean; useDesignModel?: boolean }
      ) => Promise<GenerateResult>;
      cancelGeneration: () => Promise<{ ok: boolean }>;
      openDebugWindow: () => Promise<{ ok: boolean; errorMessage?: string }>;
      openDebugExternal: () => Promise<{ ok: boolean; errorMessage?: string }>;
      getHistory: () => Promise<{ history: Array<{ role: "user" | "assistant"; content: string }> }>;
      resetSession: () => Promise<{ ok: boolean; errorMessage?: string }>;
      downloadProjectZip: () => Promise<DownloadResult>;
      downloadNicoliveZip: () => Promise<DownloadResult>;
      openProjectDir: () => Promise<LoadProjectResult>;
      loadProjectDir: (sourceDir: string) => Promise<LoadProjectResult>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}

const designModelOptions = [
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "o4-mini",
];

const implModelOptions = [
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex", // タイムアウトになる可能性が高いので一旦コメントアウト
];

const screenConfig = document.getElementById("screen-config") as HTMLElement;
const screenGenerate = document.getElementById("screen-generate") as HTMLElement;
const screenPlay = document.getElementById("screen-play") as HTMLElement;

const designModelSelect = document.getElementById("designModelSelect") as HTMLSelectElement;
const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const configSubmit = document.getElementById("configSubmit") as HTMLButtonElement;
const configError = document.getElementById("configError") as HTMLDivElement;
const configModelWarning = document.getElementById("configModelWarning") as HTMLDivElement;

const generatePrompt = document.getElementById("generatePrompt") as HTMLTextAreaElement;
const generateButton = document.getElementById("generateButton") as HTMLButtonElement;
const goToConfigGenerate = document.getElementById("goToConfigGenerate") as HTMLButtonElement;
const generateError = document.getElementById("generateError") as HTMLDivElement;
const historyGenerate = document.getElementById("historyGenerate") as HTMLDivElement;
const openProjectButton = document.getElementById("openProjectButton") as HTMLButtonElement;
const designTempGenerate = document.getElementById("designTempGenerate") as HTMLInputElement;
const designTempGenerateValue = document.getElementById("designTempGenerateValue") as HTMLSpanElement;
const forbidGameJsonGenerate = document.getElementById("forbidGameJsonGenerate") as HTMLInputElement;

let playgroundFrame = document.getElementById("playgroundFrame") as HTMLIFrameElement;
const gamePlaceholder = document.getElementById("gamePlaceholder") as HTMLDivElement;
const playgroundLink = document.getElementById("playgroundLink") as HTMLAnchorElement;
const debugOpenMode = document.getElementById("debugOpenMode") as HTMLSelectElement;
const modifyPrompt = document.getElementById("modifyPrompt") as HTMLTextAreaElement;
const modifyButton = document.getElementById("modifyButton") as HTMLButtonElement;
const modifyError = document.getElementById("modifyError") as HTMLDivElement;
const goToConfig = document.getElementById("goToConfig") as HTMLButtonElement;
const returnToGenerate = document.getElementById("returnToGenerate") as HTMLButtonElement;
const historyModify = document.getElementById("historyModify") as HTMLDivElement;
const designTempModify = document.getElementById("designTempModify") as HTMLInputElement;
const designTempModifyValue = document.getElementById("designTempModifyValue") as HTMLSpanElement;
const forbidGameJsonModify = document.getElementById("forbidGameJsonModify") as HTMLInputElement;
const useDesignModelGenerate = document.getElementById("useDesignModelGenerate") as HTMLInputElement;
const useDesignModelModify = document.getElementById("useDesignModelModify") as HTMLInputElement;
const designOptionsGenerate = document.getElementById("designOptionsGenerate") as HTMLDivElement;
const designOptionsModify = document.getElementById("designOptionsModify") as HTMLDivElement;

const downloadMain = document.getElementById("downloadMain") as HTMLButtonElement;
const downloadToggle = document.getElementById("downloadToggle") as HTMLButtonElement;
const downloadMenu = document.getElementById("downloadMenu") as HTMLDivElement;
const downloadSplit = document.getElementById("downloadSplit") as HTMLDivElement;

const loadingOverlay = document.getElementById("loadingOverlay") as HTMLDivElement;
const loadingText = document.getElementById("loadingText") as HTMLDivElement;
const cancelGeneration = document.getElementById("cancelGeneration") as HTMLButtonElement;
const updateStatus = document.getElementById("updateStatus") as HTMLDivElement;

let generationInFlight = false;
let historyEntries: Array<{ role: "user" | "assistant"; content: string }> = [];
let debugOpenModeValue: "app" | "external" = "app";
let returnScreenAfterConfig: "generate" | "play" = "generate";
let designTemperature = 1;
let forbidGameJsonUpdate = false;
let useDesignModel = true;

function setScreen(target: "config" | "generate" | "play"): void {
  screenConfig.classList.toggle("hidden", target !== "config");
  screenGenerate.classList.toggle("hidden", target !== "generate");
  screenPlay.classList.toggle("hidden", target !== "play");
}

function setLoading(isLoading: boolean, message = "生成中...", cancellable = false): void {
  loadingOverlay.classList.toggle("hidden", !isLoading);
  loadingText.textContent = message;
  cancelGeneration.classList.toggle("hidden", !isLoading || !cancellable);
}

function setError(element: HTMLElement, message?: string): void {
  element.textContent = message || "";
}

function setConfigModelWarning(model: string): void {
  const timeoutRiskModels = new Set(["gpt-5.1-codex", "gpt-5.1-codex-mini"]);
  if (timeoutRiskModels.has(model)) {
    configModelWarning.textContent =
      "このモデルは処理に時間がかかり、最悪の場合はタイムアウトする可能性があります。タイムアウトした場合は別のモデルに切り替えてください。";
    configModelWarning.classList.remove("hidden");
    return;
  }
  configModelWarning.textContent = "";
  configModelWarning.classList.add("hidden");
}

function renderHistory(): void {
  const render = (container: HTMLDivElement) => {
    container.innerHTML = "";
    if (historyEntries.length === 0) {
      container.textContent = "会話履歴はまだありません。";
      return;
    }
    historyEntries.forEach((entry) => {
      const wrapper = document.createElement("div");
      wrapper.className = "entry";
      const role = document.createElement("div");
      role.className = "role";
      role.textContent = entry.role === "user" ? "あなた" : "AI (summary)";
      const content = document.createElement("div");
      content.textContent = entry.content;
      wrapper.appendChild(role);
      wrapper.appendChild(content);
      container.appendChild(wrapper);
    });
  };
  render(historyGenerate);
  render(historyModify);
}

function setDesignTemperature(value: number): void {
  const normalized = Math.min(1, Math.max(0, value));
  designTemperature = normalized;
  const display = normalized.toFixed(2);
  designTempGenerate.value = String(normalized);
  designTempGenerateValue.textContent = display;
  designTempModify.value = String(normalized);
  designTempModifyValue.textContent = display;
  const percent = Math.round(normalized * 100);
  const fill = `linear-gradient(90deg, #4c2e05 ${percent}%, #e6ddcf ${percent}%)`;
  designTempGenerate.style.background = fill;
  designTempModify.style.background = fill;
  localStorage.setItem("designTemperature", String(normalized));
}

function setForbidGameJsonUpdate(checked: boolean): void {
  forbidGameJsonUpdate = checked;
  forbidGameJsonGenerate.checked = checked;
  forbidGameJsonModify.checked = checked;
  localStorage.setItem("forbidGameJsonUpdate", checked ? "1" : "0");
}

function setUseDesignModel(checked: boolean): void {
  useDesignModel = checked;
  useDesignModelGenerate.checked = checked;
  useDesignModelModify.checked = checked;
  designTempGenerate.disabled = !checked;
  designTempModify.disabled = !checked;
  designOptionsGenerate.classList.toggle("disabled", !checked);
  designOptionsModify.classList.toggle("disabled", !checked);
  localStorage.setItem("useDesignModel", checked ? "1" : "0");
}

async function refreshHistory(): Promise<void> {
  if (!window.namagame?.getHistory) {
    return;
  }
  const result = await window.namagame.getHistory();
  historyEntries = result.history ?? [];
  renderHistory();
}

function rebuildPlaygroundFrame(): void {
  const parent = playgroundFrame.parentElement;
  if (!parent) return;
  const replacement = document.createElement("iframe");
  replacement.id = "playgroundFrame";
  replacement.title = playgroundFrame.title || "Nicolive Game";
  replacement.className = playgroundFrame.className;
  parent.replaceChild(replacement, playgroundFrame);
  playgroundFrame = replacement;
}

function showPlayground(url?: string, debugUrl?: string): void {
  if (!url) {
    playgroundFrame.src = "";
    gamePlaceholder.style.display = "flex";
    playgroundLink.href = "#";
    return;
  }
  const cacheBustedUrl = url.includes("?") ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
  if (playgroundFrame.src === cacheBustedUrl) {
    playgroundFrame.src = "about:blank";
  }
  playgroundFrame.src = cacheBustedUrl;
  gamePlaceholder.style.display = "none";
  playgroundLink.href = debugUrl || url;
}

async function handleProjectResult(result: LoadProjectResult): Promise<void> {
  if (!result.ok) {
    if (result.errorMessage) {
      setError(generateError, result.errorMessage);
    }
    return;
  }
  setError(generateError, "");
  const game = result.game;
  showPlayground(game?.playgroundUrl, game?.debugUrl);
  setScreen("play");
}

// function setDebugOpenMode(value: string | null): void {
//   if (value === "external") {
//     debugOpenModeValue = "external";
//   } else {
//     debugOpenModeValue = "app";
//   }
//   debugOpenMode.value = debugOpenModeValue;
//   localStorage.setItem("debugOpenMode", debugOpenModeValue);
// }

function populateModels(
  select: HTMLSelectElement,
  label: string,
  options: string[]
): void {
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = `${label}を選択`;
  select.appendChild(defaultOption);

  options.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  });
}

async function handleConfigSubmit(): Promise<void> {
  setError(configError, "");
  const designModel = designModelSelect.value.trim();
  const model = modelSelect.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!window.namagame) {
    setError(configError, "IPCが初期化されていません。アプリを再起動してください。");
    return;
  }

  if (!model || !apiKey) {
    setError(configError, "実装モデルとAPIキーを入力してください。");
    return;
  }
  const resolvedDesignModel = designModel || model;
  designModelSelect.value = resolvedDesignModel;

  setLoading(true, "APIキーを確認中...", false);
  const timeoutMs = 12000;
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    setLoading(false, "", false);
    setError(configError, "APIキー確認がタイムアウトしました。");
  }, timeoutMs);

  const result = await window.namagame.setAiConfig({
    model,
    designModel: resolvedDesignModel,
    apiKey,
  });
  clearTimeout(timeoutId);
  if (didTimeout) {
    return;
  }
  setLoading(false, "", false);

  if (!result.ok) {
    setError(configError, result.errorMessage || "APIキーの確認に失敗しました。");
    return;
  }

  if (returnScreenAfterConfig === "generate") {
    historyEntries = [];
    renderHistory();
  }
  setScreen(returnScreenAfterConfig);
}

async function runGeneration(mode: "create" | "modify"): Promise<void> {
  const prompt = mode === "create" ? generatePrompt.value : modifyPrompt.value;
  const targetError = mode === "create" ? generateError : modifyError;
  const loadingMessage = mode === "create" ? "ゲーム生成中..." : "ゲーム修正中...";

  setError(targetError, "");
  if (!prompt.trim()) {
    setError(targetError, "テキストを入力してください。");
    return;
  }

  if (mode === "create") {
  }

  generationInFlight = true;
  setLoading(true, loadingMessage, true);
  const requestOptions = {
    designTemperature,
    forbidGameJsonUpdate,
    useDesignModel,
  };
  const result =
    mode === "create"
      ? await window.namagame.generateGame(prompt, requestOptions)
      : await window.namagame.modifyGame(prompt, requestOptions);
  generationInFlight = false;
  setLoading(false, "", false);

  if (!result.ok) {
    setError(targetError, result.errorMessage || "生成に失敗しました。");
    if (result.errorCode === "invalid_api_key") {
      if (mode === "create") {
        setScreen("config");
        setError(configError, "APIキーが無効です。再入力してください。");
      } else {
        goToConfig.classList.remove("hidden");
      }
    }
    return;
  }

  const game = result.game;
  if (mode === "modify") {
    rebuildPlaygroundFrame();
  }
  showPlayground(game?.playgroundUrl, game?.debugUrl);
  if (result.history) {
    historyEntries = result.history;
    renderHistory();
  }
  if (result.warningMessage) {
    setError(targetError, result.warningMessage);
  } else {
    setError(targetError, "");
  }
  if (mode === "create") {
    setScreen("play");
  }

  if (mode === "modify") {
    modifyPrompt.value = "";
  }
}

async function handleDownload(type: "nicolive" | "project"): Promise<void> {
  setError(modifyError, "");
  setLoading(true, "ダウンロード準備中...", false);
  const result =
    type === "nicolive"
      ? await window.namagame.downloadNicoliveZip()
      : await window.namagame.downloadProjectZip();
  setLoading(false, "", false);

  if (!result.ok && !result.canceled) {
    setError(modifyError, result.errorMessage || "ダウンロードに失敗しました。");
  }
}

function bindEvents(): void {
  const savedTemp = Number(localStorage.getItem("designTemperature"));
  setDesignTemperature(Number.isFinite(savedTemp) ? savedTemp : 1);
  const savedForbid = localStorage.getItem("forbidGameJsonUpdate");
  setForbidGameJsonUpdate(savedForbid === "1");
  const savedUseDesignModel = localStorage.getItem("useDesignModel");
  setUseDesignModel(savedUseDesignModel !== "0");

  designTempGenerate.addEventListener("input", () => {
    setDesignTemperature(Number(designTempGenerate.value));
  });
  designTempModify.addEventListener("input", () => {
    setDesignTemperature(Number(designTempModify.value));
  });
  forbidGameJsonGenerate.addEventListener("change", () => {
    setForbidGameJsonUpdate(forbidGameJsonGenerate.checked);
  });
  forbidGameJsonModify.addEventListener("change", () => {
    setForbidGameJsonUpdate(forbidGameJsonModify.checked);
  });
  useDesignModelGenerate.addEventListener("change", () => {
    setUseDesignModel(useDesignModelGenerate.checked);
  });
  useDesignModelModify.addEventListener("change", () => {
    setUseDesignModel(useDesignModelModify.checked);
  });
  // setDebugOpenMode(localStorage.getItem("debugOpenMode"));
  // debugOpenMode.addEventListener("change", () => {
  //   setDebugOpenMode(debugOpenMode.value);
  // });

  modelSelect.addEventListener("change", () => {
    setConfigModelWarning(modelSelect.value);
  });
  setConfigModelWarning(modelSelect.value);

  configSubmit.addEventListener("click", () => {
    handleConfigSubmit();
  });

  generateButton.addEventListener("click", () => {
    runGeneration("create");
  });

  openProjectButton.addEventListener("click", async () => {
    if (!window.namagame?.openProjectDir) return;
    setError(generateError, "");
    setLoading(true, "プロジェクトを読み込み中...", false);
    const result = await window.namagame.openProjectDir();
    setLoading(false, "", false);
    await handleProjectResult(result);
  });

  goToConfigGenerate.addEventListener("click", () => {
    returnScreenAfterConfig = "generate";
    setScreen("config");
  });


  modifyButton.addEventListener("click", () => {
    goToConfig.classList.add("hidden");
    runGeneration("modify");
  });

  cancelGeneration.addEventListener("click", async () => {
    if (!generationInFlight) return;
    await window.namagame.cancelGeneration();
    generationInFlight = false;
    setLoading(false, "", false);
  });

  goToConfig.addEventListener("click", () => {
    returnScreenAfterConfig = "play";
    setScreen("config");
  });

  returnToGenerate.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "生成画面に戻ると現在のゲーム内容がリセットされます。よろしいですか？"
    );
    if (!confirmed) return;
    if (!window.namagame?.resetSession) return;
    const result = await window.namagame.resetSession();
    if (!result.ok) {
      setError(modifyError, result.errorMessage || "セッションのリセットに失敗しました。");
      return;
    }
    historyEntries = [];
    renderHistory();
    setError(modifyError, "");
    setError(generateError, "");
    modifyPrompt.value = "";
    generatePrompt.value = "";
    showPlayground();
    setScreen("generate");
  });

  downloadMain.addEventListener("click", () => handleDownload("nicolive"));

  downloadToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    downloadMenu.classList.toggle("hidden");
  });

  downloadMenu.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const type = target.dataset.download as "nicolive" | "project";
      downloadMenu.classList.add("hidden");
      handleDownload(type);
    });
  });

  playgroundLink.addEventListener("click", async (event) => {
    if (!window.namagame?.openDebugWindow) return;
    event.preventDefault();
    const result =
      debugOpenModeValue === "external"
        ? await window.namagame.openDebugExternal()
        : await window.namagame.openDebugWindow();
    if (!result.ok) {
      setError(modifyError, result.errorMessage || "デバッグ画面を開けませんでした。");
    }
  });

  document.addEventListener("click", (event) => {
    if (!downloadSplit.contains(event.target as Node)) {
      downloadMenu.classList.add("hidden");
    }
  });

  window.namagame.onUpdateStatus((status) => {
    const labelMap: Record<UpdateStatus["state"], string> = {
      idle: "更新待機中",
      checking: "更新確認中",
      available: "更新があります",
      "not-available": "最新版です",
      downloaded: "更新をダウンロード済み",
      error: "更新確認エラー",
    };
    updateStatus.textContent = status.message || labelMap[status.state];
  });
}

populateModels(designModelSelect, "設計モデル", designModelOptions);
populateModels(modelSelect, "実装モデル", implModelOptions);
setScreen("config");
showPlayground();
void refreshHistory();
bindEvents();
