export type GameStatus = "idle" | "generating" | "success" | "error";

export interface GameInfo {
  status: GameStatus;
  projectName?: string;
  playgroundUrl?: string;
  projectDir?: string;
  errorMessage?: string;
  errorCode?: string;
}

export interface AiConfig {
  model: string;
  apiKey: string;
}

export type GenerateMode = "create" | "modify";

export interface GenerateRequest {
  prompt: string;
  mode: GenerateMode;
}

export interface GenerateResult {
  ok: boolean;
  game?: GameInfo;
  summary?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  errorMessage?: string;
  errorCode?: string;
}

export interface DownloadResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
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
