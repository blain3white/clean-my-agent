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
- Do not do day-to-day development on `main`; switch to `develop` or create a feature branch from `develop` before making changes.
- If development happens in a worktree, merge the finished branch back into `develop` after verification passes.
- Every pull request must pass the required `GitNexus Report` CI job; the job writes the GitNexus analysis into the PR body, and PRs without that section must not merge.
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

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **clean-my-agent** (1796 symbols, 3886 relationships, 137 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource                                        | Use for                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/clean-my-agent/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/clean-my-agent/clusters`       | All functional areas                     |
| `gitnexus://repo/clean-my-agent/processes`      | All execution flows                      |
| `gitnexus://repo/clean-my-agent/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
