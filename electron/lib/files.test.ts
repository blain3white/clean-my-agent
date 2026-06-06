import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compressFileBrotli,
  decompressFileBrotli,
  copyPath,
  ensureDir,
  exists,
  expandHome,
  hashFile,
  hashId,
  homeDir,
  listFiles,
  movePath,
  pathSize,
  readable,
  removePath,
  safeReadText,
  sanitizeName,
  writeJson,
} from './files'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cma-files-test-'))
})

afterEach(async () => {
  await removePath(tmpDir)
})

// ---------------------------------------------------------------------------
// expandHome
// ---------------------------------------------------------------------------

describe('expandHome', () => {
  it('returns homeDir for bare tilde', () => {
    expect(expandHome('~')).toBe(homeDir)
  })

  it('expands tilde-slash prefix', () => {
    expect(expandHome('~/foo/bar')).toBe(path.join(homeDir, 'foo/bar'))
  })

  it('leaves absolute paths unchanged', () => {
    expect(expandHome('/tmp/foo')).toBe('/tmp/foo')
  })

  it('leaves relative paths unchanged', () => {
    expect(expandHome('relative/path')).toBe('relative/path')
  })
})

// ---------------------------------------------------------------------------
// hashId
// ---------------------------------------------------------------------------

describe('hashId', () => {
  it('returns a 24-character hex string', () => {
    const id = hashId(['a', 'b', 'c'])
    expect(id).toMatch(/^[0-9a-f]{24}$/)
  })

  it('is deterministic', () => {
    expect(hashId(['x', 1, 'y'])).toBe(hashId(['x', 1, 'y']))
  })

  it('differs for different inputs', () => {
    expect(hashId(['a'])).not.toBe(hashId(['b']))
  })

  it('filters out undefined parts', () => {
    expect(hashId(['a', undefined, 'b'])).toBe(hashId(['a', 'b']))
  })

  it('handles all-undefined array', () => {
    const id = hashId([undefined, undefined])
    expect(id).toMatch(/^[0-9a-f]{24}$/)
  })
})

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------

describe('sanitizeName', () => {
  it('replaces disallowed characters with hyphens', () => {
    expect(sanitizeName('hello world!')).toBe('hello-world')
  })

  it('strips leading and trailing hyphens', () => {
    expect(sanitizeName('  foo  ')).toBe('foo')
  })

  it('allows word chars, dots and hyphens through unchanged', () => {
    expect(sanitizeName('my-file.ts')).toBe('my-file.ts')
  })

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100)
    expect(sanitizeName(long)).toHaveLength(80)
  })

  it('falls back to "item" for empty/all-special input', () => {
    expect(sanitizeName('!!!')).toBe('item')
    expect(sanitizeName('')).toBe('item')
  })
})

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('exists', () => {
  it('returns true for an existing file', async () => {
    const p = path.join(tmpDir, 'test.txt')
    await writeFile(p, 'hi')
    expect(await exists(p)).toBe(true)
  })

  it('returns true for an existing directory', async () => {
    expect(await exists(tmpDir)).toBe(true)
  })

  it('returns false for a non-existent path', async () => {
    expect(await exists(path.join(tmpDir, 'no-such-file'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// readable
// ---------------------------------------------------------------------------

describe('readable', () => {
  it('returns true for a readable file', async () => {
    const p = path.join(tmpDir, 'r.txt')
    await writeFile(p, 'data')
    expect(await readable(p)).toBe(true)
  })

  it('returns false for a non-existent path', async () => {
    expect(await readable(path.join(tmpDir, 'ghost'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

describe('ensureDir', () => {
  it('creates nested directories', async () => {
    const deep = path.join(tmpDir, 'a', 'b', 'c')
    await ensureDir(deep)
    expect(await exists(deep)).toBe(true)
  })

  it('is idempotent on existing directories', async () => {
    await ensureDir(tmpDir)
    await ensureDir(tmpDir)
    expect(await exists(tmpDir)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// pathSize
// ---------------------------------------------------------------------------

describe('pathSize', () => {
  it('returns file size for a regular file', async () => {
    const p = path.join(tmpDir, 'sized.txt')
    await writeFile(p, 'hello')
    expect(await pathSize(p)).toBe(5)
  })

  it('sums file sizes in a directory', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), '123')
    await writeFile(path.join(tmpDir, 'b.txt'), '4567')
    const size = await pathSize(tmpDir)
    expect(size).toBe(7)
  })

  it('ignores node_modules', async () => {
    const nm = path.join(tmpDir, 'node_modules')
    await mkdir(nm, { recursive: true })
    await writeFile(path.join(nm, 'big.js'), 'x'.repeat(10000))
    await writeFile(path.join(tmpDir, 'small.txt'), 'abc')
    const size = await pathSize(tmpDir)
    expect(size).toBe(3)
  })

  it('ignores .git directory', async () => {
    const git = path.join(tmpDir, '.git')
    await mkdir(git, { recursive: true })
    await writeFile(path.join(git, 'HEAD'), 'ref: refs/heads/main')
    await writeFile(path.join(tmpDir, 'code.ts'), 'export {}')
    const size = await pathSize(tmpDir)
    expect(size).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// safeReadText
// ---------------------------------------------------------------------------

describe('safeReadText', () => {
  it('reads a small file in full', async () => {
    const p = path.join(tmpDir, 'small.txt')
    await writeFile(p, 'hello')
    expect(await safeReadText(p)).toBe('hello')
  })

  it('truncates content to maxBytes', async () => {
    const p = path.join(tmpDir, 'big.txt')
    await writeFile(p, 'abcdefghij')
    const result = await safeReadText(p, 4)
    expect(result).toBe('abcd')
  })
})

// ---------------------------------------------------------------------------
// listFiles
// ---------------------------------------------------------------------------

describe('listFiles', () => {
  it('lists matching files', async () => {
    await writeFile(path.join(tmpDir, 'a.ts'), '')
    await writeFile(path.join(tmpDir, 'b.ts'), '')
    const files = await listFiles(tmpDir, ['**/*.ts'])
    expect(files).toHaveLength(2)
  })

  it('returns empty array for unreadable root', async () => {
    const files = await listFiles(path.join(tmpDir, 'does-not-exist'), ['**/*'])
    expect(files).toEqual([])
  })

  it('ignores node_modules', async () => {
    const nm = path.join(tmpDir, 'node_modules')
    await mkdir(nm, { recursive: true })
    await writeFile(path.join(nm, 'lib.js'), '')
    await writeFile(path.join(tmpDir, 'index.ts'), '')
    const files = await listFiles(tmpDir, ['**/*.{ts,js}'])
    expect(files.every((f) => !f.includes('node_modules'))).toBe(true)
    expect(files).toHaveLength(1)
  })

  it('ignores .git directory', async () => {
    const git = path.join(tmpDir, '.git')
    await mkdir(git, { recursive: true })
    await writeFile(path.join(git, 'config'), '')
    await writeFile(path.join(tmpDir, 'main.ts'), '')
    const files = await listFiles(tmpDir, ['**/*'])
    expect(files.every((f) => !f.includes('.git'))).toBe(true)
  })

  it('ignores credential-like file names', async () => {
    const credentialFiles = [
      'auth.token',
      'my_token.json',
      'secret_key.txt',
      'app.Secret',
      'oauth_creds.json',
      'OAuth.json',
      '.env',
      '.env.local',
      'api.credential',
      'service.Credential',
    ]
    for (const name of credentialFiles) {
      await writeFile(path.join(tmpDir, name), 'sensitive')
    }
    await writeFile(path.join(tmpDir, 'safe.ts'), 'export {}')
    const files = await listFiles(tmpDir, ['**/*'])
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('safe.ts')
  })

  it('respects maxFiles cap', async () => {
    for (let i = 0; i < 10; i++) {
      await writeFile(path.join(tmpDir, `file${i}.ts`), '')
    }
    const files = await listFiles(tmpDir, ['**/*.ts'], 3)
    expect(files).toHaveLength(3)
  })

  it('expands tilde in root path', async () => {
    const files = await listFiles('~/no-such-dir-xyzzy', ['**/*'])
    expect(files).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// copyPath
// ---------------------------------------------------------------------------

describe('copyPath', () => {
  it('copies a file to a new location', async () => {
    const src = path.join(tmpDir, 'src.txt')
    const dst = path.join(tmpDir, 'dst', 'dst.txt')
    await writeFile(src, 'copy me')
    await copyPath(src, dst)
    expect(await safeReadText(dst)).toBe('copy me')
  })

  it('copies a directory recursively', async () => {
    const srcDir = path.join(tmpDir, 'src-dir')
    await mkdir(srcDir, { recursive: true })
    await writeFile(path.join(srcDir, 'a.txt'), 'aaa')
    await writeFile(path.join(srcDir, 'b.txt'), 'bbb')
    const dstDir = path.join(tmpDir, 'dst-dir')
    await copyPath(srcDir, dstDir)
    expect(await safeReadText(path.join(dstDir, 'a.txt'))).toBe('aaa')
    expect(await safeReadText(path.join(dstDir, 'b.txt'))).toBe('bbb')
  })
})

// ---------------------------------------------------------------------------
// movePath
// ---------------------------------------------------------------------------

describe('movePath', () => {
  it('moves a file to a new location', async () => {
    const src = path.join(tmpDir, 'move-src.txt')
    const dst = path.join(tmpDir, 'moved', 'move-dst.txt')
    await writeFile(src, 'move me')
    await movePath(src, dst)
    expect(await exists(src)).toBe(false)
    expect(await safeReadText(dst)).toBe('move me')
  })

  it('creates parent directories for target', async () => {
    const src = path.join(tmpDir, 'src2.txt')
    const dst = path.join(tmpDir, 'a', 'b', 'c', 'dst2.txt')
    await writeFile(src, 'data')
    await movePath(src, dst)
    expect(await exists(dst)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// removePath
// ---------------------------------------------------------------------------

describe('removePath', () => {
  it('removes a file', async () => {
    const p = path.join(tmpDir, 'to-delete.txt')
    await writeFile(p, 'bye')
    await removePath(p)
    expect(await exists(p)).toBe(false)
  })

  it('removes a directory recursively', async () => {
    const dir = path.join(tmpDir, 'to-delete-dir')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'inner.txt'), 'inner')
    await removePath(dir)
    expect(await exists(dir)).toBe(false)
  })

  it('is a no-op for non-existent path', async () => {
    await expect(removePath(path.join(tmpDir, 'ghost'))).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// hashFile
// ---------------------------------------------------------------------------

describe('hashFile', () => {
  it('returns a hex SHA-256 string', async () => {
    const p = path.join(tmpDir, 'hash-me.txt')
    await writeFile(p, 'content')
    const h = await hashFile(p)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', async () => {
    const p = path.join(tmpDir, 'hash-me2.txt')
    await writeFile(p, 'same content')
    expect(await hashFile(p)).toBe(await hashFile(p))
  })

  it('differs for different content', async () => {
    const p1 = path.join(tmpDir, 'h1.txt')
    const p2 = path.join(tmpDir, 'h2.txt')
    await writeFile(p1, 'aaa')
    await writeFile(p2, 'bbb')
    expect(await hashFile(p1)).not.toBe(await hashFile(p2))
  })
})

// ---------------------------------------------------------------------------
// Brotli compress / decompress
// ---------------------------------------------------------------------------

describe('Brotli compress/decompress', () => {
  it('round-trips file content', async () => {
    const original = path.join(tmpDir, 'original.txt')
    const compressed = path.join(tmpDir, 'compressed.br')
    const decompressed = path.join(tmpDir, 'decompressed.txt')
    const content = 'hello brotli world '.repeat(100)
    await writeFile(original, content)
    await compressFileBrotli(original, compressed)
    await decompressFileBrotli(compressed, decompressed)
    expect(await safeReadText(decompressed)).toBe(content)
  })

  it('compressed file is smaller than original for compressible data', async () => {
    const original = path.join(tmpDir, 'data.txt')
    const compressed = path.join(tmpDir, 'data.br')
    await writeFile(original, 'repeat '.repeat(1000))
    await compressFileBrotli(original, compressed)
    expect(await pathSize(compressed)).toBeLessThan(await pathSize(original))
  })

  it('creates parent directories for target', async () => {
    const src = path.join(tmpDir, 'src.txt')
    const dst = path.join(tmpDir, 'nested', 'deep', 'out.br')
    await writeFile(src, 'data')
    await compressFileBrotli(src, dst)
    expect(await exists(dst)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// writeJson
// ---------------------------------------------------------------------------

describe('writeJson', () => {
  it('writes pretty-printed JSON', async () => {
    const p = path.join(tmpDir, 'out.json')
    await writeJson(p, { a: 1, b: [2, 3] })
    const text = await safeReadText(p)
    expect(JSON.parse(text)).toEqual({ a: 1, b: [2, 3] })
    expect(text).toContain('\n')
  })

  it('creates parent directories', async () => {
    const p = path.join(tmpDir, 'nested', 'dir', 'out.json')
    await writeJson(p, { ok: true })
    expect(await exists(p)).toBe(true)
  })

  it('overwrites an existing file', async () => {
    const p = path.join(tmpDir, 'overwrite.json')
    await writeJson(p, { v: 1 })
    await writeJson(p, { v: 2 })
    const text = await safeReadText(p)
    expect(JSON.parse(text)).toEqual({ v: 2 })
  })
})
