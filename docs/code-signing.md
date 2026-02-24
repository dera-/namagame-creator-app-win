# Electron Builder署名フロー（自己署名 -> 本番移行）

このプロジェクトでは次の3段階で署名運用します。

1. 自己署名証明書を作成する
2. 生成バイナリへ署名を付与する
3. 本番証明書へ切り替えられる構成を維持する

## 1) 自己署名証明書を作成

```bash
npm run cert:create:self-signed
```

出力先: `certs/dev/`

- `codesign-dev.key.pem`: 秘密鍵
- `codesign-dev.crt.pem`: 公開証明書
- `codesign-dev.p12` / `codesign-dev.pfx`: electron-builder用
- `README.txt`: 生成時のパスワードと環境変数例

`README.txt` の値を読み、以下を環境変数として設定します。

```bash
export CSC_LINK="/absolute/path/to/certs/dev/codesign-dev.p12"
export CSC_KEY_PASSWORD="<README.txt に表示された値>"
export SIGN_CERT_PATH="/absolute/path/to/certs/dev/codesign-dev.crt.pem"
export SIGN_KEY_PATH="/absolute/path/to/certs/dev/codesign-dev.key.pem"
```

## 2) 生成バイナリへ署名付与

### Windows

```bash
npm run pack:win:signed
```

- `CSC_LINK` + `CSC_KEY_PASSWORD` を使って `electron-builder` が署名します。
- 配布先で警告を避けるには、受信側端末に自己署名証明書の信頼登録が必要です。

### macOS

```bash
npm run pack:mac:signed
```

- 技術的には自己署名で署名できます。
- ただし Gatekeeper 回避には使えません（配布運用は Developer ID + notarization が必須）。

### Linux

```bash
npm run pack:linux:signed
```

- Linux成果物に対して `SHA256SUMS-linux.txt` を生成。
- `SIGN_KEY_PATH` で `SHA256SUMS-linux.txt.sig` を生成。
- `linux-signing-cert.pem` を同梱（検証用公開証明書）。

検証例:

```bash
openssl x509 -in dist/linux-signing-cert.pem -pubkey -noout > /tmp/linux-signing.pub
openssl dgst -sha256 -verify /tmp/linux-signing.pub -signature dist/SHA256SUMS-linux.txt.sig dist/SHA256SUMS-linux.txt
```

## 3) 本番証明書への移行

このリポジトリは、証明書実体をコードに埋め込まず環境変数で切り替える設計です。

- `CSC_LINK`, `CSC_KEY_PASSWORD`: Windows/macOS 署名証明書
- `SIGN_CERT_PATH`, `SIGN_KEY_PATH`: Linux成果物署名

運用切り替え:

1. CIシークレットに本番証明書を登録
2. CIで上記環境変数を本番値に差し替え
3. `npm run pack:win:prod` / `pack:mac:prod` / `pack:linux:prod` を実行

### macOS本番配布時の必須事項

- Apple Developer Program の `Developer ID Application` 証明書を使用
- notarization (Apple notary service) を実施
- `@electron/notarize` をインストール (`npm i -D @electron/notarize`)
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` を設定

## 補足

- `certs/` は `.gitignore` 済みです。
- 秘密鍵は配布しないでください。
- 自己署名は開発・社内検証向けです。
