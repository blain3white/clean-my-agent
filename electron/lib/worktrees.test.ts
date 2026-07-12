import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { scanWorktrees } from './worktrees'
import type { GitRunner } from './worktrees'

type Stub = {
  status: (cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>
  branch: (cwd: string) => Promise<{ stdout: string; stderr: string; code: number }>
  available: () => Promise<boolean>
}

function makeRunner(stub: Partial<Stub>): GitRunner {
  return {
    available: stub.available ?? (async () => true),
    run: vi.fn(async (args: string[], cwd: string) => {
      if (args[0] === 'status' && args[1] === '--porcelain') {
        const result = await (stub.status ?? (async () => ({ stdout: '', stderr: '', code: 0 })))(
          cwd,
        )
        return { command: 'status', ...result }
      }
      if (args[0] === 'rev-parse' && args.includes('--abbrev-ref')) {
        const result = await (
          stub.branch ?? (async () => ({ stdout: 'main', stderr: '', code: 0 }))
        )(cwd)
        return { command: 'rev-parse', ...result }
      }
      return { command: args[0], stdout: '', stderr: '', code: 0 }
    }),
  }
}

// Helper to build a fake worktree directory with a `.git` gitdir pointer file.
// We avoid touching the real filesystem by stubbing the filesystem adapter too;
// see scanWorktrees signature — it accepts an fs adapter for testability.
import type { WorktreeFs } from './worktrees'

function fakeFs(
  worktrees: Array<{
    dir: string
    gitdir?: string
    mtimeMs: number
    sizeBytes: number
    isGitDir?: boolean
    noGit?: boolean
  }>,
): WorktreeFs {
  const byDir = new Map(worktrees.map((w) => [path.resolve(w.dir), w]))
  return {
    readDir: vi.fn(async (root: string) => {
      const resolved = path.resolve(root)
      return worktrees
        .filter((w) => path.dirname(path.resolve(w.dir)) === resolved)
        .map((w) => path.basename(w.dir))
    }),
    statGitEntry: vi.fn(async (dir: string) => {
      const w = byDir.get(path.resolve(dir))
      if (!w) return { kind: 'none' as const }
      if (w.noGit) return { kind: 'none' as const }
      if (w.isGitDir) return { kind: 'directory' as const }
      return {
        kind: 'file' as const,
        content: w.gitdir ?? `gitdir: /fake/.git/worktrees/${path.basename(dir)}`,
      }
    }),
    statWorktree: vi.fn(async (dir: string) => {
      const w = byDir.get(path.resolve(dir))
      if (!w) throw new Error(`no fixture for ${dir}`)
      return { mtimeMs: w.mtimeMs, sizeBytes: w.sizeBytes }
    }),
  }
}

const now = Date.parse('2026-07-12T00:00:00Z')
const staleMs = now - 30 * 24 * 60 * 60 * 1000 // 30 days ago
const freshMs = now - 1 * 24 * 60 * 60 * 1000 // 1 day ago

describe('scanWorktrees', () => {
  it('returns no candidates and a diagnostic when git is unavailable', async () => {
    const fs = fakeFs([])
    const runner = makeRunner({ available: async () => false })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toEqual([])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0].code).toBe('worktree-git-unavailable')
  })

  it('detects a stale + clean worktree as low-risk stale-worktree', async () => {
    const fs = fakeFs([{ dir: '/wt/feature-a', mtimeMs: staleMs, sizeBytes: 1024 }])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(1)
    const candidate = result.candidates[0]
    expect(candidate.kind).toBe('stale-worktree')
    expect(candidate.risk).toBe('low')
    expect(candidate.backedUp).toBe(true)
    expect(candidate.sessionIds).toEqual([])
    expect(candidate.paths).toEqual([path.resolve('/wt/feature-a')])
    expect(candidate.sizeBytes).toBe(1024)
  })

  it('detects a stale + dirty worktree as high-risk dirty-worktree', async () => {
    const fs = fakeFs([{ dir: '/wt/feature-b', mtimeMs: staleMs, sizeBytes: 512 }])
    const runner = makeRunner({
      status: async () => ({ stdout: ' M file.ts\n', stderr: '', code: 0 }),
    })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe('dirty-worktree')
    expect(result.candidates[0].risk).toBe('high')
    expect(result.candidates[0].backedUp).toBe(false)
  })

  it('skips fresh worktrees (within retention)', async () => {
    const fs = fakeFs([{ dir: '/wt/feature-c', mtimeMs: freshMs, sizeBytes: 100 }])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toEqual([])
  })

  it('skips subdirectories that are not worktrees (.git is a directory = standalone repo)', async () => {
    const fs = fakeFs([{ dir: '/wt/full-clone', mtimeMs: staleMs, sizeBytes: 100, isGitDir: true }])
    const runner = makeRunner({})
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toEqual([])
  })

  it('skips subdirectories with no .git at all (plain folders)', async () => {
    const fs = fakeFs([{ dir: '/wt/notes', mtimeMs: staleMs, sizeBytes: 100, noGit: true }])
    const runner = makeRunner({})
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toEqual([])
  })

  it('skips + diagnoses when git status fails (never guesses low-risk)', async () => {
    const fs = fakeFs([{ dir: '/wt/broken', mtimeMs: staleMs, sizeBytes: 100 }])
    const runner = makeRunner({
      status: async () => ({ stdout: '', stderr: 'fatal: not a git repo', code: 128 }),
    })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toEqual([])
    expect(result.diagnostics.some((d) => d.code === 'worktree-status-failed')).toBe(true)
  })

  it('skips worktrees inside excluded folders', async () => {
    const fs = fakeFs([{ dir: '/wt/keep/me', mtimeMs: staleMs, sizeBytes: 100 }])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: ['/wt/keep'],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toEqual([])
  })

  it('sorts candidates by sizeBytes descending', async () => {
    const fs = fakeFs([
      { dir: '/wt/small', mtimeMs: staleMs, sizeBytes: 100 },
      { dir: '/wt/big', mtimeMs: staleMs, sizeBytes: 900 },
      { dir: '/wt/med', mtimeMs: staleMs, sizeBytes: 500 },
    ])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates.map((c) => c.sizeBytes)).toEqual([900, 500, 100])
  })

  it('falls back to directory basename as title when branch lookup fails', async () => {
    const fs = fakeFs([{ dir: '/wt/feature-x', mtimeMs: staleMs, sizeBytes: 100 }])
    const runner = makeRunner({
      status: async () => ({ stdout: '', stderr: '', code: 0 }),
      branch: async () => ({ stdout: '', stderr: 'fatal: detached', code: 128 }),
    })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates[0].title).toBe('feature-x')
  })
})
