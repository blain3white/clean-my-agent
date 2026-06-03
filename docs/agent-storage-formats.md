# Agent Storage Formats

This note documents local storage shapes observed from installed tools on macOS. It is intentionally schema-focused: do not copy prompt text, tool output, auth data, or user file contents into this document.

## Codex

Observed roots:

- `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
- `~/.codex/archived_sessions/*.jsonl`
- `~/.codex/session_index.jsonl`

Primary session files are JSONL event streams. Common record shapes:

```ts
type CodexRecord =
  | { type: 'session_meta'; timestamp?: string; payload?: { id?: string; cwd?: string; git?: { branch?: string } } }
  | { type: 'response_item'; timestamp?: string; payload?: { role?: string; content?: Array<{ type?: string; text?: string }> } }
  | { type: 'event_msg' | 'turn_context'; timestamp?: string; payload?: Record<string, unknown> }
```

Parsing notes:

- Project path is usually `payload.cwd` on `session_meta` or `turn_context`.
- Branch is usually `payload.git.branch`.
- Message content usually appears on `response_item.payload.content[]`.
- Token usage should only be read from explicit `usage`-like objects when present; do not infer from file size or message text.

## Claude Code

Observed roots:

- `~/.claude/projects/<encoded-project-path>/*.jsonl`
- `~/.claude/projects/<encoded-project-path>/<session-id>/subagents/*.jsonl`
- `~/.claude/transcripts/*.jsonl`

Project JSONL records are richer than transcript JSONL records. Common project record shapes:

```ts
type ClaudeRecord = {
  type?: 'user' | 'assistant' | 'attachment' | 'queue-operation' | 'last-prompt' | string
  uuid?: string
  parentUuid?: string | null
  timestamp?: string
  cwd?: string
  sessionId?: string
  gitBranch?: string
  message?: {
    role?: 'user' | 'assistant' | 'system'
    content?: string | Array<{ type?: string; text?: string }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}
```

Parsing notes:

- `cwd`, `sessionId`, and `gitBranch` are often top-level.
- User and assistant text usually lives under `message.content`.
- Assistant usage lives under `message.usage`.
- Transcript files may be simpler, with top-level `type`, `timestamp`, and `content`.

## Cursor

Observed roots:

- `~/Library/Application Support/Cursor/User/workspaceStorage/<workspace-hash>/workspace.json`
- `~/Library/Application Support/Cursor/User/workspaceStorage/<workspace-hash>/state.vscdb`
- `~/Library/Application Support/Cursor/User/globalStorage`

Cursor uses VS Code-style workspace storage. `workspace.json` identifies the workspace, while `state.vscdb` is a SQLite database with `ItemTable` and `cursorDiskKV`.

Observed `ItemTable` keys include:

- `composer.composerData`
- `workbench.backgroundComposer.workspacePersistentData`
- `workbench.panel.composerChatViewPane.<uuid>`
- `workbench.panel.aichat.<uuid>.numberOfVisibleViews`

Parsing notes:

- Treat `state.vscdb` as a key-value database, not as JSON text.
- `workspace.json` can provide the workspace path or folder.
- Composer and chat payloads are nested JSON strings stored as values.
- Token usage may not be available in local storage; missing usage should remain 0.

## OpenCode

Observed roots:

- `~/.local/share/opencode/storage/agent-usage-reminder/*.json`
- `~/.local/share/opencode/storage/directory-readme/*.json`
- `~/.local/share/opencode/storage/session_diff/*.json`
- `~/.local/share/opencode/tool-output/*`
- `~/.local/share/opencode/snapshot/*`

Observed storage records are bucket-specific JSON documents:

```ts
type OpenCodeStorageRecord = {
  sessionID?: string
  updatedAt?: number
  agentUsed?: boolean
  reminderCount?: number
  injectedPaths?: string[]
}
```

Parsing notes:

- `storage/session_diff/*.json` may be an array of diff entries or empty.
- `storage/agent-usage-reminder/*.json` and `storage/directory-readme/*.json` are metadata buckets, not full chat transcripts.
- `tool-output/*` may contain command/tool output and should be handled carefully.
- Missing token usage should remain 0.

## Parser Rules

- Prefer source-specific type guards from `electron/lib/agent-storage-formats.ts`.
- Only parse token counts from explicit usage fields such as `usage`, `token_usage`, or `tokenUsage`.
- Do not estimate tokens from text length or file size.
- Store raw samples only in memory/metadata at runtime; never commit user content fixtures.
- Keep roots configurable through app settings because these tools change storage layouts over time.
