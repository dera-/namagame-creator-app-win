import { run } from "@akashic/akashic-cli-serve/lib/server/index.js";

type StartedMessage = {
  type: "started";
  port: number;
};

type ErrorMessage = {
  type: "error";
  message: string;
};

function sendMessage(message: StartedMessage | ErrorMessage): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

async function waitForServerReady(url: string, timeoutMs = 30000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Akashic Serve の起動待機がタイムアウトしました。");
}

async function main(): Promise<void> {
  const port = Number(process.argv[2]);
  const projectDir = process.argv[3];

  if (!Number.isFinite(port) || !projectDir) {
    throw new Error("Akashic Serve child process requires port and projectDir.");
  }

  process.on("disconnect", () => {
    process.exit(0);
  });

  void run([
    process.execPath,
    "akashic-cli-serve",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
    "-s",
    "nicolive",
    "-B",
    projectDir,
  ]).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    sendMessage({ type: "error", message });
    process.exit(1);
  });

  await waitForServerReady(`http://127.0.0.1:${port}/health-check/status`);

  sendMessage({ type: "started", port });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  sendMessage({ type: "error", message });
  process.exit(1);
});
