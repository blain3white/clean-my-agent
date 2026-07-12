import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile, utimes } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import {
  scanWorktrees,
  resolveParentRepo,
  pruneWorktrees,
  resolveParentRepoFromWorktree,
  createRealGitRunner,
  defaultWorktreeRoots,
} from './worktrees'
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

  it('skips + diagnoses when statWorktree throws', async () => {
    const fs = {
      ...fakeFs([{ dir: '/wt/bad', mtimeMs: staleMs, sizeBytes: 100 }]),
      statWorktree: vi.fn(async () => {
        throw new Error('stat failed')
      }),
    }
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
    expect(result.diagnostics.some((d) => d.code === 'worktree-stat-failed')).toBe(true)
  })

  it('skips + diagnoses when git status throws (runner rejects)', async () => {
    const fs = fakeFs([{ dir: '/wt/throwy', mtimeMs: staleMs, sizeBytes: 100 }])
    const runner: GitRunner = {
      available: async () => true,
      run: vi.fn(async () => {
        throw new Error('spawn ENOENT')
      }),
    }
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

  it('skips when statGitEntry throws', async () => {
    const fs = {
      ...fakeFs([{ dir: '/wt/x', mtimeMs: staleMs, sizeBytes: 100 }]),
      statGitEntry: vi.fn(async () => {
        throw new Error('permission')
      }),
    }
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

  it('diagnoses an unreadable scan root and continues with others', async () => {
    const goodFs = fakeFs([{ dir: '/wt/good', mtimeMs: staleMs, sizeBytes: 100 }])
    const fs: typeof goodFs = {
      ...goodFs,
      readDir: vi.fn(async (root: string) => {
        if (root === '/wt/bad') throw new Error('EACCES')
        return goodFs.readDir(root)
      }),
    }
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt/bad', '/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.diagnostics.some((d) => d.code === 'worktree-root-unreadable')).toBe(true)
    expect(result.candidates.some((c) => c.kind === 'stale-worktree')).toBe(true)
  })

  it('falls back to directory basename when branch lookup throws', async () => {
    const fs = fakeFs([{ dir: '/wt/throwbranch', mtimeMs: staleMs, sizeBytes: 100 }])
    const runner: GitRunner = {
      available: async () => true,
      run: vi.fn(async (args: string[]) => {
        if (args[0] === 'status') return { command: 'status', stdout: '', stderr: '', code: 0 }
        if (args[0] === 'rev-parse') throw new Error('git blew up')
        return { command: args[0] ?? '', stdout: '', stderr: '', code: 0 }
      }),
    }
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates[0].title).toBe('throwbranch')
  })
})

describe('scanWorktrees default roots + two-level layout', () => {
  // A flexible fs that derives listings from a set of worktree paths, so it can
  // model both `<root>/<name>` and `<root>/<group>/<name>` layouts, including
  // agent-default roots.
  function layoutFs(
    worktrees: Array<{
      dir: string
      gitdir?: string
      mtimeMs: number
      sizeBytes: number
      noGit?: boolean
      isGitDir?: boolean
    }>,
  ): WorktreeFs {
    const byDir = new Map(worktrees.map((w) => [path.resolve(w.dir), w]))
    const allDirs = new Set(worktrees.map((w) => path.resolve(w.dir)))
    const childrenOf = (root: string) => {
      const resolved = path.resolve(root)
      const result = new Set<string>()
      for (const dir of allDirs) {
        if (path.dirname(dir) === resolved) result.add(path.basename(dir))
        else if (dir.startsWith(resolved + path.sep)) {
          // intermediate group directory: expose the next path segment
          const rel = path.relative(resolved, dir).split(path.sep)
          if (rel.length > 1) result.add(rel[0])
        }
      }
      return Array.from(result)
    }
    return {
      readDir: vi.fn(async (root: string) => childrenOf(root)),
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

  it('discovers worktrees nested two levels deep (<root>/<group>/<repo>)', async () => {
    const fs = layoutFs([{ dir: '/wt/0e92/clean-my-agent', mtimeMs: staleMs, sizeBytes: 100 }])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      includeDefaultRoots: false,
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].paths[0]).toBe(path.resolve('/wt/0e92/clean-my-agent'))
    expect(result.candidates[0].kind).toBe('stale-worktree')
  })

  it('discovers both single-level and two-level worktrees under the same root', async () => {
    const fs = layoutFs([
      { dir: '/wt/isea-release-main', mtimeMs: staleMs, sizeBytes: 50 },
      { dir: '/wt/0e92/clean-my-agent', mtimeMs: staleMs, sizeBytes: 100 },
    ])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: [],
      includeDefaultRoots: false,
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(2)
    const paths = result.candidates.map((c) => c.paths[0]).sort()
    expect(paths).toEqual([
      path.resolve('/wt/0e92/clean-my-agent'),
      path.resolve('/wt/isea-release-main'),
    ])
  })

  it('scans agent-default roots automatically when no roots are configured', async () => {
    // Model a worktree living under the codex default root.
    const codexRoot = path.join(os.homedir(), '.codex', 'worktrees')
    const fs = layoutFs([
      { dir: path.join(codexRoot, 'abc1', 'clean-my-agent'), mtimeMs: staleMs, sizeBytes: 100 },
    ])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: [],
      retentionDays: 7,
      excludedFolders: [],
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].paths[0]).toBe(path.join(codexRoot, 'abc1', 'clean-my-agent'))
  })

  it('includeDefaultRoots: false skips agent-default roots', async () => {
    const codexRoot = path.join(os.homedir(), '.codex', 'worktrees')
    const fs = layoutFs([
      { dir: path.join(codexRoot, 'abc1', 'clean-my-agent'), mtimeMs: staleMs, sizeBytes: 100 },
      { dir: '/custom/wt', mtimeMs: staleMs, sizeBytes: 100 },
    ])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/custom'],
      retentionDays: 7,
      excludedFolders: [],
      includeDefaultRoots: false,
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].paths[0]).toBe(path.resolve('/custom/wt'))
  })

  it('honours excludedFolders for two-level worktrees', async () => {
    const fs = layoutFs([
      { dir: '/wt/keep/clean-my-agent', mtimeMs: staleMs, sizeBytes: 100 },
      { dir: '/wt/scan/isea', mtimeMs: staleMs, sizeBytes: 100 },
    ])
    const runner = makeRunner({ status: async () => ({ stdout: '', stderr: '', code: 0 }) })
    const result = await scanWorktrees({
      roots: ['/wt'],
      retentionDays: 7,
      excludedFolders: ['/wt/keep'],
      includeDefaultRoots: false,
      now,
      fs,
      runner,
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].paths[0]).toBe(path.resolve('/wt/scan/isea'))
  })
})

describe('defaultWorktreeRoots', () => {
  it('returns the agent-default worktree locations', () => {
    const home = os.homedir()
    const roots = defaultWorktreeRoots()
    expect(roots).toContain(path.join(home, '.codex', 'worktrees'))
    expect(roots).toContain(path.join(home, '.claude', 'worktrees'))
    expect(roots).toContain(path.join(home, '.cursor', 'worktrees'))
    expect(roots).toContain(path.join(home, '.config', 'superpowers', 'worktrees'))
  })
})

describe('resolveParentRepo', () => {
  it('extracts the parent repo from a gitdir pointer', () => {
    const content = 'gitdir: /home/me/proj/.git/worktrees/feature-a'
    expect(resolveParentRepo(content)).toBe('/home/me/proj')
  })

  it('returns undefined for malformed content', () => {
    expect(resolveParentRepo('not a gitdir file')).toBeUndefined()
    expect(resolveParentRepo('')).toBeUndefined()
  })
})

describe('pruneWorktrees', () => {
  it('runs git worktree prune and returns true on success', async () => {
    const run = vi.fn(async () => ({ command: 'worktree', stdout: '', stderr: '', code: 0 }))
    const runner: GitRunner = { available: async () => true, run }
    const ok = await pruneWorktrees('/parent/repo', runner)
    expect(ok).toBe(true)
    expect(run).toHaveBeenCalledWith(['worktree', 'prune'], '/parent/repo')
  })

  it('returns false when prune fails but never throws', async () => {
    const run = vi.fn(async () => ({ command: 'worktree', stdout: '', stderr: 'err', code: 128 }))
    const runner: GitRunner = { available: async () => true, run }
    const ok = await pruneWorktrees('/parent/repo', runner)
    expect(ok).toBe(false)
  })

  it('returns false when the runner throws', async () => {
    const run = vi.fn(async () => {
      throw new Error('spawn failed')
    })
    const runner: GitRunner = { available: async () => true, run }
    const ok = await pruneWorktrees('/parent/repo', runner)
    expect(ok).toBe(false)
  })
})

const gitAvailable = (): boolean =>
  spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0

// These tests exercise the production fs + git adapters against a real temp git
// repo, covering createRealFs / createRealGitRunner / runGit / the default
// pruneWorktrees runner, and resolveParentRepoFromWorktree.
describe('scanWorktrees (real git + fs)', () => {
  it.skipIf(!gitAvailable())('detects a real stale+clean worktree end-to-end', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wt-real-root-'))
    const parent = await mkdtemp(path.join(os.tmpdir(), 'wt-real-parent-'))
    const runGit = (args: string[], cwd: string) =>
      spawnSync('git', args, { cwd, encoding: 'utf8' })
    expect(runGit(['init', '-q'], parent).status).toBe(0)
    await writeFile(path.join(parent, 'README.md'), 'hi\n')
    expect(runGit(['add', 'README.md'], parent).status).toBe(0)
    expect(
      runGit(['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'], parent)
        .status,
    ).toBe(0)
    const wtDir = path.join(root, 'feature')
    expect(runGit(['worktree', 'add', wtDir, '-b', 'feature'], parent).status).toBe(0)
    const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await utimes(wtDir, stale, stale)

    const result = await scanWorktrees({
      roots: [root],
      retentionDays: 7,
      excludedFolders: [],
      includeDefaultRoots: false,
      now: Date.now(),
    })
    const candidate = result.candidates.find((c) => c.paths[0] === wtDir)
    expect(candidate).toBeDefined()
    expect(candidate?.kind).toBe('stale-worktree')
    expect(candidate?.risk).toBe('low')
    expect(candidate?.title).toBe('feature')
  })

  it.skipIf(!gitAvailable())('detects a real stale+dirty worktree', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wt-real-root-'))
    const parent = await mkdtemp(path.join(os.tmpdir(), 'wt-real-parent-'))
    const runGit = (args: string[], cwd: string) =>
      spawnSync('git', args, { cwd, encoding: 'utf8' })
    expect(runGit(['init', '-q'], parent).status).toBe(0)
    await writeFile(path.join(parent, 'README.md'), 'hi\n')
    expect(runGit(['add', 'README.md'], parent).status).toBe(0)
    expect(
      runGit(['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'], parent)
        .status,
    ).toBe(0)
    const wtDir = path.join(root, 'dirty')
    expect(runGit(['worktree', 'add', wtDir, '-b', 'dirty'], parent).status).toBe(0)
    await writeFile(path.join(wtDir, 'uncommitted.txt'), 'changes\n')
    const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    await utimes(wtDir, stale, stale)

    const result = await scanWorktrees({
      roots: [root],
      retentionDays: 7,
      excludedFolders: [],
      includeDefaultRoots: false,
      now: Date.now(),
    })
    const candidate = result.candidates.find((c) => c.paths[0] === wtDir)
    expect(candidate?.kind).toBe('dirty-worktree')
    expect(candidate?.risk).toBe('high')
  })

  it.skipIf(!gitAvailable())(
    'skips a standalone repo (.git directory) under the root',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'wt-real-root-'))
      const clone = path.join(root, 'full-clone')
      const runGit = (args: string[], cwd: string) =>
        spawnSync('git', args, { cwd, encoding: 'utf8' })
      expect(runGit(['init', '-q', clone]).status).toBe(0)
      const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
      await utimes(clone, stale, stale)

      const result = await scanWorktrees({
        roots: [root],
        retentionDays: 7,
        excludedFolders: [],
        includeDefaultRoots: false,
        now: Date.now(),
      })
      expect(result.candidates).toEqual([])
    },
  )
})

describe('resolveParentRepoFromWorktree (real fs)', () => {
  it.skipIf(!gitAvailable())('reads the .git pointer and resolves the parent repo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wt-real-root-'))
    const parent = await mkdtemp(path.join(os.tmpdir(), 'wt-real-parent-'))
    const runGit = (args: string[], cwd: string) =>
      spawnSync('git', args, { cwd, encoding: 'utf8' })
    expect(runGit(['init', '-q'], parent).status).toBe(0)
    await writeFile(path.join(parent, 'README.md'), 'hi\n')
    expect(runGit(['add', 'README.md'], parent).status).toBe(0)
    expect(
      runGit(['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'], parent)
        .status,
    ).toBe(0)
    const wtDir = path.join(root, 'feature')
    expect(runGit(['worktree', 'add', wtDir, '-b', 'feature'], parent).status).toBe(0)

    const resolved = await resolveParentRepoFromWorktree(wtDir)
    // git may resolve the tmpdir through symlinks (e.g. /var -> /private/var on macOS).
    const { realpath } = await import('node:fs/promises')
    expect(resolved?.parentRepo).toBe(await realpath(parent))
  })

  it('returns null when the path has no .git pointer', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wt-nogit-'))
    await expect(resolveParentRepoFromWorktree(dir)).resolves.toBeNull()
  })
})

describe('createRealGitRunner', () => {
  it.skipIf(!gitAvailable())('detects git availability and runs commands', async () => {
    const runner = createRealGitRunner()
    expect(await runner.available()).toBe(true)
    const result = await runner.run(['--version'], os.tmpdir())
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/git version/)
  })
})

describe('pruneWorktrees (real runner)', () => {
  it.skipIf(!gitAvailable())('prunes a real stale worktree registration', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wt-real-root-'))
    const parent = await mkdtemp(path.join(os.tmpdir(), 'wt-real-parent-'))
    const runGit = (args: string[], cwd: string) =>
      spawnSync('git', args, { cwd, encoding: 'utf8' })
    expect(runGit(['init', '-q'], parent).status).toBe(0)
    await writeFile(path.join(parent, 'README.md'), 'hi\n')
    expect(runGit(['add', 'README.md'], parent).status).toBe(0)
    expect(
      runGit(['-c', 'user.email=t@t', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'], parent)
        .status,
    ).toBe(0)
    const wtDir = path.join(root, 'feature')
    expect(runGit(['worktree', 'add', wtDir, '-b', 'feature'], parent).status).toBe(0)
    // Remove the directory directly so the registration becomes prunable.
    const { rm } = await import('node:fs/promises')
    await rm(wtDir, { recursive: true, force: true })

    const ok = await pruneWorktrees(parent)
    expect(ok).toBe(true)
    const list = runGit(['worktree', 'list'], parent).stdout
    expect(list).not.toContain('feature')
  })

  it.skipIf(!gitAvailable())('returns false for a non-repo path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wt-notrepo-'))
    const ok = await pruneWorktrees(dir)
    expect(ok).toBe(false)
  })
})
