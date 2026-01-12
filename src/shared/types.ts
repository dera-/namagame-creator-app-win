export type GameStatus = "idle" | "generating" | "success" | "error";
export type LlmRole = "user" | "assistant" | "developer";

export interface GameInfo {
  status: GameStatus;
  projectName?: string;
  playgroundUrl?: string;
  debugUrl?: string;
  projectDir?: string;
  errorMessage?: string;
  errorCode?: string;
}

export interface AiConfig {
  model: string;
  designModel?: string;
  apiKey: string;
}

export type GenerateMode = "create" | "modify";

export interface GenerateRequest {
  prompt: string;
  mode: GenerateMode;
  designTemperature?: number;
  forbidGameJsonUpdate?: boolean;
  useDesignModel?: boolean;
}

export interface GenerateResult {
  ok: boolean;
  game?: GameInfo;
  summary?: string;
  history?: Array<{ role: LlmRole; content: string }>;
  warningMessage?: string;
  errorMessage?: string;
  errorCode?: string;
}

export interface DownloadResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  errorMessage?: string;
}

export interface LoadProjectResult {
  ok: boolean;
  game?: GameInfo;
  errorMessage?: string;
}

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  message?: string;
}
