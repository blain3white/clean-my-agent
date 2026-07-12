import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adapterFor } from './adapters'
import type { AgentSource, AppSettings, SessionRecord } from '../../src/shared/types'
import {
  writeRealWorldAgentFixtures,
  type RealWorldAgentFixtureLibrary,
} from './fixtures/real-world-agent-sessions'

const sources = ['codex', 'claude', 'cursor', 'gemini', 'opencode', 'pi'] as const

let tmpBase: string

beforeEach(async () => {
  tmpBase = await mkdtemp(path.join(os.tmpdir(), 'cma-real-world-fixtures-'))
})

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

function makeSettings(fixture: RealWorldAgentFixtureLibrary, source: AgentSource): AppSettings {
  return {
    scanRoots: { [source]: fixture.scanRoots[source] ?? [] } as AppSettings['scanRoots'],
    cleanupRetentionDays: 30,
    trashRetentionDays: 7,
    autoBackup: false,
    mockDataEnabled: false,
    language: 'en',
    usageTimezone: 'UTC',
    launchAtLogin: false,
    enabledProviders: {},
    scanOnLaunch: true,
    backgroundScan: true,
    confirmBeforeCleanup: true,
    excludedFolders: [],
    soundEffects: true,
    cleanupSound: true,
    scanSound: false,
    errorSound: true,
    soundVolume: 35,
    checkForUpdates: true,
    defaultRelayMode: 'full-context',
    exportDirectory: path.join(tmpBase, 'exports'),
  }
}

function sessionByPhrase(source: AgentSource, sessions: SessionRecord[], phrase: string) {
  const session = sessions.find((item) => item.searchText?.includes(phrase))
  if (!session) throw new Error(`Expected ${source} fixture session containing "${phrase}"`)
  return session
}

describe('real-world agent scan compatibility fixtures', () => {
  it('scans dirty Cursor, Claude, Codex, Gemini, and OpenCode fixture layouts', async () => {
    const fixture = await writeRealWorldAgentFixtures(tmpBase)

    for (const source of sources) {
      const adapter = adapterFor(source)
      const { state, sessions } = await adapter.scan(makeSettings(fixture, source))
      const expected = fixture.expectations[source]
      const session = sessionByPhrase(source, sessions, expected.phrase)

      expect(state.installed).toBe(true)
      expect(state.readable).toBe(true)
      expect(state.scannedFiles).toBeGreaterThanOrEqual(sessions.length)
      expect(
        sessions.some((item) => item.searchText?.includes(fixture.ignoredCredentialPhrase)),
      ).toBe(false)
      expect(session.projectPath).toBe(expected.projectPath)
      expect(session.projectName).toBe(path.basename(expected.projectPath))
      expect(session.storageKind).toBe(expected.storageKind)
      expect(session.messageCount).toBeGreaterThanOrEqual(expected.minMessages)
      expect(session.tokens.total).toBeGreaterThanOrEqual(expected.minTokens)
      if (expected.branch) expect(session.branch).toBe(expected.branch)
      if (expected.sourceFormat) expect(session.metadata.sourceFormat).toBe(expected.sourceFormat)
    }
  })

  it('reads Cursor state.vscdb as SQLite JSON KV instead of raw text', async () => {
    const fixture = await writeRealWorldAgentFixtures(tmpBase)
    const adapter = adapterFor('cursor')
    const { sessions } = await adapter.scan(makeSettings(fixture, 'cursor'))
    const session = sessionByPhrase('cursor', sessions, fixture.expectations.cursor.phrase)
    const workspace = sessions.find((item) => item.storagePath.endsWith('workspace.json'))

    expect(session.storagePath.endsWith('state.vscdb')).toBe(true)
    expect(session.metadata.sourceFormat).toBe('cursor-state-sqlite')
    expect(workspace?.metadata.sourceFormat).toBe('cursor-workspace-json')
    expect(workspace?.projectPath).toBe(fixture.expectations.cursor.projectPath)

    const relay = await adapter.toUniversal(session)
    expect(relay.messages.map((message) => message.text)).toEqual(
      expect.arrayContaining(['Cursor composer dirty prompt', 'Cursor composer dirty response']),
    )
    expect(relay.commands).toEqual(
      expect.arrayContaining([
        {
          command: 'pnpm test -- --runInBand',
          cwd: undefined,
          createdAt: '2026-06-08T10:15:30.000Z',
        },
      ]),
    )
    expect(relay.files).toEqual(
      expect.arrayContaining([
        {
          path: path.join(fixture.expectations.cursor.projectPath, 'src/cursor.ts'),
          reason: 'Listed in files',
          lastSeenAt: '2026-06-08T10:15:30.000Z',
        },
      ]),
    )
  })
})
