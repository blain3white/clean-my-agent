# Worktree cleanup removes via app Trash + prune, not native `git worktree remove`

Worktrees are git-registered entities, so removing one is not just deleting a directory. We decided to move the worktree directory into the app Trash (recoverable, matching the existing safety model) and then run `git worktree prune` to clear the now-stale registration in the parent repo's `.git/worktrees/`.

We rejected native `git worktree remove` (Option A) even though it correctly unregisters, because it bypasses the app's non-negotiable safety contract: nothing is permanently deleted — everything goes through the app Trash and is restorable. The trade-off is that restoring a worktree from Trash does not re-link its git registration; the directory is recovered but the worktree must be re-added with `git worktree add`. That is an acceptable cost given the safety guarantee, and in practice abandoned worktrees are clean and fully regenerable from git anyway.
