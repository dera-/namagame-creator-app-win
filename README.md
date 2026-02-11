# Namagame Creator

ニコ生ゲームをテキストから生成・修正し、プレイ確認や配布用パッケージの作成まで行えるWindows向けデスクトップアプリです。  
生成済みプロジェクトの読み込みにも対応し、既存ゲームの改造にも使えます。

## アプリケーションの概要
- テキスト入力からニコ生ゲームを生成・修正
- 生成ゲームをアプリ内で実行 (Playground)
- デバッグ画面 (Akashic Sandbox) をアプリ内/外部ブラウザで表示
- ニコ生ゲーム用パッケージ/プロジェクトのダウンロード
- 既存プロジェクトの読み込み (フォルダ選択/ドラッグ&ドロップ)

## 環境設定
### 必須
- Node.js (LTS推奨)
- pnpm (package.json の `packageManager` に準拠)
- Git
- ffmpeg
- @akashic/akashic-cli

### 初期セットアップ
```bash
git submodule update --init --recursive
pnpm install
```

### Playground ビルド
Playground を `playground/` サブモジュールからビルドします。
```bash
cd playground
npm install
npm run build
cd ..
```

### MCPサーバー起動
アプリ起動時にMCPサーバーをローカルで自動起動します。
初回のみ `akashic-mcp/` の依存関係が未インストールの場合は自動で `npm install` を実行します。

## 使い方
1. アプリ起動後、モデルとAPIキーを入力して「決定」
2. ゲーム生成画面で以下のいずれかを実行
   - テキストを入力して「ゲーム生成」
   - 既存プロジェクトの読み込み (フォルダ選択/ドラッグ&ドロップ)
3. ゲーム実行画面で確認
   - Playgroundで動作確認
   - デバッグ画面を開いてDevToolsで詳細確認
4. 必要に応じて「ゲーム修正」やダウンロードを実行

## ビルド
### 開発ビルド
```bash
pnpm run build
```

### アプリ起動
```bash
pnpm start
```

### 配布用パッケージ
```bash
pnpm run pack
```

## ライセンス
MIT License (package.json の `license` に準拠)
