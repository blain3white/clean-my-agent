# Clean My Agent

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja.md) | [Français](README.fr.md)

![Clean My Agent hero](docs/assets/clean-my-agent-hero.png)

Clean My Agent 是一个本地优先的桌面应用，用于清理、备份、导出和理解 AI 编程 Agent 的会话数据。

它会扫描 Codex、Claude Code、Cursor、Gemini 和 OpenCode 的本地会话，并把分散的日志整理成清晰的仪表盘，展示存储占用、token 用量、清理机会、备份状态和通用 relay 导出。

## 下载

使用 Homebrew 安装最新的 macOS Apple Silicon 构建：

```sh
brew tap blain3white/clean-my-agent
brew install --cask clean-my-agent
```

之后可以这样更新：

```sh
brew upgrade --cask clean-my-agent
```

也可以从 GitHub Releases 下载最新 DMG：

[下载 Clean My Agent for macOS](https://github.com/blain3white/clean-my-agent/releases/latest/download/Clean-My-Agent-mac-arm64.dmg)

打开下载的 `.dmg`，把 Clean My Agent 拖入 Applications，然后从 Applications 启动。

当前桌面构建尚未签名。如果 macOS Gatekeeper 阻止首次启动，请打开“系统设置”→“隐私与安全性”并允许 Clean My Agent，或右键应用并选择“打开”。

## 为什么需要它

AI 编程 Agent 会生成大量本地状态：对话、日志、项目元数据、缓存文件、备份和工具调用痕迹。这些数据很有用，但也会变得难以检查、迁移或安全清理。

Clean My Agent 让开发者可以在一个地方回答这些问题：

- 哪些 Agent 占用了最多磁盘空间？
- 哪些会话异常庞大或已经过期？
- 哪些内容可以清理，而且不会永久删除文件？
- 哪些会话已经备份？
- 多个 Agent 累积了多少 token 活动？
- 会话能否导出为可移植的 relay 格式？

## 功能

- 扫描 Codex、Claude Code、Cursor、Gemini 和 OpenCode 的本地会话。
- 展示会话数量、备份状态、可回收空间、token 用量和存储明细。
- 跨支持的 Agent 搜索并检查会话。
- 在风险清理操作前备份单个会话。
- 将会话导出为 Markdown、JSON 或通用 relay JSON。
- 检测旧会话、已备份会话、大型日志和重复备份。
- 将清理候选项移动到应用管理的回收站，而不是永久删除。
- 从回收站恢复项目。
- 默认避免扫描凭据类文件。
- 在英文、中文、日文和法语之间切换应用界面。
- 支持仪表盘浅色和深色主题。

## 安全模型

Clean My Agent 的设计目标是默认安全。

- 写入任何内容前先读取本地 Agent 数据。
- 先生成清理建议，并要求用户显式执行。
- 未备份的清理候选项会先备份，再移动。
- 删除的文件会进入 Clean My Agent 回收站，并且可以恢复。
- scanner 会忽略 token、API key、OAuth 数据、`.env` 文件和凭据类文件。
- 清理、备份、导出和回收站行为由功能烟测覆盖。

## 支持的数据来源

| 来源        | 状态                         |
| ----------- | ---------------------------- |
| Codex       | 扫描、用量、备份、导出、清理 |
| Claude Code | 扫描、用量、备份、导出、清理 |
| Cursor      | 扫描、用量、备份、导出、清理 |
| Gemini      | 扫描、用量、备份、导出、清理 |
| OpenCode    | 扫描、用量、备份、导出、清理 |

## Universal Relay JSON

relay 导出使用稳定的中间 schema：

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

这个格式旨在让 Agent 会话数据更容易归档、检查，并最终在不同 Agent 的专用格式之间转换，同时避免 UI 耦合到每个 Agent 的内部存储布局。

## 技术栈

- Electron
- React
- TypeScript
- Vite / electron-vite
- Tailwind CSS
- Radix / shadcn-style UI primitives
- Node.js 22.13 或更新版本用于开发
- Electron 42，桌面运行时使用 Node.js 24.x
- Node built-in SQLite
- pnpm

## 开发

环境要求：

- Node.js 22.13.0 或更新版本
- pnpm 10 或更新版本

安装依赖：

```bash
pnpm install
```

启动桌面应用：

```bash
pnpm dev
```

启动仅 renderer 的开发服务器：

```bash
pnpm dev:renderer
```

构建：

```bash
pnpm build
```

构建 macOS Apple Silicon DMG：

```bash
pnpm dist:mac
```

Lint：

```bash
pnpm lint
```

运行功能烟测：

```bash
pnpm verify:functions
```

功能烟测会创建临时的假 Agent 会话数据，并验证扫描、token 统计、备份、Markdown/JSON 导出、通用 relay JSON 导出、清理到回收站和回收站恢复。

运行完整本地 CI gate：

```bash
pnpm check
```

贡献通常从 `develop` 分支创建分支，并向 `develop` 发起 pull request。设置、代码风格、测试、安全和 pull request 指南请见 [CONTRIBUTING.md](CONTRIBUTING.md)。维护者侧的分支保护建议位于 [docs/maintainer-guide.md](docs/maintainer-guide.md)。

## 项目结构

- `electron/main.ts`: Electron 窗口设置和 IPC 注册。
- `electron/preload.ts`: renderer-safe API bridge。
- `electron/lib/`: 扫描适配器、文件系统工具、数据库和 app service 逻辑。
- `src/App.tsx`: 主仪表盘 UI 和视图。
- `src/components/ui/`: 共享 UI primitives。
- `src/hooks/`: renderer 状态和主题 hooks。
- `src/shared/types.ts`: 跨进程类型和共享契约。
- `scripts/verify-functions.ts`: 使用假本地会话数据的功能烟测。

## 路线图

- 增加更丰富的会话详情视图。
- 随着格式演进，扩展 Agent 专用存储适配器。
- 在通用 JSON schema 之上增加更多 relay 转换器。
- 为有不同保留策略的团队改进清理策略控制。
- 添加签名和 notarized 桌面构建，让首次启动更顺滑。

## 状态

这是早期开放源代码版本。应用已经可用于本地扫描、统计、备份、导出、清理建议、回收站和通用 relay JSON 导出。Agent 专用导入和继续会话工作流仍然有意保持未最终定稿。

## 许可证

MIT
