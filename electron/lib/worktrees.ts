import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import type {
  AgentScanDiagnostic,
  CleanupCandidate,
  WorktreeOwner,
  WorktreeRecord,
} from '../../src/shared/types'
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
  roots?: string[]
  retentionDays: number
  excludedFolders: string[]
  /** When true (default), agent-default worktree roots (~/.<agent>/worktrees, superpowers) are scanned alongside `roots`. */
  includeDefaultRoots?: boolean
  now?: number
  fs?: WorktreeFs
  runner?: GitRunner
}

type DiscoveredWorktree = {
  path: string
  mtimeMs: number
  sizeBytes: number
}

type DiscoveredWorktreeFull = DiscoveredWorktree & {
  ownerAgent: WorktreeOwner
  defaultRoot: string
  parentRepo?: string
}

export type WorktreeSizeCacheEntry = {
  sizeBytes: number
  mtimeMs: number
}

export type WorktreeSizeCache = Map<string, WorktreeSizeCacheEntry>

export type ScanAllWorktreesResult = {
  records: WorktreeRecord[]
  diagnostics: AgentScanDiagnostic[]
  sizeCache: WorktreeSizeCache
}

export type ScanAllWorktreesOptions = {
  roots?: string[]
  retentionDays: number
  excludedFolders: string[]
  includeDefaultRoots?: boolean
  /** Persisted size cache (path → {sizeBytes, mtimeMs}); reused when mtime is unchanged. */
  sizeCache?: WorktreeSizeCache
  now?: number
  fs?: WorktreeFs
  runner?: GitRunner
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

export type WorktreeRootEntry = {
  path: string
  ownerAgent: WorktreeOwner
}

/**
 * Default locations where coding agents and skill systems keep their git
 * worktrees. Each agent typically parks worktrees under `~/.<agent>/worktrees/`;
 * the superpowers skill system uses `~/.config/superpowers/worktrees/`. Only
 * roots that actually exist on disk are scanned (missing ones are skipped).
 */
export function defaultWorktreeRoots(): WorktreeRootEntry[] {
  const home = expandHome('~')
  return [
    { path: path.join(home, '.codex', 'worktrees'), ownerAgent: 'codex' },
    { path: path.join(home, '.claude', 'worktrees'), ownerAgent: 'claude' },
    { path: path.join(home, '.cursor', 'worktrees'), ownerAgent: 'cursor' },
    { path: path.join(home, '.gemini', 'worktrees'), ownerAgent: 'gemini' },
    { path: path.join(home, '.opencode', 'worktrees'), ownerAgent: 'opencode' },
    { path: path.join(home, '.pi', 'worktrees'), ownerAgent: 'pi' },
    { path: path.join(home, '.config', 'superpowers', 'worktrees'), ownerAgent: 'other' },
  ]
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

/**
 * Scan all linked worktrees (not just stale) and return first-class WorktreeRecords,
 * with sizes cached by mtime (recomputed only when mtime changes or a worktree is new).
 * Clean/dirty is refreshed on every scan (git status --porcelain, concurrency limit).
 * ownerAgent is attributed by the default root the worktree lives under; user-configured
 * roots and non-agent defaults are "other".
 */
export async function scanAllWorktrees(
  options: ScanAllWorktreesOptions,
): Promise<ScanAllWorktreesResult> {
  const now = options.now ?? Date.now()
  const fs = options.fs ?? createRealFs()
  const runner = options.runner ?? createRealGitRunner()
  const diagnostics: AgentScanDiagnostic[] = []
  const sizeCache: WorktreeSizeCache = options.sizeCache ? new Map(options.sizeCache) : new Map()
  const records: WorktreeRecord[] = []

  const userRoots = (options.roots ?? []).map((root) => expandHome(root)).filter(Boolean)
  const defaultEntries = options.includeDefaultRoots === false ? [] : defaultWorktreeRoots()
  // Build root → ownerAgent map. User-configured roots are "other".
  const rootOwners = new Map<string, WorktreeOwner>()
  for (const entry of defaultEntries)
    rootOwners.set(normalizeForCompare(entry.path), entry.ownerAgent)
  for (const root of userRoots) rootOwners.set(normalizeForCompare(root), 'other')
  const roots = Array.from(new Set([...defaultEntries.map((e) => e.path), ...userRoots])).map(
    (root) => expandHome(root),
  )
  if (roots.length === 0) return { records, diagnostics, sizeCache }

  if (!(await runner.available())) {
    pushDiagnostic(diagnostics, {
      level: 'warning',
      code: 'worktree-git-unavailable',
      message: 'Git not found; worktree scan skipped.',
    })
    return { records, diagnostics, sizeCache }
  }

  const retentionMs = options.retentionDays * oneDayMs
  const excluded = options.excludedFolders
  const ownerForRoot = (root: string): WorktreeOwner =>
    rootOwners.get(normalizeForCompare(root)) ?? 'other'

  const discovered: DiscoveredWorktreeFull[] = []

  /** If `dir` is a linked worktree, record it (all worktrees, not just stale). */
  const tryRecordWorktree = async (dir: string, root: string): Promise<boolean> => {
    if (excluded.some((e) => isInsidePath(dir, e))) return false
    let gitEntry: GitEntryInfo
    try {
      gitEntry = await fs.statGitEntry(dir)
    } catch {
      return false
    }
    if (gitEntry.kind !== 'file' || !/^gitdir:/m.test(gitEntry.content)) return false
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
      return true
    }
    discovered.push({
      path: dir,
      mtimeMs: stats.mtimeMs,
      sizeBytes: stats.sizeBytes,
      ownerAgent: ownerForRoot(root),
      defaultRoot: root,
      parentRepo: parseParentRepoFromGitdir(gitEntry.content),
    })
    return true
  }

  for (const root of roots) {
    let entries: string[]
    try {
      entries = await fs.readDir(root)
    } catch {
      if (userRoots.some((r) => normalizeForCompare(r) === normalizeForCompare(root))) {
        pushDiagnostic(diagnostics, {
          level: 'warning',
          code: 'worktree-root-unreadable',
          message: 'Could not read worktree scan root.',
          path: root,
        })
      }
      continue
    }
    for (const entry of entries) {
      const dir = path.join(root, entry)
      if (await tryRecordWorktree(dir, root)) continue
      let subEntries: string[]
      try {
        subEntries = await fs.readDir(dir)
      } catch {
        continue
      }
      for (const sub of subEntries) {
        await tryRecordWorktree(path.join(dir, sub), root)
      }
    }
  }

  // Probe each worktree: clean/dirty via git status (refreshed every scan, never cached).
  const probed = await mapWithConcurrency(discovered, gitConcurrency, async (wt) => {
    let status: GitRunResult
    try {
      status = await runner.run(['status', '--porcelain'], wt.path)
    } catch {
      return { wt, clean: false, unverifiable: true }
    }
    if (status.code !== 0) return { wt, clean: false, unverifiable: true }
    return { wt, clean: status.stdout.trim().length === 0, unverifiable: false }
  })

  for (const { wt, clean, unverifiable } of probed) {
    if (unverifiable) {
      pushDiagnostic(diagnostics, {
        level: 'warning',
        code: 'worktree-status-failed',
        message: 'Could not verify worktree state; marked dirty to stay safe.',
        path: wt.path,
      })
    }

    // Size: reuse cache when mtime is unchanged; otherwise record the freshly
    // computed size into the cache.
    const cached = sizeCache.get(wt.path)
    let sizeBytes: number
    if (cached && cached.mtimeMs === wt.mtimeMs) {
      sizeBytes = cached.sizeBytes
    } else {
      sizeBytes = wt.sizeBytes
      sizeCache.set(wt.path, { sizeBytes, mtimeMs: wt.mtimeMs })
    }

    const branch = await safeBranchName(runner, wt.path)
    const repoName = path.basename(path.dirname(wt.path))
    records.push({
      id: hashId(['worktree', wt.path]),
      path: wt.path,
      ownerAgent: wt.ownerAgent,
      repoName,
      branch,
      sizeBytes,
      lastActivity: new Date(wt.mtimeMs).toISOString(),
      clean,
      stale: now - wt.mtimeMs > retentionMs,
      parentRepo: wt.parentRepo,
      defaultRoot: wt.defaultRoot,
    })
  }

  records.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { records, diagnostics, sizeCache }
}

export async function scanWorktrees(options: ScanWorktreesOptions): Promise<WorktreeScanResult> {
  const now = options.now ?? Date.now()
  const fs = options.fs ?? createRealFs()
  const runner = options.runner ?? createRealGitRunner()
  const diagnostics: AgentScanDiagnostic[] = []
  const candidates: CleanupCandidate[] = []

  // Combine the agent-default worktree roots with any the user configured.
  const userRoots = (options.roots ?? []).map((root) => expandHome(root)).filter(Boolean)
  const defaults =
    options.includeDefaultRoots === false ? [] : defaultWorktreeRoots().map((r) => r.path)
  const roots = Array.from(new Set([...defaults, ...userRoots])).map((root) => expandHome(root))
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
  const excluded = options.excludedFolders

  /** If `dir` is a linked worktree past retention, record it as discovered. */
  const tryRecordWorktree = async (dir: string): Promise<boolean> => {
    if (excluded.some((e) => isInsidePath(dir, e))) return false
    let gitEntry: GitEntryInfo
    try {
      gitEntry = await fs.statGitEntry(dir)
    } catch {
      return false
    }
    if (gitEntry.kind !== 'file' || !/^gitdir:/m.test(gitEntry.content)) {
      // Not a linked worktree (standalone repo `.git` dir, or no `.git`).
      return false
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
      return true
    }
    if (now - stats.mtimeMs <= retentionMs) return true // fresh, but it IS a worktree
    discovered.push({ path: dir, mtimeMs: stats.mtimeMs, sizeBytes: stats.sizeBytes })
    return true
  }

  // Discover candidate worktrees across all roots. Worktrees may sit either
  // directly under a root (`<root>/<name>`) or one level deeper
  // (`<root>/<group>/<name>`, e.g. codex's `~/.codex/worktrees/<hash>/<repo>`).
  const discovered: DiscoveredWorktree[] = []
  for (const root of roots) {
    let entries: string[]
    try {
      entries = await fs.readDir(root)
    } catch {
      // Missing default roots are expected (not every agent is installed);
      // only diagnose unreadable roots the user explicitly configured.
      if (userRoots.some((r) => normalizeForCompare(r) === normalizeForCompare(root))) {
        pushDiagnostic(diagnostics, {
          level: 'warning',
          code: 'worktree-root-unreadable',
          message: 'Could not read worktree scan root.',
          path: root,
        })
      }
      continue
    }

    for (const entry of entries) {
      const dir = path.join(root, entry)
      if (await tryRecordWorktree(dir)) continue
      // Not a worktree at level 1 — descend one level into group folders.
      let subEntries: string[]
      try {
        subEntries = await fs.readDir(dir)
      } catch {
        continue
      }
      for (const sub of subEntries) {
        await tryRecordWorktree(path.join(dir, sub))
      }
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
