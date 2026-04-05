import test from "node:test";
import assert from "node:assert/strict";
import {
  callMcpTool,
  getToolCallMaxIterations,
  toDeveloperMessagesFromPrompt,
  toInputMessagesFromPrompt,
} from "../mcp.js";

test("getToolCallMaxIterations は不正値時にデフォルトを返す", () => {
  const previous = process.env.MCP_TOOL_CALL_MAX_ITERATIONS;
  process.env.MCP_TOOL_CALL_MAX_ITERATIONS = "0";
  assert.equal(getToolCallMaxIterations(), 24);
  process.env.MCP_TOOL_CALL_MAX_ITERATIONS = "7";
  assert.equal(getToolCallMaxIterations(), 7);
  if (previous == null) delete process.env.MCP_TOOL_CALL_MAX_ITERATIONS;
  else process.env.MCP_TOOL_CALL_MAX_ITERATIONS = previous;
});

test("prompt message 変換は role と content を正規化する", () => {
  const inputMessages = toInputMessagesFromPrompt([
    { role: "assistant", content: { text: "assistant text" } },
    { role: "x", content: [{ text: "line1" }, "line2"] },
    { role: "developer", content: "" },
  ]);
  assert.deepEqual(inputMessages, [
    { role: "assistant", content: "assistant text" },
    { role: "user", content: "line1\nline2" },
  ]);

  const developerMessages = toDeveloperMessagesFromPrompt([
    { role: "user", content: { a: 1 } },
    { role: "assistant", content: "dev body" },
  ]);
  assert.deepEqual(developerMessages, [
    { role: "developer", content: '{"a":1}' },
    { role: "developer", content: "dev body" },
  ]);
});

test("callMcpTool は不正JSONをエラー文字列に変換する", async () => {
  const result = await callMcpTool("http://mock-mcp", "tool", "{broken");
  assert.match(result, /JSON解析/);
});

test("callMcpTool は fetch 結果を文字列化する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        content: [{ text: "tool output" }],
      }),
    })) as unknown as typeof fetch;

  try {
    const result = await callMcpTool("http://mock-mcp", "tool", '{"x":1}');
    assert.equal(result, "tool output");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callMcpTool は fetch 非200系をエラー文字列に変換する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 500,
      json: async () => null,
    })) as unknown as typeof fetch;

  try {
    const result = await callMcpTool("http://mock-mcp", "tool", "{}");
    assert.match(result, /500/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
