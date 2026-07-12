# Clean My Agent

A local-first app for scanning, backing up, exporting, and safely cleaning AI coding-agent session data and associated workspace artifacts.

## Language

**Worktree**:
A linked working tree created by `git worktree add` — a separate checkout of a repository that shares its object database. Lives under a user-designated folder, not the repository's main working copy.
_Avoid_: working repo, checkout, clone, working directory (when used to mean a standalone repository)

**Abandoned Worktree**:
A worktree eligible for cleanup: untouched longer than the cleanup retention window AND with a clean working tree (no uncommitted or untracked changes). A stale worktree that still holds uncommitted changes is not abandoned — it is flagged high-risk and never auto-suggested.
_Avoid_: stale worktree (when used loosely to mean any old worktree), dead worktree
