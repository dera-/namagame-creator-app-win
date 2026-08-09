import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildAttachmentPromptNotice,
  materializeAssetAttachments,
  prepareAttachments,
} from "../attachments.js";

test("フォント添付はゲームプロジェクトに配置され、直接利用不可の注意を生成する", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "namagame-attachments-test-"));
  const attachments = prepareAttachments(
    [
      {
        id: "font-1",
        name: "Game Font.ttf",
        mimeType: "font/ttf",
        dataBase64: Buffer.from("font-data").toString("base64"),
        size: 9,
        kind: "font",
        useAsAsset: true,
        useAsContext: false,
      },
    ],
    projectDir
  );

  const paths = await materializeAssetAttachments(attachments);

  assert.deepEqual(paths, ["assets/user-attachments/01-Game-Font.ttf"]);
  assert.equal(
    await fs.readFile(path.join(projectDir, paths[0]), "utf-8"),
    "font-data"
  );
  assert.match(buildAttachmentPromptNotice(attachments), /直接読み込めません/);
  assert.match(buildAttachmentPromptNotice(attachments), /BitmapFont/);
});
