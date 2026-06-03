# Clean My Agent

Clean, back up, and move your AI coding sessions.

Clean My Agent is a local-first Electron desktop app for developers who use multiple AI coding agents. It scans local session data from Codex, Claude Code, Cursor, Gemini, and OpenCode, then helps you understand storage usage, token usage, backup state, and cleanup opportunities.

The current version focuses on cleanup and usage statistics. Context relay is implemented as a universal JSON export format first, so agent-specific converters can be added without coupling the UI to each agent's internal storage format.

## Features

- Scan local sessions from Codex, Claude Code, Cursor, Gemini, and OpenCode.
- Show session counts, backup status, reclaimable space, token usage, and storage breakdowns.
- Search sessions across agents.
- Back up individual sessions before risky cleanup actions.
- Export sessions as Markdown, JSON, or universal relay JSON.
- Detect old sessions, backed-up sessions, large logs, and duplicate backups.
- Move cleanup candidates to app-managed Trash instead of permanent deletion.
- Restore items from Trash.
- Keep credential-like files out of scans by default.

## Safety Model

Clean My Agent is designed to be safe by default:

- It reads agent data before writing anything.
- Cleanup suggestions are generated first and require explicit action.
- Unbacked cleanup candidates are backed up before being moved.
- Deleted files move to Clean My Agent Trash and can be restored.
- Tokens, API keys, OAuth data, `.env` files, and credential-like files are ignored by the scanner.

## Tech Stack

- Electron
- React
- TypeScript
- Tailwind CSS
- shadcn/radix components
- Node.js 24
- Node built-in SQLite
- pnpm

## Development

Requirements:

- Node.js 24.10.0 or newer
- pnpm 10 or newer

Install dependencies:

```bash
pnpm install
```

Start the desktop app:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

Lint:

```bash
pnpm lint
```

Run the functional smoke test:

```bash
pnpm verify:functions
```

The smoke test creates temporary fake agent session data and verifies scanning, token statistics, backup, Markdown/JSON export, universal relay JSON export, cleanup to Trash, and Trash restore.

## Universal Relay JSON

The relay export currently uses this schema:

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

This is intended as the stable intermediate format. Future converters can transform it into Codex, Claude Code, Cursor, Gemini, or OpenCode-specific formats.

## Status

This is an early open-source version. The app is usable for local scanning, statistics, backup, export, cleanup suggestions, Trash, and universal relay JSON export. Agent-specific import/continue-session workflows are intentionally not finalized yet.

## License

MIT
