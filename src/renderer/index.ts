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
  errorMessage?: string;
  errorCode?: string;
};

type DownloadResult = {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  errorMessage?: string;
};

declare global {
  interface Window {
    namagame: {
      getAppInfo: () => Promise<{ version: string; platform: string }>;
      setAiConfig: (config: { model: string; apiKey: string }) => Promise<{
        ok: boolean;
        errorMessage?: string;
        errorCode?: string;
      }>;
      generateGame: (prompt: string) => Promise<GenerateResult>;
      modifyGame: (prompt: string) => Promise<GenerateResult>;
      cancelGeneration: () => Promise<{ ok: boolean }>;
      getHistory: () => Promise<{ history: Array<{ role: "user" | "assistant"; content: string }> }>;
      downloadProjectZip: () => Promise<DownloadResult>;
      downloadNicoliveZip: () => Promise<DownloadResult>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}

const modelOptions = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "gpt-4o-mini",
];

const screenConfig = document.getElementById("screen-config") as HTMLElement;
const screenGenerate = document.getElementById("screen-generate") as HTMLElement;
const screenPlay = document.getElementById("screen-play") as HTMLElement;

const modelSelect = document.getElementById("modelSelect") as HTMLSelectElement;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const configSubmit = document.getElementById("configSubmit") as HTMLButtonElement;
const configError = document.getElementById("configError") as HTMLDivElement;

const generatePrompt = document.getElementById("generatePrompt") as HTMLTextAreaElement;
const generateButton = document.getElementById("generateButton") as HTMLButtonElement;
const retryGenerate = document.getElementById("retryGenerate") as HTMLButtonElement;
const goToConfigGenerate = document.getElementById("goToConfigGenerate") as HTMLButtonElement;
const generateError = document.getElementById("generateError") as HTMLDivElement;
const historyGenerate = document.getElementById("historyGenerate") as HTMLDivElement;

let playgroundFrame = document.getElementById("playgroundFrame") as HTMLIFrameElement;
const gamePlaceholder = document.getElementById("gamePlaceholder") as HTMLDivElement;
const playgroundLink = document.getElementById("playgroundLink") as HTMLAnchorElement;
const modifyPrompt = document.getElementById("modifyPrompt") as HTMLTextAreaElement;
const modifyButton = document.getElementById("modifyButton") as HTMLButtonElement;
const retryModify = document.getElementById("retryModify") as HTMLButtonElement;
const modifyError = document.getElementById("modifyError") as HTMLDivElement;
const goToConfig = document.getElementById("goToConfig") as HTMLButtonElement;
const historyModify = document.getElementById("historyModify") as HTMLDivElement;

const downloadMain = document.getElementById("downloadMain") as HTMLButtonElement;
const downloadToggle = document.getElementById("downloadToggle") as HTMLButtonElement;
const downloadMenu = document.getElementById("downloadMenu") as HTMLDivElement;
const downloadSplit = document.getElementById("downloadSplit") as HTMLDivElement;

const loadingOverlay = document.getElementById("loadingOverlay") as HTMLDivElement;
const loadingText = document.getElementById("loadingText") as HTMLDivElement;
const cancelGeneration = document.getElementById("cancelGeneration") as HTMLButtonElement;
const updateStatus = document.getElementById("updateStatus") as HTMLDivElement;

let lastGeneratePrompt = "";
let lastModifyPrompt = "";
let generationInFlight = false;
let historyEntries: Array<{ role: "user" | "assistant"; content: string }> = [];

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

function populateModels(): void {
  modelSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "モデルを選択";
  modelSelect.appendChild(defaultOption);

  modelOptions.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });
}

async function handleConfigSubmit(): Promise<void> {
  setError(configError, "");
  const model = modelSelect.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!window.namagame) {
    setError(configError, "IPCが初期化されていません。アプリを再起動してください。");
    return;
  }

  if (!model || !apiKey) {
    setError(configError, "モデルとAPIキーを入力してください。");
    return;
  }

  setLoading(true, "APIキーを確認中...", false);
  const timeoutMs = 12000;
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    setLoading(false, "", false);
    setError(configError, "APIキー確認がタイムアウトしました。");
  }, timeoutMs);

  const result = await window.namagame.setAiConfig({ model, apiKey });
  clearTimeout(timeoutId);
  if (didTimeout) {
    return;
  }
  setLoading(false, "", false);

  if (!result.ok) {
    setError(configError, result.errorMessage || "APIキーの確認に失敗しました。");
    return;
  }

  historyEntries = [];
  renderHistory();
  setScreen("generate");
}

async function runGeneration(mode: "create" | "modify"): Promise<void> {
  const prompt = mode === "create" ? generatePrompt.value : modifyPrompt.value;
  const targetError = mode === "create" ? generateError : modifyError;
  const loadingMessage = mode === "create" ? "ゲーム生成中..." : "ゲーム修正中...";

  setError(targetError, "");
  retryGenerate.classList.add("hidden");
  retryModify.classList.add("hidden");
  if (!prompt.trim()) {
    setError(targetError, "テキストを入力してください。");
    return;
  }

  if (mode === "create") {
    lastGeneratePrompt = prompt;
  } else {
    lastModifyPrompt = prompt;
  }

  generationInFlight = true;
  setLoading(true, loadingMessage, true);
  const result =
    mode === "create"
      ? await window.namagame.generateGame(prompt)
      : await window.namagame.modifyGame(prompt);
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
    if (mode === "create") {
      retryGenerate.classList.remove("hidden");
    } else {
      retryModify.classList.remove("hidden");
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
  configSubmit.addEventListener("click", () => {
    handleConfigSubmit();
  });

  generateButton.addEventListener("click", () => {
    runGeneration("create");
  });

  goToConfigGenerate.addEventListener("click", () => {
    setScreen("config");
  });

  retryGenerate.addEventListener("click", () => {
    if (lastGeneratePrompt) {
      generatePrompt.value = lastGeneratePrompt;
      runGeneration("create");
    }
  });

  modifyButton.addEventListener("click", () => {
    goToConfig.classList.add("hidden");
    runGeneration("modify");
  });

  retryModify.addEventListener("click", () => {
    if (lastModifyPrompt) {
      modifyPrompt.value = lastModifyPrompt;
      runGeneration("modify");
    }
  });

  cancelGeneration.addEventListener("click", async () => {
    if (!generationInFlight) return;
    await window.namagame.cancelGeneration();
    generationInFlight = false;
    setLoading(false, "", false);
  });

  goToConfig.addEventListener("click", () => {
    setScreen("config");
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

populateModels();
setScreen("config");
showPlayground();
void refreshHistory();
bindEvents();
