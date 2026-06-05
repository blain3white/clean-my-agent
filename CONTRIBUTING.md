# Contributing

Thanks for helping make Clean My Agent safer and more useful. This project handles local AI-agent session data, so the core rule is simple: preserve user trust before adding convenience.

## Branches

- `main` is the stable branch. It should always build and pass CI.
- `develop` is the integration branch for normal feature work.
- Use short topic branches from `develop`, such as `feature/codex-export-filter` or `fix/trash-restore-path`.
- Open pull requests into `develop` by default. Open release or urgent fix PRs into `main` only when maintainers agree.

## Setup

Requirements:

- Node.js 22.13.0 or newer
- pnpm 10 or newer

```bash
pnpm install
pnpm dev
```

For renderer-only UI work:

```bash
pnpm dev:renderer
```

## Quality Checks

Run the checks that match your change:

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm verify:functions
pnpm build
```

`pnpm check` runs the full local gate used by GitHub Actions.

Use `pnpm verify:functions` after touching cleanup, backup, export, scan, adapter, database, or Trash behavior. Use `pnpm build` when TypeScript contracts, Electron IPC, or bundled assets changed.

Pull requests must also pass the `GitNexus Report` CI job. The job compares the PR against its base branch and writes the GitNexus summary into the PR body for review.

## Code Style

- TypeScript, React, and Electron code are formatted with Prettier.
- ESLint is the source of truth for lint rules.
- Keep IPC payloads typed through `src/shared/types.ts`.
- Prefer app service and adapter changes in `electron/lib/` over coupling agent-specific behavior into UI components.
- Use existing UI primitives in `src/components/ui/` and lucide icons before adding new component patterns.

## Safety Model

Clean My Agent must remain safe by default:

- Read before writing.
- Suggest cleanup before performing cleanup.
- Back up before risky moves.
- Move cleanup targets to app-managed Trash instead of permanently deleting them.
- Do not scan, copy, export, or log credential-like files such as `.env`, tokens, OAuth data, API keys, or secrets.
- Treat local paths and session content as private user data.

## Tests

- Unit tests live next to the code as `*.test.ts`.
- Functional smoke coverage lives in `scripts/verify-functions.ts`.
- Add focused unit tests for pure parsing, formatting, policy, and adapter logic.
- Add or update the functional smoke test when a user-facing workflow changes.

## Pull Requests

Before opening a PR:

- Rebase or merge from `develop`.
- Run the relevant checks.
- Confirm the `GitNexus Report` CI job passed and review the GitNexus section in the PR body.
- Keep the PR focused on one behavior or infrastructure change.
- Include screenshots for visible UI changes.
- Explain safety and privacy impact for scanning, backup, export, cleanup, or Trash changes.

Maintainers should squash-merge normal PRs unless the commit history carries useful context.

## Releases

Release candidates should merge from `develop` into `main` after CI passes. Tag releases from `main` with semantic version tags such as `v0.1.0`.
