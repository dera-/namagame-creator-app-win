import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { InputAttachment } from "../shared/types.js";

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".ini",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".ts",
]);

export type PreparedAttachment = InputAttachment & {
  assetRelativePath?: string;
  assetAbsolutePath?: string;
  textContent?: string;
};

function sanitizeFileName(name: string): string {
  const ext = path.extname(name);
  const baseName = path.basename(name, ext);
  const normalizedBase = baseName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const normalizedExt = ext.replace(/[^a-zA-Z0-9.]+/g, "").slice(0, 12).toLowerCase();
  return `${normalizedBase || "attachment"}${normalizedExt}`;
}

function isTextAttachment(attachment: InputAttachment): boolean {
  if (attachment.kind === "text") {
    return true;
  }
  if (attachment.mimeType.startsWith("text/")) {
    return true;
  }
  return TEXT_EXTENSIONS.has(path.extname(attachment.name).toLowerCase());
}

function decodeTextAttachment(attachment: InputAttachment): string | undefined {
  if (!isTextAttachment(attachment)) {
    return undefined;
  }
  const decoded = Buffer.from(attachment.dataBase64, "base64").toString("utf-8");
  return decoded.replace(/^\uFEFF/, "");
}

function buildAssetRelativePath(attachment: InputAttachment, index: number): string {
  return `assets/user-attachments/${String(index + 1).padStart(2, "0")}-${sanitizeFileName(attachment.name)}`;
}

function formatPurposes(attachment: InputAttachment): string {
  const purposes: string[] = [];
  if (attachment.useAsAsset) {
    purposes.push("ゲームアセット");
  }
  if (attachment.useAsContext) {
    purposes.push("追加情報");
  }
  return purposes.join(" / ") || "未使用";
}

function truncateText(text: string, limit = 12000): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n[省略: ${text.length - limit} 文字]`;
}

export function prepareAttachments(
  attachments: InputAttachment[] | undefined,
  projectDir: string
): PreparedAttachment[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.useAsAsset || attachment.useAsContext)
    .map((attachment, index) => {
      const assetRelativePath = attachment.useAsAsset
        ? buildAssetRelativePath(attachment, index)
        : undefined;
      return {
        ...attachment,
        assetRelativePath,
        assetAbsolutePath: assetRelativePath ? path.join(projectDir, assetRelativePath) : undefined,
        textContent: attachment.useAsContext ? decodeTextAttachment(attachment) : undefined,
      };
    });
}

export function buildAttachmentPromptNotice(attachments: PreparedAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  const lines = ["添付ファイル:", "次の添付ファイルが与えられています。用途を守って利用してください。"];
  attachments.forEach((attachment) => {
    lines.push(
      `- ${attachment.name} (${attachment.kind}, ${attachment.mimeType || "unknown"}, ${attachment.size} bytes)`
    );
    lines.push(`  用途: ${formatPurposes(attachment)}`);
    if (attachment.useAsAsset && attachment.assetRelativePath) {
      lines.push(`  アセット配置先: ${attachment.assetRelativePath}`);
      if (attachment.kind === "font") {
        lines.push(
          "  注意: ニコ生ゲームのAkashic EngineはTTF/OTF/WOFFを実行時フォントとして直接読み込めません。"
        );
        lines.push(
          "  このファイルはプロジェクトに同梱するフォント資料です。ゲーム内で確実に同じ書体を使う必要がある場合は、対応するビットマップフォント（画像+glyph map）を別途用意して g.BitmapFont を利用してください。"
        );
      } else {
        lines.push(`  Akashic Engine からは /${attachment.assetRelativePath} を assetPaths に指定して読み込んでください。`);
        lines.push("  画像は scene.asset.getImage(パス)、音声は scene.asset.getAudio(拡張子なしのパス)、テキストは scene.asset.getTextContent(パス) などで取得してください。");
      }
    }
    if (attachment.useAsContext) {
      lines.push("  追加情報としても参照してください。");
    }
  });
  return lines.join("\n");
}

export function buildAttachmentConversationEntry(attachments: PreparedAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }
  const lines = attachments.map((attachment) => {
    const parts = [
      `- ${attachment.name}`,
      `  種類: ${attachment.kind}`,
      `  用途: ${formatPurposes(attachment)}`,
    ];
    if (attachment.assetRelativePath) {
      parts.push(`  配置先: ${attachment.assetRelativePath}`);
    }
    if (attachment.useAsContext && attachment.textContent) {
      parts.push(`  テキスト内容:\n${truncateText(attachment.textContent, 4000)}`);
    }
    return parts.join("\n");
  });
  return `添付ファイル履歴:\n${lines.join("\n")}`;
}

export function buildAttachmentInputItems(
  attachments: PreparedAttachment[]
): OpenAI.Responses.ResponseInput {
  const items: OpenAI.Responses.ResponseInput = [];

  attachments.forEach((attachment) => {
    if (!attachment.useAsContext) {
      return;
    }

    if (attachment.kind === "text" && attachment.textContent !== undefined) {
      items.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `添付テキストファイル: ${attachment.name}\n` +
              `用途: ${formatPurposes(attachment)}\n` +
              `内容:\n${truncateText(attachment.textContent)}`,
          },
        ],
        type: "message",
      });
      return;
    }

    if (attachment.kind === "image") {
      items.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text: `添付画像: ${attachment.name}\n用途: ${formatPurposes(attachment)}`,
          },
          {
            type: "input_image",
            detail: "high",
            image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
          },
        ],
        type: "message",
      });
      return;
    }

    if (attachment.kind === "audio") {
      items.push({
        role: "user",
        content: [
          {
            type: "input_text",
            text: `添付音声: ${attachment.name}\n用途: ${formatPurposes(attachment)}`,
          },
          {
            type: "input_file",
            filename: attachment.name,
            file_data: attachment.dataBase64,
          },
        ],
        type: "message",
      });
      return;
    }

    items.push({
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            `添付ファイル: ${attachment.name}\n` +
            `種類: ${attachment.kind}\n` +
            `用途: ${formatPurposes(attachment)}\n` +
            "この形式は追加情報としてはメタデータのみ参照できます。",
        },
      ],
      type: "message",
    });
  });

  return items;
}

export async function materializeAssetAttachments(
  attachments: PreparedAttachment[]
): Promise<string[]> {
  const writtenPaths: string[] = [];
  for (const attachment of attachments) {
    if (!attachment.useAsAsset || !attachment.assetAbsolutePath || !attachment.assetRelativePath) {
      continue;
    }
    await fs.mkdir(path.dirname(attachment.assetAbsolutePath), { recursive: true });
    await fs.writeFile(attachment.assetAbsolutePath, Buffer.from(attachment.dataBase64, "base64"));
    writtenPaths.push(attachment.assetRelativePath);
  }
  return writtenPaths;
}
