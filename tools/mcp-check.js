import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

function parseArgs() {
  const args = process.argv.slice(2);
  const prompt = args.join(" ").trim() || "30秒間でクリックしてスコアを稼ぐランキング形式のニコ生ゲームを生成してください。";
  return {
    prompt,
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  };
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  const mcpServerUrl = process.env.MCP_SERVER_URL;
  const targetDir = process.env.MCP_TARGET_DIR
    ? path.resolve(process.env.MCP_TARGET_DIR)
    : path.resolve(process.cwd(), "mcp-output");

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }
  if (!mcpServerUrl) {
    throw new Error("MCP_SERVER_URL is required.");
  }

  await fs.mkdir(targetDir, { recursive: true });

  const { prompt, model } = parseArgs();
  const client = new OpenAI({ apiKey });

  const developerInstruction = `
あなたはニコ生ゲーム生成専用の技術アシスタントです。
必ずMCPサーバーのツールを使ってゲームプロジェクトを生成してください。
出力はJSONのみ。コードブロック不要。
JSON形式: {"projectName":"...","projectDir":"...","summary":"..."}

必須フロー:
1) search_akashic_docs で必要APIを確認（短く）
2) 既存プロジェクトが無ければ init_project を1回だけ実行（推奨テンプレート: typescript-shin-ichiba-ranking）
3) 生成先ディレクトリは次のパスに固定する: ${targetDir}
4) create_game_file で game.json と main.ts/main.js を作成・更新

注意:
- init_project を同一リクエスト内で複数回呼ばない
- projectDir には ${targetDir} を返す
- 失敗時もJSONのみで理由を簡潔に返す
`;

  const response = await client.responses.create({
    model,
    tools: [
      {
        type: "mcp",
        server_label: "namagame_generator",
        server_description: "Nicolive game generator MCP server",
        server_url: mcpServerUrl,
        require_approval: "never",
      },
    ],
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: developerInstruction }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
  });

  const outputText = response.output_text ?? "";
  console.log("=== output_text ===");
  console.log(outputText);
  console.log("=== output ===");
  console.dir(response.output, { depth: null });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
