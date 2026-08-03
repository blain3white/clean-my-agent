# Clean My Agent

A local-first app for scanning, backing up, exporting, and safely cleaning AI coding-agent session data and associated workspace artifacts.

## Language

**Worktree**:
A linked working tree created by `git worktree add` — a separate checkout of a repository that shares its object database. Lives under a user-designated folder, not the repository's main working copy.
_Avoid_: working repo, checkout, clone, working directory (when used to mean a standalone repository)

**Abandoned Worktree**:
A worktree eligible for cleanup: untouched longer than the cleanup retention window AND with a clean working tree (no uncommitted or untracked changes). A stale worktree that still holds uncommitted changes is not abandoned — it is flagged high-risk and never auto-suggested.
_Avoid_: stale worktree (when used loosely to mean any old worktree), dead worktree

**Model**:
The AI model identifier recorded on a session's `TokenUsage.model` (for example `gpt-5-codex`, `claude-sonnet-4-5`). It is the cluster key for usage-by-model analytics. A session carries a single model on its token usage; a session that used several models over its lifetime is attributed to the one model the adapter retained. Model strings are normalised (case, spacing, family prefixes) before clustering, reusing the pricing module's normaliser. A session with no recorded model clusters under "Unknown model".
_Avoid_: model name (when meaning the display string rather than the cluster key), model id

**Usage Breakdown**:
A usage-panel view that clusters token usage by a chosen dimension — by Agent or by Model — behind a single segmented toggle. Both dimensions show tokens, cost, and share.
_Avoid_: usage by agent / usage by model (when meaning the two faces of the same view rather than separate cards)
