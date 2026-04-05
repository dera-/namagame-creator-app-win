import test from "node:test";
import assert from "node:assert/strict";
import { toErrorCode, toErrorMessage, toUiHistory, buildImportedProjectConversationPrompt } from "../generation.js";

test("toUiHistory は hidden を除外し assistant summary を優先する", () => {
  const history = toUiHistory([
    { role: "developer", content: "internal", hidden: true },
    { role: "user", content: "user prompt" },
    { role: "assistant", content: "full response", summary: "short summary" },
  ]);

  assert.deepEqual(history, [
    { role: "user", content: "user prompt" },
    { role: "assistant", content: "short summary" },
  ]);
});

test("toErrorMessage は Error と非 Error を扱える", () => {
  assert.equal(toErrorMessage(new Error("boom")), "boom");
  assert.equal(toErrorMessage("x"), "不明なエラーが発生しました。");
});

test("toErrorCode は invalid api key 系を正規化する", () => {
  assert.equal(toErrorCode({ code: "invalid_api_key" }), "invalid_api_key");
  assert.equal(toErrorCode({ status: 401 }), "invalid_api_key");
  assert.equal(toErrorCode({ message: "Invalid API key provided" }), "invalid_api_key");
  assert.equal(toErrorCode({ status: 500 }), undefined);
});

test("buildImportedProjectConversationPrompt は既存プロジェクト修正文言を含む", () => {
  const prompt = buildImportedProjectConversationPrompt();
  assert.match(prompt, /既存プロジェクト修正用プロンプト/);
  assert.match(prompt, /既存ファイルを最大限維持/);
});
