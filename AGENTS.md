# Agent Notes

Clean My Agent is a local-first Electron app for scanning, backing up, exporting, and safely cleaning AI coding-agent session data.

## Stack

- Electron + React + TypeScript
- Vite / electron-vite
- Tailwind CSS + Radix/shadcn-style UI
- Node.js 22.13+ for development, pnpm 10
- Electron 42 provides Node.js 24.x at desktop runtime
- Node built-in SQLite for app state

## Commands

- Install: `pnpm install`
- Desktop dev app: `pnpm dev`
- Renderer-only dev: `pnpm dev:renderer`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Unit tests: `pnpm test`
- Full local gate: `pnpm check`
- Functional smoke test: `pnpm verify:functions`

## Project Map

- `electron/main.ts`: Electron window setup and IPC registration.
- `electron/preload.ts`: renderer-safe API bridge.
- `electron/lib/`: scanning adapters, filesystem helpers, database, app service.
- `src/App.tsx`: main dashboard UI and views.
- `src/components/ui/`: shared UI primitives.
- `src/hooks/`: renderer state and theme hooks.
- `src/shared/types.ts`: cross-process types; update this first when changing IPC data shapes.
- `scripts/verify-functions.ts`: end-to-end smoke test with fake local session data.

## Working Rules

- Keep the safety model intact: read first, suggest cleanup first, back up before risky moves, move to app Trash instead of permanent deletion.
- Do not scan or copy credential-like files (`.env`, tokens, OAuth data, API keys).
- Prefer updating adapters/service logic in `electron/lib/` instead of coupling agent-specific behavior into UI components.
- Keep IPC payloads typed through `src/shared/types.ts`.
- Use existing UI primitives and lucide icons before adding new component patterns.
- After touching cleanup, backup, export, scan, or Trash behavior, run `pnpm verify:functions`.
- After UI-only changes, run at least `pnpm lint`; run `pnpm build` when types or shared contracts changed.

## Open Source Workflow

- Prefer branching feature work from `develop`; keep `main` stable and release-ready.
- Run `pnpm check` before proposing or committing infrastructure, shared contract, Electron, or safety-sensitive changes.
- Keep contributor-facing workflow details in `CONTRIBUTING.md` and maintainer policy details in `docs/maintainer-guide.md`.
- Use Prettier for project formatting; avoid hand-formatting churn outside the files involved in a change.

## Commit Rules

- Inspect `git status --short` before staging.
- Never stage unrelated files, user edits, generated assets, or another agent's work unless the user explicitly asks for them.
- Stage explicit paths only; avoid broad `git add .` in a dirty worktree.
- Run the relevant checks before committing. Use `pnpm build` when TypeScript contracts, Electron IPC, or bundled assets changed.
- Use concise imperative commit messages that name the scope.
- Push only after the commit succeeds and the checked files still match the intended scope.

## Notes

- Universal relay export schema is `clean-my-agent.universal-session.v1`.
- Current agent sources: Codex, Claude Code, Cursor, Gemini, OpenCode.
