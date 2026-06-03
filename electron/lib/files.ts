import { createHash } from 'node:crypto'
import { access, copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fg from 'fast-glob'

export const homeDir = os.homedir()

export function expandHome(inputPath: string): string {
  if (inputPath === '~') return homeDir
  if (inputPath.startsWith('~/')) return path.join(homeDir, inputPath.slice(2))
  return inputPath
}

export function hashId(parts: Array<string | number | undefined>): string {
  return createHash('sha256')
    .update(parts.filter((part) => part !== undefined).join('|'))
    .digest('hex')
    .slice(0, 24)
}

export function sanitizeName(name: string): string {
  return name
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item'
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function readable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function pathSize(filePath: string, maxEntries = 2000): Promise<number> {
  const info = await stat(filePath)
  if (!info.isDirectory()) return info.size

  const files = await fg('**/*', {
    cwd: filePath,
    absolute: true,
    dot: true,
    onlyFiles: true,
    suppressErrors: true,
    ignore: ['**/.git/**', '**/node_modules/**'],
  })

  let total = 0
  for (const item of files.slice(0, maxEntries)) {
    try {
      total += (await stat(item)).size
    } catch {
      continue
    }
  }
  return total
}

export async function mtimeIso(filePath: string): Promise<string> {
  return (await stat(filePath)).mtime.toISOString()
}

export async function safeReadText(filePath: string, maxBytes = 2_000_000): Promise<string> {
  const info = await stat(filePath)
  const handle = await readFile(filePath)
  if (info.size <= maxBytes) return handle.toString('utf8')
  return handle.subarray(0, maxBytes).toString('utf8')
}

export async function listFiles(root: string, patterns: string[], maxFiles = 1500): Promise<string[]> {
  const absoluteRoot = expandHome(root)
  if (!(await readable(absoluteRoot))) return []

  const files = await fg(patterns, {
    cwd: absoluteRoot,
    absolute: true,
    dot: true,
    onlyFiles: true,
    suppressErrors: true,
    ignore: [
      '**/.git/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/*.map',
      '**/*token*',
      '**/*Token*',
      '**/*secret*',
      '**/*Secret*',
      '**/*credential*',
      '**/*Credential*',
      '**/*oauth*',
      '**/*OAuth*',
      '**/.env*',
    ],
  })

  return files.slice(0, maxFiles)
}

export async function copyPath(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDir(path.dirname(targetPath))
  const info = await stat(sourcePath)
  if (info.isDirectory()) {
    await cp(sourcePath, targetPath, { recursive: true, force: true })
    return
  }
  await copyFile(sourcePath, targetPath)
}

export async function movePath(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDir(path.dirname(targetPath))
  try {
    await rename(sourcePath, targetPath)
  } catch {
    await copyPath(sourcePath, targetPath)
    await rm(sourcePath, { recursive: true, force: true })
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, JSON.stringify(value, null, 2))
}
