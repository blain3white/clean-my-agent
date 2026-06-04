# Maintainer Guide

This guide describes the repository defaults maintainers should configure on GitHub after the open-source infrastructure lands.

## Branch Protection

Create a `develop` branch from `main`, then protect both branches.

Recommended `main` rules:

- Require a pull request before merging.
- Require at least one approval.
- Require review from Code Owners.
- Dismiss stale approvals when new commits are pushed.
- Require status checks to pass before merging.
- Require the `Verify` CI check.
- Require branches to be up to date before merging.
- Block force pushes.
- Block branch deletion.
- Require linear history if the project uses squash merges.

Recommended `develop` rules:

- Require a pull request before merging.
- Require at least one approval.
- Require the `Verify` CI check.
- Block force pushes.
- Block branch deletion.

## Development Flow

Normal changes:

1. Branch from `develop`.
2. Open a PR back to `develop`.
3. Let CI run `pnpm check`.
4. Squash-merge after review.

Release flow:

1. Open a release PR from `develop` into `main`.
2. Verify changelog or release notes.
3. Merge after CI and review pass.
4. Tag the release from `main`.

Urgent fixes:

1. Branch from `main`.
2. Open a PR into `main`.
3. Back-merge or cherry-pick the fix into `develop`.

## Required Checks

The `CI` workflow runs on pull requests and pushes to `main` and `develop`.

The full gate is:

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm verify:functions
pnpm build
```

Keep `pnpm verify:functions` required for cleanup, backup, export, scan, adapter, database, and Trash changes because those paths carry the highest user-data risk.
