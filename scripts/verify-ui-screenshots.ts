import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from 'playwright'
import { mockSnapshot } from '../src/lib/mock-data.ts'
import type {
  AppLanguage,
  AppSettings,
  DashboardSnapshot,
  SessionRecord,
} from '../src/shared/types.ts'

type Theme = 'light' | 'dark'
type DataMode = 'empty' | 'large'
type TargetId = 'settings' | 'cleanup' | 'usage' | 'update'

type ViewportCase = {
  id: string
  width: number
  height: number
}

type ScreenshotRecord = {
  dataMode: DataMode
  language: AppLanguage
  theme: Theme
  viewport: string
  target: TargetId
  path: string
  bytes: number
  status: 'passed' | 'failed'
  errors: string[]
}

const host = '127.0.0.1'
const portRange = Array.from({ length: 20 }, (_, index) => 14100 + index)
const outputDir = path.resolve('output/playwright/ui-acceptance')

const allLanguages: AppLanguage[] = ['en', 'zh-CN', 'ja', 'fr']
const allThemes: Theme[] = ['light', 'dark']
const allDataModes: DataMode[] = ['empty', 'large']
const allViewports: ViewportCase[] = [
  { id: 'compact', width: 1024, height: 768 },
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'wide', width: 1728, height: 1117 },
]

const allTargets: Array<{
  id: TargetId
  navIndex: number
  readyText: Partial<Record<AppLanguage, string>>
  focusText?: Partial<Record<AppLanguage, string>>
}> = [
  {
    id: 'settings',
    navIndex: 5,
    readyText: { en: 'Settings', 'zh-CN': '设置', ja: '設定', fr: 'Réglages' },
  },
  {
    id: 'cleanup',
    navIndex: 3,
    readyText: { en: 'Cleanup', 'zh-CN': '清理', ja: 'クリーンアップ', fr: 'Nettoyage' },
  },
  {
    id: 'usage',
    navIndex: 4,
    readyText: { en: 'Usage', 'zh-CN': '用量', ja: '使用量', fr: 'Utilisation' },
  },
  {
    id: 'update',
    navIndex: 5,
    readyText: { en: 'Settings', 'zh-CN': '设置', ja: '設定', fr: 'Réglages' },
    focusText: {
      en: 'Check for updates',
      'zh-CN': '检查更新',
      ja: 'アップデートを確認',
      fr: 'Rechercher les mises à jour',
    },
  },
]

const agentSources = ['codex', 'claude', 'cursor', 'gemini', 'opencode', 'custom'] as const

function selectCases<T extends string>(allCases: T[], envName: string) {
  const raw = process.env[envName]
  if (!raw) return allCases
  const requested = new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  return allCases.filter((item) => requested.has(item))
}

function selectViewports(allCases: ViewportCase[]) {
  const raw = process.env.CMA_UI_VIEWPORTS
  if (!raw) return allCases
  const requested = new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  return allCases.filter((item) => requested.has(item.id))
}

const languages = selectCases(allLanguages, 'CMA_UI_LANGUAGES')
const themes = selectCases(allThemes, 'CMA_UI_THEMES')
const dataModes = selectCases(allDataModes, 'CMA_UI_DATA_MODES')
const viewports = selectViewports(allViewports)
const targets = allTargets.filter((target) =>
  selectCases(
    allTargets.map((item) => item.id),
    'CMA_UI_TARGETS',
  ).includes(target.id),
)

function createDefaultSettings(language: AppLanguage): AppSettings {
  return {
    scanRoots: {},
    cleanupRetentionDays: 7,
    trashRetentionDays: 14,
    autoBackup: true,
    mockDataEnabled: false,
    language,
    usageTimezone: 'UTC',
    launchAtLogin: false,
    enabledProviders: Object.fromEntries(agentSources.map((source) => [source, true])),
    scanOnLaunch: true,
    backgroundScan: false,
    confirmBeforeCleanup: true,
    excludedFolders: [],
    soundEffects: false,
    cleanupSound: false,
    scanSound: false,
    errorSound: false,
    soundVolume: 35,
    checkForUpdates: true,
    defaultRelayMode: 'full-context',
    exportDirectory: '',
  }
}

function createEmptySnapshot(): DashboardSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    overview: {
      totalSessions: 0,
      backedUpSessions: 0,
      reclaimableBytes: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      totalSizeBytes: 0,
      highRiskCleanupCount: 0,
    },
    agents: agentSources.map((source) => ({
      source,
      name: source === 'opencode' ? 'OpenCode' : source[0].toUpperCase() + source.slice(1),
      installed: false,
      readable: false,
      rootPaths: [],
      sessionCount: 0,
      sizeBytes: 0,
    })),
    sessions: [],
    cleanup: [],
    archives: [],
    backups: [],
    trash: [],
    usage: [],
    storage: [],
  }
}

function createLargeSnapshot(): DashboardSnapshot {
  const now = Date.now()
  const sessions = Array.from({ length: 96 }, (_, index) => {
    const base = mockSnapshot.sessions[index % mockSnapshot.sessions.length]
    const source = agentSources[index % (agentSources.length - 1)]
    const updatedAt = new Date(now - index * 45 * 60 * 1000).toISOString()
    const tokenMultiplier = 1 + (index % 9)
    const tokens = {
      ...base.tokens,
      input: base.tokens.input * tokenMultiplier,
      output: base.tokens.output * tokenMultiplier,
      cached: base.tokens.cached * tokenMultiplier,
      cacheCreation: (base.tokens.cacheCreation ?? 0) * tokenMultiplier,
      cacheRead: (base.tokens.cacheRead ?? 0) * tokenMultiplier,
      total: base.tokens.total * tokenMultiplier,
      costUsd: base.tokens.costUsd ? base.tokens.costUsd * tokenMultiplier : undefined,
    }
    const session: SessionRecord = {
      ...base,
      id: `large-${index + 1}-${base.id}`,
      source,
      title: `${base.title} #${index + 1}`,
      projectName: `${base.projectName}-${(index % 12) + 1}`,
      projectPath: `/Users/demo/projects/${base.projectName}-${(index % 12) + 1}`,
      branch: index % 3 === 0 ? 'main' : `feature/ui-${index + 1}`,
      storagePath: `/demo/${source}/large-${index + 1}.jsonl`,
      storageState: index % 5 === 0 ? 'archived' : 'live',
      createdAt: new Date(now - (index + 72) * 60 * 60 * 1000).toISOString(),
      lastUpdated: updatedAt,
      messageCount: base.messageCount + index * 3,
      tokens,
      sizeBytes: base.sizeBytes + index * 1024 * 1024,
      backupStatus: index % 4 === 0 ? 'pending' : 'backed-up',
      tags: [...base.tags, 'large-matrix'],
      searchText: `${base.searchText ?? ''} large matrix ${index + 1}`,
    }
    return session
  })

  const cleanup = Array.from({ length: 72 }, (_, index) => {
    const base = mockSnapshot.cleanup[index % mockSnapshot.cleanup.length]
    const session = sessions[index % sessions.length]
    return {
      ...base,
      id: `large-cleanup-${index + 1}`,
      title: `${base.title} #${index + 1}`,
      source: session.source,
      sessionIds: [session.id],
      paths: base.paths.map((item) => `${item}.${index + 1}`),
      sizeBytes: base.sizeBytes + index * 512 * 1024,
      lastUpdated: session.lastUpdated,
      risk: index % 9 === 0 ? 'high' : index % 3 === 0 ? 'medium' : 'low',
      backedUp: index % 4 !== 0,
    }
  })

  const usage = Array.from({ length: 180 }, (_, index) => {
    const base = mockSnapshot.usage[index % mockSnapshot.usage.length]
    const multiplier = 1 + (index % 11)
    return {
      ...base,
      date: new Date(now - (179 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      codex: base.codex * multiplier,
      claude: base.claude * multiplier,
      cursor: base.cursor * multiplier,
      gemini: base.gemini * multiplier,
      opencode: base.opencode * multiplier,
      custom: base.custom * multiplier,
      total: base.total * multiplier,
    }
  })

  const totalTokens = sessions.reduce((sum, session) => sum + session.tokens.total, 0)
  const totalCostUsd = sessions.reduce((sum, session) => sum + (session.tokens.costUsd ?? 0), 0)
  const totalSizeBytes = sessions.reduce((sum, session) => sum + session.sizeBytes, 0)
  const reclaimableBytes = cleanup.reduce((sum, candidate) => sum + candidate.sizeBytes, 0)

  return {
    ...mockSnapshot,
    generatedAt: new Date().toISOString(),
    overview: {
      totalSessions: sessions.length,
      backedUpSessions: sessions.filter((session) => session.backupStatus === 'backed-up').length,
      reclaimableBytes,
      lastBackupAt: sessions[0]?.lastUpdated,
      totalTokens,
      totalCostUsd,
      totalSizeBytes,
      highRiskCleanupCount: cleanup.filter((candidate) => candidate.risk === 'high').length,
    },
    agents: mockSnapshot.agents.map((agent) => {
      const agentSessions = sessions.filter((session) => session.source === agent.source)
      return {
        ...agent,
        installed: true,
        readable: true,
        sessionCount: agentSessions.length,
        sizeBytes: agentSessions.reduce((sum, session) => sum + session.sizeBytes, 0),
        lastScannedAt: new Date().toISOString(),
      }
    }),
    sessions,
    cleanup,
    usage,
    storage: mockSnapshot.storage.map((slice, index) => ({
      ...slice,
      sizeBytes: slice.sizeBytes * (index + 4),
      sessions: slice.sessions ? slice.sessions * (index + 2) : undefined,
    })),
  }
}

function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

async function findPort() {
  for (const port of portRange) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No available dev server port in ${portRange[0]}-${portRange.at(-1)}`)
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Retry until Vite finishes startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function startServer() {
  if (process.env.CMA_UI_BASE_URL) {
    const baseUrl = process.env.CMA_UI_BASE_URL.replace(/\/$/, '')
    await waitForHttp(baseUrl)
    return { baseUrl, child: undefined }
  }

  const port = await findPort()
  const baseUrl = `http://${host}:${port}`
  const child = spawn(
    'pnpm',
    ['exec', 'vite', '--host', host, '--port', String(port), '--strictPort'],
    {
      env: { ...process.env, CMA_DEV_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  child.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  await waitForHttp(baseUrl)
  return { baseUrl, child }
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-|-$/g, '')
}

async function installBridge(
  context: BrowserContext,
  dataMode: DataMode,
  language: AppLanguage,
  theme: Theme,
) {
  const snapshot = dataMode === 'empty' ? createEmptySnapshot() : createLargeSnapshot()
  const settings = createDefaultSettings(language)
  await context.addInitScript(`
    (() => {
      const nextSnapshot = ${JSON.stringify(snapshot)}
      const nextSettings = ${JSON.stringify(settings)}
      const nextLanguage = ${JSON.stringify(language)}
      const nextTheme = ${JSON.stringify(theme)}

      window.localStorage.setItem('clean-my-agent.language', nextLanguage)
      window.localStorage.setItem('clean-my-agent.theme', nextTheme)
      window.localStorage.setItem('clean-my-agent.mockDataEnabled', 'false')
      Object.defineProperty(window, 'cleanMyAgent', {
        configurable: true,
        value: {
          getSettings: async () => nextSettings,
          updateSettings: async (patch) => ({ ...nextSettings, ...patch }),
          getLaunchAtLogin: async () => false,
          setLaunchAtLogin: async (enabled) => enabled,
          getSnapshot: async () => nextSnapshot,
          rescan: async () => nextSnapshot,
          refreshRecentSessions: async () => nextSnapshot,
          checkForUpdates: async () => ({
            available: false,
            currentVersion: '0.1.1',
            latestVersion: '0.1.1',
          }),
          downloadLatestUpdate: async () => ({
            available: false,
            currentVersion: '0.1.1',
            latestVersion: '0.1.1',
          }),
          openPath: async () => undefined,
          chooseFolders: async () => [],
          backupSession: async () => ({
            id: 'matrix-backup',
            sessionId: nextSnapshot.sessions[0]?.id ?? 'empty',
            source: nextSnapshot.sessions[0]?.source ?? 'codex',
            title: nextSnapshot.sessions[0]?.title ?? 'Empty',
            createdAt: new Date().toISOString(),
            sizeBytes: 0,
            backupPath: '/tmp/matrix-backup',
            originalPath: '/tmp/matrix-original',
            format: 'raw-copy',
          }),
          archiveSession: async () => undefined,
          restoreArchive: async () => undefined,
          exportSession: async () => undefined,
          exportUniversalRelay: async () => undefined,
          getSessionDetail: async (sessionId) => ({
            schema: 'clean-my-agent.universal-session.v1',
            exportedAt: new Date().toISOString(),
            source: nextSnapshot.sessions[0]?.source ?? 'codex',
            session: nextSnapshot.sessions.find((session) => session.id === sessionId) ?? nextSnapshot.sessions[0],
            messages: [],
            files: [],
            commands: [],
            attachments: [],
            warnings: [],
          }),
          scanCleanup: async () => nextSnapshot.cleanup,
          moveCleanupToTrash: async () => undefined,
          restoreTrash: async () => undefined,
          purgeExpiredTrash: async () => undefined,
          scanSkills: async () => ({
            generatedAt: new Date().toISOString(),
            skills: [],
            summary: {},
          }),
        },
      })
    })()
  `)
}

async function settle(page: Page, text?: string) {
  await page.waitForLoadState('domcontentloaded')
  if (text) {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10_000 })
  }
  await page.waitForFunction(() => !document.body.textContent?.includes('Loading...'))
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(200)
}

async function navigateToTarget(
  page: Page,
  target: (typeof targets)[number],
  language: AppLanguage,
) {
  await page.locator('aside nav button').nth(target.navIndex).click()
  await settle(page, target.readyText[language])
  const focusText = target.focusText?.[language]
  if (focusText) {
    await page.getByText(focusText, { exact: false }).first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
  }
}

function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

async function runCase(
  browser: Browser,
  baseUrl: string,
  dataMode: DataMode,
  theme: Theme,
  language: AppLanguage,
  viewport: ViewportCase,
  target: (typeof targets)[number],
): Promise<ScreenshotRecord> {
  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 1,
    locale: language === 'zh-CN' ? 'zh-CN' : language,
    viewport: { width: viewport.width, height: viewport.height },
  })
  await installBridge(context, dataMode, language, theme)
  const page = await context.newPage()
  const errors = trackPageErrors(page)
  const fileName = sanitizeFileName(
    `${dataMode}__${theme}__${language}__${viewport.id}__${target.id}.png`,
  )
  const screenshotPath = path.join(outputDir, fileName)

  try {
    await page.goto(baseUrl)
    await settle(page, target.readyText[language])
    await navigateToTarget(page, target, language)
    await page.screenshot({ path: screenshotPath, fullPage: false })
    const { size } = await stat(screenshotPath)
    if (size < 10_000) errors.push(`Screenshot looks too small: ${size} bytes`)
    return {
      dataMode,
      language,
      theme,
      viewport: viewport.id,
      target: target.id,
      path: screenshotPath,
      bytes: size,
      status: errors.length === 0 ? 'passed' : 'failed',
      errors,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return {
      dataMode,
      language,
      theme,
      viewport: viewport.id,
      target: target.id,
      path: screenshotPath,
      bytes: 0,
      status: 'failed',
      errors,
    }
  } finally {
    await page.close().catch(() => undefined)
    await context.close().catch(() => undefined)
  }
}

async function main() {
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  let child: ChildProcess | undefined
  let browser: Browser | undefined
  const records: ScreenshotRecord[] = []
  let baseUrl: string | undefined

  try {
    const server = await startServer()
    baseUrl = server.baseUrl
    child = server.child
    browser = await chromium.launch()

    for (const dataMode of dataModes) {
      for (const theme of themes) {
        for (const language of languages) {
          for (const viewport of viewports) {
            for (const target of targets) {
              const record = await runCase(
                browser,
                baseUrl,
                dataMode,
                theme,
                language,
                viewport,
                target,
              )
              records.push(record)
              const marker = record.status === 'passed' ? 'PASS' : 'FAIL'
              console.log(
                `${marker} ${dataMode}/${theme}/${language}/${viewport.id}/${target.id} ${record.bytes} bytes`,
              )
              if (record.status === 'failed') {
                for (const error of record.errors.slice(0, 3)) console.error(`  ${error}`)
              }
            }
          }
        }
      }
    }
  } finally {
    await browser?.close().catch(() => undefined)
    if (child) stopServer(child)
  }

  const manifestPath = path.join(outputDir, 'manifest.json')
  const failed = records.filter((record) => record.status === 'failed')
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl,
        total: records.length,
        passed: records.length - failed.length,
        failed: failed.length,
        records,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`Wrote ${records.length} screenshots to ${outputDir}`)
  console.log(`Wrote manifest to ${manifestPath}`)

  if (failed.length > 0) {
    for (const record of failed.slice(0, 10)) {
      console.error(
        `FAILED ${record.dataMode}/${record.theme}/${record.language}/${record.viewport}/${record.target}`,
      )
      for (const error of record.errors) console.error(`  ${error}`)
    }
    throw new Error(`${failed.length} UI screenshot acceptance case(s) failed`)
  }
}

function stopServer(child: ChildProcess) {
  if (child.killed) return
  child.kill('SIGTERM')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
