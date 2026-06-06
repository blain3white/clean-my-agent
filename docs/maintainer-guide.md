# Maintainer Guide

This guide describes the repository defaults maintainers should configure on GitHub after the open-source infrastructure lands.

## Branch Protection

Create a `develop` branch from `main`, then protect both branches.

Recommended `main` rules:

- Require a pull request before merging.
- Require at least one approval.
- Require review from Code Owners.
- Dismiss stale approvals when new commits are pushed.
- Require the `Verify` CI check.
- Require the `GitNexus Report` CI check.
- Require branches to be up to date before merging.
- Block force pushes.
- Block branch deletion.
- Require linear history if the project uses squash merges.

`main` runs the normal `Verify` gate for PRs and direct protected-branch pushes.
Release readiness should already be proven before code reaches `main`; the
`main` CI run is a final confirmation, not the first release quality gate.

Recommended `develop` rules:

- Require a pull request before merging.
- Require at least one approval.
- Require the `Verify` CI check.
- Require the `GitNexus Report` CI check.
- Require branches to be up to date before merging.
- Block force pushes.
- Block branch deletion.

Configure `Verify` and `GitNexus Report` as required status checks on `develop`;
this is what blocks feature PRs until tests, coverage, and impact reporting pass.

## Development Flow

Normal changes:

1. Branch from `develop`.
2. Open a PR back to `develop`.
3. Let CI run the `Verify` check and write the GitNexus report into the PR body.
4. Squash-merge after review.

Release flow:

1. Update `package.json` to the release version on `develop` before integration.
2. Verify changelog or release notes.
3. Confirm the latest `develop` `Verify` run is green.
4. Open a release PR from `develop` into `main`, or perform a direct maintainer
   merge only for a release operation.
5. Tag the release from `main` with the matching semantic version, such as
   `v0.1.0`.
6. The release workflow builds the macOS DMG and publishes the GitHub Release.

Direct release merges should record the source branch SHA, target branch SHA,
merge SHA, tag, and release workflow URL in the maintainer handoff. Do not force
push or bypass a failed release check.

Urgent fixes:

1. Branch from `main`.
2. Open a PR into `main`.
3. Back-merge or cherry-pick the fix into `develop`.

## Required Checks

The `CI` workflow runs on pull requests into `develop` and `main`, and on pushes
to `develop` and `main`.

Pull requests also run a required `GitNexus Report` job. It builds a GitNexus
index, compares the PR against its base branch, and writes the GitNexus summary
into the PR body between the `gitnexus-report` markers. If GitNexus cannot
analyze the PR or the summary is missing, CI must fail.

`Verify` runs from the `pull_request` event. `GitNexus Report` runs from the
`pull_request_target` event so it can update the PR body. Each workflow run will
show the other job as skipped; the PR is healthy only when both required status
checks have separate successful results.

The full local gate is:

```bash
pnpm format:check
pnpm lint
pnpm test
pnpm verify:functions
pnpm build
```

Pull requests into `develop` also run:

```bash
pnpm verify:pr-tests
pnpm test:coverage
```

`pnpm verify:pr-tests` fails when core production files in `electron/lib/`,
`src/lib/`, or `src/shared/` change without a matching unit test or functional
smoke test change. `pnpm test:coverage` enforces at least 90% statements,
branches, functions, and lines coverage for core logic.

Keep `pnpm verify:functions` required for cleanup, backup, export, scan, adapter, database, and Trash changes because those paths carry the highest user-data risk.

## CodeRabbit

CodeRabbit is configured by `.coderabbit.yaml` to auto-review PRs targeting
`develop`.

Use it as a semantic reviewer for test quality:

- Request changes when feature work lacks meaningful tests.
- Request changes when tests only mirror implementation details or contain no assertions.
- Request changes when CI or Vitest coverage thresholds are weakened.

Do not treat CodeRabbit as the source of truth for numeric coverage. The required
`Verify` CI check remains the blocking gate.
