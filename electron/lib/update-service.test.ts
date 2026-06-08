import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareVersions,
  normalizeVersionTag,
  selectUpdateAsset,
  UpdateService,
} from './update-service'

type FetchResponse = {
  ok: boolean
  status: number
  statusText: string
  json: () => Promise<unknown>
  arrayBuffer: () => Promise<ArrayBuffer>
}

function jsonResponse(value: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => value,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function fileResponse(value: string): FetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    arrayBuffer: async () => new TextEncoder().encode(value).buffer,
  }
}

let userDataPath: string

beforeEach(async () => {
  userDataPath = await mkdtemp(path.join(os.tmpdir(), 'cma-updates-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(userDataPath, { recursive: true, force: true })
})

describe('version helpers', () => {
  it('normalizes release tags for comparison', () => {
    expect(normalizeVersionTag('v1.2.3')).toBe('1.2.3')
    expect(normalizeVersionTag('release-2.1')).toBe('2.1.0')
  })

  it('compares semantic versions', () => {
    expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0)
    expect(compareVersions('v1.4.0', '1.3.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})

describe('selectUpdateAsset', () => {
  it('selects the current macOS architecture installer', () => {
    const asset = selectUpdateAsset(
      [
        {
          name: 'Clean-My-Agent-mac-x64.dmg',
          browser_download_url: 'https://example.test/x64.dmg',
          size: 10,
        },
        {
          name: 'Clean-My-Agent-mac-arm64.dmg',
          browser_download_url: 'https://example.test/arm64.dmg',
          size: 20,
        },
        {
          name: 'latest-mac.yml',
          browser_download_url: 'https://example.test/latest.yml',
          size: 5,
        },
      ],
      'darwin',
      'arm64',
    )

    expect(asset?.name).toBe('Clean-My-Agent-mac-arm64.dmg')
  })

  it('ignores assets for other platforms', () => {
    const asset = selectUpdateAsset(
      [
        {
          name: 'Clean-My-Agent-mac-arm64.dmg',
          browser_download_url: 'https://example.test/mac.dmg',
          size: 10,
        },
      ],
      'linux',
      'x64',
    )

    expect(asset).toBeUndefined()
  })

  it('falls back to universal assets and prefers larger ties', () => {
    const asset = selectUpdateAsset(
      [
        {
          name: 'Clean-My-Agent-mac-universal.zip',
          browser_download_url: 'https://example.test/small.zip',
          size: 10,
        },
        {
          name: 'Clean-My-Agent-mac-universal-large.zip',
          browser_download_url: 'https://example.test/large.zip',
          size: 20,
        },
      ],
      'darwin',
      'arm64',
    )

    expect(asset?.downloadUrl).toBe('https://example.test/large.zip')
  })

  it('penalizes mismatched architecture assets and ignores checksums', () => {
    const asset = selectUpdateAsset(
      [
        {
          name: 'Clean-My-Agent-mac-x64.dmg',
          browser_download_url: 'https://example.test/x64.dmg',
          size: 20,
        },
        {
          name: 'Clean-My-Agent-mac-arm64.sha256',
          browser_download_url: 'https://example.test/checksum',
          size: 1,
        },
      ],
      'darwin',
      'arm64',
    )

    expect(asset?.name).toBe('Clean-My-Agent-mac-x64.dmg')
  })
})

describe('UpdateService', () => {
  it('requires a fetch implementation', () => {
    vi.stubGlobal('fetch', undefined)

    expect(
      () =>
        new UpdateService({
          userDataPath,
          currentVersion: '0.1.1',
        }),
    ).toThrow(/fetch support/)
  })

  it('reports when a newer GitHub release is available', async () => {
    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.1.1',
      platform: 'darwin',
      arch: 'arm64',
      fetcher: async () =>
        jsonResponse({
          tag_name: 'v0.2.0',
          name: 'Clean My Agent 0.2.0',
          html_url: 'https://github.com/blain3white/clean-my-agent/releases/tag/v0.2.0',
          published_at: '2026-06-01T00:00:00.000Z',
          assets: [
            {
              name: 'Clean-My-Agent-mac-arm64.dmg',
              browser_download_url: 'https://example.test/update.dmg',
              size: 12,
            },
          ],
        }),
    })

    const result = await service.checkForUpdates()

    expect(result.available).toBe(true)
    expect(result.latestVersion).toBe('0.2.0')
    expect(result.asset?.name).toBe('Clean-My-Agent-mac-arm64.dmg')
  })

  it('reports no update when the latest release is not newer', async () => {
    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.2.0',
      platform: 'darwin',
      arch: 'arm64',
      fetcher: async () =>
        jsonResponse({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/blain3white/clean-my-agent/releases/tag/v0.2.0',
        }),
    })

    const result = await service.downloadLatestUpdate()

    expect(result.available).toBe(false)
    expect(result.downloadedPath).toBeUndefined()
  })

  it('returns an available release without downloading when no installer asset matches', async () => {
    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.1.1',
      platform: 'darwin',
      arch: 'arm64',
      fetcher: async () =>
        jsonResponse({
          tag_name: 'v0.2.0',
          html_url: 'https://github.com/blain3white/clean-my-agent/releases/tag/v0.2.0',
          assets: [
            {
              name: 'latest-mac.yml',
              browser_download_url: 'https://example.test/latest.yml',
              size: 12,
            },
          ],
        }),
    })

    const result = await service.downloadLatestUpdate()

    expect(result.available).toBe(true)
    expect(result.asset).toBeUndefined()
    expect(result.downloadedPath).toBeUndefined()
  })

  it('downloads the selected release asset into user data updates', async () => {
    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.1.1',
      platform: 'darwin',
      arch: 'arm64',
      fetcher: async (url) => {
        if (url.includes('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v0.2.0',
            html_url: 'https://github.com/blain3white/clean-my-agent/releases/tag/v0.2.0',
            assets: [
              {
                name: 'Clean My Agent mac arm64.dmg',
                browser_download_url: 'https://example.test/update.dmg',
                size: 12,
              },
            ],
          })
        }

        return fileResponse('installer-bytes')
      },
    })

    const result = await service.downloadLatestUpdate()

    expect(result.downloadedPath).toContain(path.join(userDataPath, 'Updates', 'v0.2.0'))
    expect(result.downloadedPath).toMatch(/Clean-My-Agent-mac-arm64\.dmg$/)
    expect(result.downloadedBytes).toBeGreaterThan(0)
    expect(await readFile(result.downloadedPath ?? '', 'utf8')).toBe('installer-bytes')
  })

  it('rejects empty downloaded assets', async () => {
    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.1.1',
      platform: 'darwin',
      arch: 'arm64',
      fetcher: async (url) => {
        if (url.includes('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v0.2.0',
            html_url: 'https://github.com/blain3white/clean-my-agent/releases/tag/v0.2.0',
            assets: [
              {
                name: 'Clean-My-Agent-mac-arm64.dmg',
                browser_download_url: 'https://example.test/update.dmg',
                size: 12,
              },
            ],
          })
        }

        return fileResponse('')
      },
    })

    await expect(service.downloadLatestUpdate()).rejects.toThrow(/empty/)
  })

  it('removes partial downloads when the asset request fails', async () => {
    const targetDir = path.join(userDataPath, 'Updates', 'v0.2.0')
    await mkdir(targetDir, { recursive: true })

    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.1.1',
      platform: 'darwin',
      arch: 'arm64',
      fetcher: async (url) => {
        if (url.includes('/releases/latest')) {
          return jsonResponse({
            tag_name: 'v0.2.0',
            html_url: 'https://github.com/blain3white/clean-my-agent/releases/tag/v0.2.0',
            assets: [
              {
                name: 'Clean-My-Agent-mac-arm64.dmg',
                browser_download_url: 'https://example.test/update.dmg',
                size: 12,
              },
            ],
          })
        }

        return {
          ok: false,
          status: 500,
          statusText: 'Server Error',
          json: async () => ({}),
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
    })

    await expect(service.downloadLatestUpdate()).rejects.toThrow(/GitHub update request failed/)
  })

  it('rejects unrecognized latest release responses', async () => {
    const service = new UpdateService({
      userDataPath,
      currentVersion: '0.1.1',
      fetcher: async () => jsonResponse({ tag_name: 'v0.2.0' }),
    })

    await expect(service.checkForUpdates()).rejects.toThrow(/not recognized/)
  })
})
