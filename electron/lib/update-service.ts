import path from 'node:path'
import { rename, rm, stat, writeFile } from 'node:fs/promises'
import type {
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateReleaseAsset,
} from '../../src/shared/types'
import { ensureDir, sanitizeName } from './files'

type FetchResponse = {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
}

type Fetcher = (
  url: string,
  init?: {
    headers?: Record<string, string>
  },
) => Promise<FetchResponse>

type GitHubReleaseAsset = {
  name: string
  browser_download_url: string
  size: number
}

type GitHubRelease = {
  tag_name: string
  name?: string
  html_url: string
  published_at?: string
  assets?: GitHubReleaseAsset[]
}

type UpdateServiceOptions = {
  userDataPath: string
  currentVersion: string
  repository?: string
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  fetcher?: Fetcher
}

const defaultRepository = 'blain3white/clean-my-agent'
const ignoredAssetSuffixes = [
  '.blockmap',
  '.json',
  '.sha',
  '.sha256',
  '.sig',
  '.txt',
  '.yaml',
  '.yml',
]

const archAliases: Record<string, string[]> = {
  arm64: ['arm64', 'aarch64', 'apple-silicon', 'silicon'],
  x64: ['x64', 'x86_64', 'amd64', 'intel'],
  ia32: ['ia32', 'x86'],
}

const platformAssetRules: Record<
  string,
  { tokens: string[]; extensions: string[]; preferredExtensions: string[] }
> = {
  darwin: {
    tokens: ['darwin', 'mac', 'macos', 'osx'],
    extensions: ['.dmg', '.zip'],
    preferredExtensions: ['.dmg'],
  },
  win32: {
    tokens: ['win', 'windows'],
    extensions: ['.exe', '.msi', '.zip'],
    preferredExtensions: ['.exe', '.msi'],
  },
  linux: {
    tokens: ['linux'],
    extensions: ['.appimage', '.deb', '.rpm', '.tar.gz', '.zip'],
    preferredExtensions: ['.appimage', '.deb'],
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isGitHubReleaseAsset(value: unknown): value is GitHubReleaseAsset {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    typeof value.browser_download_url === 'string' &&
    typeof value.size === 'number'
  )
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
  if (!isRecord(value)) return false
  return (
    typeof value.tag_name === 'string' &&
    typeof value.html_url === 'string' &&
    (value.assets === undefined ||
      (Array.isArray(value.assets) && value.assets.every(isGitHubReleaseAsset)))
  )
}

function versionParts(value: string): number[] {
  const match = value
    .trim()
    .replace(/^v/i, '')
    .match(/\d+(?:\.\d+){0,2}/)
  return (match?.[0] ?? '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .concat([0, 0, 0])
    .slice(0, 3)
}

export function normalizeVersionTag(value: string): string {
  return versionParts(value).join('.')
}

export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)

  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index]
    if (difference !== 0) return difference
  }

  return 0
}

function hasAnyToken(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token))
}

function assetScore(
  asset: GitHubReleaseAsset,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): number {
  const name = asset.name.toLowerCase()
  if (ignoredAssetSuffixes.some((suffix) => name.endsWith(suffix))) return -1
  if (name.includes('sha256') || name.includes('checksum')) return -1

  const rules = platformAssetRules[platform]
  if (!rules) return -1
  if (!rules.extensions.some((extension) => name.endsWith(extension))) return -1

  let score = 0
  if (hasAnyToken(name, rules.tokens)) score += 4
  if (rules.preferredExtensions.some((extension) => name.endsWith(extension))) score += 3

  const preferredArchTokens = archAliases[arch] ?? [arch]
  const knownArchTokens = Object.values(archAliases).flat()
  const hasKnownArch = hasAnyToken(name, knownArchTokens)

  if (hasAnyToken(name, preferredArchTokens)) {
    score += 5
  } else if (name.includes('universal')) {
    score += 2
  } else if (hasKnownArch) {
    score -= 5
  } else {
    score += 1
  }

  return score
}

export function selectUpdateAsset(
  assets: GitHubReleaseAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): UpdateReleaseAsset | undefined {
  const best = assets
    .map((asset) => ({ asset, score: assetScore(asset, platform, arch) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.asset.size - left.asset.size)[0]

  if (!best) return undefined

  return {
    name: best.asset.name,
    sizeBytes: best.asset.size,
    downloadUrl: best.asset.browser_download_url,
  }
}

export class UpdateService {
  private readonly userDataPath: string
  private readonly currentVersion: string
  private readonly repository: string
  private readonly platform: NodeJS.Platform
  private readonly arch: NodeJS.Architecture
  private readonly fetcher: Fetcher

  constructor(options: UpdateServiceOptions) {
    this.userDataPath = options.userDataPath
    this.currentVersion = options.currentVersion
    this.repository = options.repository ?? defaultRepository
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    const fetcher = options.fetcher ?? (globalThis.fetch as Fetcher | undefined)

    if (!fetcher) {
      throw new Error('Update checks require a runtime with fetch support.')
    }

    this.fetcher = fetcher
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const release = await this.fetchLatestRelease()
    const latestVersion = normalizeVersionTag(release.tag_name)
    const asset = selectUpdateAsset(release.assets ?? [], this.platform, this.arch)

    return {
      currentVersion: this.currentVersion,
      latestVersion,
      releaseName: release.name || release.tag_name,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      available: compareVersions(this.currentVersion, latestVersion) < 0,
      asset,
    }
  }

  async downloadLatestUpdate(): Promise<UpdateDownloadResult> {
    const check = await this.checkForUpdates()
    if (!check.available || !check.asset) return check

    const targetDir = path.join(this.userDataPath, 'Updates', `v${check.latestVersion}`)
    const targetPath = path.join(targetDir, sanitizeName(check.asset.name))
    const tempPath = `${targetPath}.download`

    await ensureDir(targetDir)

    try {
      const response = await this.request(check.asset.downloadUrl)
      const buffer = await response.arrayBuffer()
      await writeFile(tempPath, new Uint8Array(buffer))
      const info = await stat(tempPath)

      if (info.size <= 0) {
        throw new Error('Downloaded update asset is empty.')
      }

      await rm(targetPath, { force: true })
      await rename(tempPath, targetPath)

      return {
        ...check,
        downloadedPath: targetPath,
        downloadedBytes: info.size,
      }
    } finally {
      await rm(tempPath, { force: true })
    }
  }

  private async fetchLatestRelease(): Promise<GitHubRelease> {
    const response = await this.request(
      `https://api.github.com/repos/${this.repository}/releases/latest`,
    )
    const payload = await response.json()
    if (!isGitHubRelease(payload)) {
      throw new Error('GitHub latest release response was not recognized.')
    }
    return payload
  }

  private async request(url: string): Promise<FetchResponse> {
    const response = await this.fetcher(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Clean-My-Agent-Updater',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub update request failed (${response.status} ${response.statusText})`)
    }

    return response
  }
}
