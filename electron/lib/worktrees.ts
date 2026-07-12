import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import type { AgentScanDiagnostic, CleanupCandidate } from '../../src/shared/types'
import { expandHome, hashId } from './files'

const oneDayMs = 24 * 60 * 60 * 1000
const maxDiagnostics = 50
const gitConcurrency = 4

export type WorktreeScanResult = {
  candidates: CleanupCandidate[]
  diagnostics: AgentScanDiagnostic[]
}

export type GitRunResult = {
  command: string
  stdout: string
  stderr: string
  code: number
}

export type GitRunner = {
  available: () => Promise<boolean>
  run: (args: string[], cwd: string) => Promise<GitRunResult>
}

export type GitEntryInfo =
  | { kind: 'none' }
  | { kind: 'directory' }
  | { kind: 'file'; content: string }

export type WorktreeFs = {
  readDir: (root: string) => Promise<string[]>
  statGitEntry: (dir: string) => Promise<GitEntryInfo>
  statWorktree: (dir: string) => Promise<{ mtimeMs: number; sizeBytes: number }>
}

export type ScanWorktreesOptions = {
  roots: string[]
  retentionDays: number
  excludedFolders: string[]
  now?: number
  fs?: WorktreeFs
  runner?: GitRunner
}

type DiscoveredWorktree = {
  path: string
  mtimeMs: number
  sizeBytes: number
}

function pushDiagnostic(diagnostics: AgentScanDiagnostic[], diagnostic: AgentScanDiagnostic): void {
  if (diagnostics.length < maxDiagnostics) diagnostics.push(diagnostic)
}

function normalizeForCompare(value: string): string {
  return path.resolve(expandHome(value)).replace(/[\\/]+$/, '')
}

function isInsidePath(filePath: string, parentPath: string): boolean {
  const file = normalizeForCompare(filePath)
  const parent = normalizeForCompare(parentPath)
  return file === parent || file.startsWith(`${parent}${path.sep}`)
}

/** Production filesystem adapter backed by node:fs. */
function createRealFs(): WorktreeFs {
  return {
    readDir: async (root) => {
      const { readdir } = await import('node:fs/promises')
      try {
        const entries = await readdir(root, { withFileTypes: true })
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      } catch {
        return []
      }
    },
    statGitEntry: async (dir) => {
      const { stat, readFile } = await import('node:fs/promises')
      const gitPath = path.join(dir, '.git')
      try {
        const info = await stat(gitPath)
        if (info.isDirectory()) return { kind: 'directory' }
        const content = await readFile(gitPath, 'utf8')
        return { kind: 'file', content }
      } catch {
        return { kind: 'none' }
      }
    },
    statWorktree: async (dir) => {
      const { stat } = await import('node:fs/promises')
      const { pathSize } = await import('./files')
      const info = await stat(dir)
      return { mtimeMs: info.mtimeMs, sizeBytes: await pathSize(dir) }
    },
  }
}

/** Production git runner backed by child_process.spawn. */
export function createRealGitRunner(): GitRunner {
  return {
    available: async () => {
      try {
        const result = await runGit(['--version'], os.tmpdir())
        return result.code === 0
      } catch {
        return false
      }
    },
    run: runGit,
  }
}

function runGit(args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', () => resolve({ command: args[0] ?? '', stdout, stderr, code: 1 }))
    child.on('close', (code) => {
      resolve({ command: args[0] ?? '', stdout, stderr, code: code ?? 0 })
    })
  })
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await fn(items[current])
    }
  })
  await Promise.all(workers)
  return results
}

function parseParentRepoFromGitdir(content: string): string | undefined {
  // A worktree's `.git` file contains: `gitdir: /path/to/parent/.git/worktrees/<name>`
  const match = /^gitdir:\s*(.+)$/m.exec(content.trim())
  if (!match) return undefined
  const gitdir = match[1].trim()
  // Walk up from .../.git/worktrees/<name> to the parent repo root.
  const worktreesSegment = `${path.sep}.git${path.sep}worktrees${path.sep}`
  const idx = gitdir.indexOf(worktreesSegment)
  if (idx === -1) return undefined
  return gitdir.slice(0, idx)
}

/**
 * Resolve the parent repository path for a worktree by reading its `.git` gitdir pointer.
 * Used to run `git worktree prune` after a worktree is moved to Trash.
 */
export function resolveParentRepo(gitFileContent: string): string | undefined {
  return parseParentRepoFromGitdir(gitFileContent)
}

/**
 * Read a worktree's `.git` gitdir pointer and resolve the parent repository path.
 * Returns undefined if the worktree is not a linked worktree or the pointer is malformed.
 */
export async function resolveParentRepoFromWorktree(worktreePath: string): Promise<{
  parentRepo: string
  gitFileContent: string
} | null> {
  const { readFile } = await import('node:fs/promises')
  try {
    const content = await readFile(path.join(worktreePath, '.git'), 'utf8')
    const parentRepo = parseParentRepoFromGitdir(content)
    if (!parentRepo) return null
    return { parentRepo, gitFileContent: content }
  } catch {
    return null
  }
}

export async function scanWorktrees(options: ScanWorktreesOptions): Promise<WorktreeScanResult> {
  const now = options.now ?? Date.now()
  const fs = options.fs ?? createRealFs()
  const runner = options.runner ?? createRealGitRunner()
  const diagnostics: AgentScanDiagnostic[] = []
  const candidates: CleanupCandidate[] = []

  const roots = options.roots.map((root) => expandHome(root)).filter(Boolean)
  if (roots.length === 0) return { candidates, diagnostics }

  if (!(await runner.available())) {
    pushDiagnostic(diagnostics, {
      level: 'warning',
      code: 'worktree-git-unavailable',
      message: 'Git not found; worktree cleanup skipped.',
    })
    return { candidates, diagnostics }
  }

  const retentionMs = options.retentionDays * oneDayMs

  // Discover candidate worktrees across all roots.
  const discovered: DiscoveredWorktree[] = []
  for (const root of roots) {
    let entries: string[]
    try {
      entries = await fs.readDir(root)
    } catch {
      pushDiagnostic(diagnostics, {
        level: 'warning',
        code: 'worktree-root-unreadable',
        message: 'Could not read worktree scan root.',
        path: root,
      })
      continue
    }

    for (const entry of entries) {
      const dir = path.join(root, entry)
      if (options.excludedFolders.some((excluded) => isInsidePath(dir, excluded))) continue

      let gitEntry: GitEntryInfo
      try {
        gitEntry = await fs.statGitEntry(dir)
      } catch {
        continue
      }
      if (gitEntry.kind !== 'file' || !/^gitdir:/m.test(gitEntry.content)) {
        // Not a linked worktree (standalone repo `.git` dir, or no `.git`).
        continue
      }

      let stats: { mtimeMs: number; sizeBytes: number }
      try {
        stats = await fs.statWorktree(dir)
      } catch {
        pushDiagnostic(diagnostics, {
          level: 'warning',
          code: 'worktree-stat-failed',
          message: 'Could not inspect worktree directory.',
          path: dir,
        })
        continue
      }

      if (now - stats.mtimeMs <= retentionMs) continue // fresh
      discovered.push({ path: dir, mtimeMs: stats.mtimeMs, sizeBytes: stats.sizeBytes })
    }
  }

  // Probe each stale worktree: clean (low risk) vs dirty (high risk) vs failed (skip).
  const probed = await mapWithConcurrency(discovered, gitConcurrency, async (wt) => {
    let status: GitRunResult
    try {
      status = await runner.run(['status', '--porcelain'], wt.path)
    } catch {
      return { wt, outcome: 'failed' as const }
    }
    if (status.code !== 0) return { wt, outcome: 'failed' as const }
    const clean = status.stdout.trim().length === 0
    return { wt, outcome: clean ? ('clean' as const) : ('dirty' as const) }
  })

  for (const { wt, outcome } of probed) {
    if (outcome === 'failed') {
      pushDiagnostic(diagnostics, {
        level: 'warning',
        code: 'worktree-status-failed',
        message: 'Could not verify worktree state; skipped to avoid unsafe cleanup.',
        path: wt.path,
      })
      continue
    }

    const dirty = outcome === 'dirty'
    const kind = dirty ? 'dirty-worktree' : 'stale-worktree'
    const branch = await safeBranchName(runner, wt.path)
    const title = branch || path.basename(wt.path)
    const lastUpdated = new Date(wt.mtimeMs).toISOString()

    candidates.push({
      id: hashId([kind, wt.path]),
      kind,
      title,
      source: undefined,
      sessionIds: [],
      paths: [wt.path],
      sizeBytes: wt.sizeBytes,
      lastUpdated,
      reason: dirty
        ? `Untouched for more than ${options.retentionDays} days but has uncommitted/untracked changes. Review before removing.`
        : `Untouched for more than ${options.retentionDays} days; working tree is clean. Regenerable from git.`,
      risk: dirty ? 'high' : 'low',
      recoverable: true,
      backedUp: !dirty,
    })
  }

  candidates.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { candidates, diagnostics }
}

async function safeBranchName(runner: GitRunner, cwd: string): Promise<string | undefined> {
  try {
    const result = await runner.run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    if (result.code !== 0) return undefined
    const name = result.stdout.trim()
    if (!name || name === 'HEAD') return undefined
    return name
  } catch {
    return undefined
  }
}

/**
 * Run `git worktree prune` on the parent repo after a worktree directory has been
 * moved to Trash. Best-effort: never throws. Returns true if it ran successfully.
 */
export async function pruneWorktrees(
  parentRepoPath: string,
  runner: GitRunner = createRealGitRunner(),
): Promise<boolean> {
  try {
    const result = await runner.run(['worktree', 'prune'], parentRepoPath)
    return result.code === 0
  } catch {
    return false
  }
}
