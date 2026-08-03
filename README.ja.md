# Clean My Agent

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md)

![Clean My Agent hero](docs/assets/clean-my-agent-hero.png)

Clean My Agent は、AI コーディングエージェントのセッションデータをクリーンアップ、バックアップ、エクスポート、理解するためのローカルファーストなデスクトップアプリです。

Codex、Claude Code、Cursor、Gemini、OpenCode のローカルセッションをスキャンし、散らばったログを、ストレージ、token 使用量、クリーンアップ候補、バックアップ、Universal Relay エクスポートを確認できる見やすいダッシュボードにまとめます。

## ダウンロード

Homebrew で最新の macOS Apple Silicon ビルドをインストールできます。

```sh
brew tap blain3white/clean-my-agent https://github.com/blain3white/clean-my-agent.git
brew install --cask clean-my-agent
```

以後の更新は次のコマンドで行えます。

```sh
brew upgrade --cask clean-my-agent
```

または GitHub Releases から最新の DMG をダウンロードしてください。

[Clean My Agent for macOS をダウンロード](https://github.com/blain3white/clean-my-agent/releases/latest/download/Clean-My-Agent-mac-arm64.dmg)

ダウンロードした `.dmg` を開き、Clean My Agent を Applications にドラッグしてから Applications から起動します。

現在のデスクトップビルドは未署名です。初回起動時に macOS Gatekeeper にブロックされた場合は、「システム設定」→「プライバシーとセキュリティ」で Clean My Agent を許可するか、アプリを右クリックして「開く」を選択してください。

## なぜ必要か

AI コーディングエージェントは、会話、ログ、プロジェクトメタデータ、キャッシュファイル、バックアップ、ツール実行の痕跡など、多くのローカル状態を作成します。これらのデータは有用ですが、確認、移動、安全なクリーンアップが難しくなることがあります。

Clean My Agent は、開発者が次の問いに一か所で答えられるようにします。

- どのエージェントが最も多くのディスク容量を使っているか？
- どのセッションが異常に大きい、または古くなっているか？
- ファイルを完全削除せずに何をクリーンアップできるか？
- どのセッションがバックアップ済みか？
- 複数エージェントにまたがってどれだけの token 活動が蓄積されているか？
- セッションをポータブルな relay 形式にエクスポートできるか？

## 機能

- Codex、Claude Code、Cursor、Gemini、OpenCode のローカルセッションをスキャン。
- セッション数、バックアップ状態、回収可能な容量、token 使用量、ストレージ内訳を表示。
- サポート対象エージェントを横断してセッションを検索、確認。
- リスクのあるクリーンアップ操作の前に個別セッションをバックアップ。
- セッションを Markdown、JSON、Universal Relay JSON としてエクスポート。
- 古いセッション、バックアップ済みセッション、大きなログ、重複バックアップを検出。
- クリーンアップ候補を完全削除ではなく、アプリ管理のゴミ箱へ移動。
- ゴミ箱から項目を復元。
- 認証情報に似たファイルをデフォルトでスキャン対象外にする。
- アプリのインターフェースを英語、中国語、日本語、フランス語で切り替え。
- ダッシュボードのライトテーマとダークテーマをサポート。

## 安全モデル

Clean My Agent はデフォルトで安全になるように設計されています。

- 何かを書き込む前にローカルエージェントデータを読み取ります。
- クリーンアップ提案を先に生成し、実行には明示的な操作が必要です。
- 未バックアップのクリーンアップ候補は、移動前にバックアップされます。
- 削除されたファイルは Clean My Agent のゴミ箱へ移動し、復元できます。
- scanner は token、API key、OAuth データ、`.env` ファイル、認証情報に似たファイルを無視します。
- クリーンアップ、バックアップ、エクスポート、ゴミ箱の動作は機能スモークテストでカバーされています。

## サポート対象ソース

| ソース      | 状態                                                         |
| ----------- | ------------------------------------------------------------ |
| Codex       | スキャン、使用量、バックアップ、エクスポート、クリーンアップ |
| Claude Code | スキャン、使用量、バックアップ、エクスポート、クリーンアップ |
| Cursor      | スキャン、使用量、バックアップ、エクスポート、クリーンアップ |
| Gemini      | スキャン、使用量、バックアップ、エクスポート、クリーンアップ |
| OpenCode    | スキャン、使用量、バックアップ、エクスポート、クリーンアップ |

## Universal Relay JSON

relay エクスポートは安定した中間 schema を使用します。

```json
{
  "schema": "clean-my-agent.universal-session.v1",
  "source": "codex",
  "session": {},
  "messages": [],
  "files": [],
  "commands": [],
  "git": {},
  "attachments": [],
  "warnings": []
}
```

この形式は、エージェントのセッションデータをアーカイブ、確認しやすくし、最終的には各エージェント固有の形式間で変換できるようにすることを目的としています。UI を各エージェントの内部ストレージ構造に密結合させないための中間形式でもあります。

## 技術スタック

- Electron
- React
- TypeScript
- Vite / electron-vite
- Tailwind CSS
- Radix / shadcn-style UI primitives
- 開発には Node.js 22.13 以降
- Electron 42、デスクトップ実行時は Node.js 24.x
- Node built-in SQLite
- pnpm

## 開発

必要条件:

- Node.js 22.13.0 以降
- pnpm 10 以降

依存関係をインストール:

```bash
pnpm install
```

デスクトップアプリを起動:

```bash
pnpm dev
```

renderer のみの開発サーバーを起動:

```bash
pnpm dev:renderer
```

ビルド:

```bash
pnpm build
```

macOS Apple Silicon DMG をビルド:

```bash
pnpm dist:mac
```

Lint:

```bash
pnpm lint
```

機能スモークテストを実行:

```bash
pnpm verify:functions
```

スモークテストは一時的な偽のエージェントセッションデータを作成し、スキャン、token 統計、バックアップ、Markdown/JSON エクスポート、Universal Relay JSON エクスポート、ゴミ箱へのクリーンアップ、ゴミ箱からの復元を検証します。

ローカル CI gate 全体を実行:

```bash
pnpm check
```

通常、コントリビューションは `develop` からブランチを作成し、`develop` へ pull request を開きます。セットアップ、スタイル、テスト、安全性、pull request のガイドは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。メンテナー向けのブランチ保護推奨事項は [docs/maintainer-guide.md](docs/maintainer-guide.md) にあります。

## プロジェクト構成

- `electron/main.ts`: Electron ウィンドウ設定と IPC 登録。
- `electron/preload.ts`: renderer-safe API bridge。
- `electron/lib/`: スキャンアダプター、ファイルシステムヘルパー、データベース、app service ロジック。
- `src/App.tsx`: メインダッシュボード UI とビュー。
- `src/components/ui/`: 共有 UI primitives。
- `src/hooks/`: renderer 状態とテーマ hooks。
- `src/shared/types.ts`: プロセス間の型と共有 contract。
- `scripts/verify-functions.ts`: 偽のローカルセッションデータを使った機能スモークテスト。

## ロードマップ

- より詳細なセッション詳細ビューを追加。
- 形式の変化に合わせてエージェント固有のストレージアダプターを拡張。
- Universal JSON schema の上に relay コンバーターをさらに追加。
- 異なる保持ポリシーを持つチーム向けにクリーンアップポリシー制御を改善。
- 初回起動をよりスムーズにするため、署名済みかつ notarized なデスクトップビルドを追加。

## 状態

これは初期のオープンソース版です。アプリは、ローカルスキャン、統計、バックアップ、エクスポート、クリーンアップ提案、ゴミ箱、Universal Relay JSON エクスポートに利用できます。エージェント固有のインポートと continue-session ワークフローは、意図的にまだ最終化していません。

## ライセンス

MIT
