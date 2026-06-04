import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppService } from './app-service'
import { agentSources, type AgentSource } from '../../src/shared/types'

async function writeJsonlSession(root: string, source: AgentSource) {
  const dir = path.join(root, source)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${source}-session.jsonl`)
  const timestamp = new Date('2026-02-01T12:00:00.000Z').toISOString()
  const lines = [
    {
      role: 'user',
      timestamp,
      content: 'Investigate rare migration needle in billing reports',
      cwd: path.join('/tmp', 'clean-my-agent-fixture', source),
      branch: 'archive-test',
      usage: {
        input_tokens: 120,
        output_tokens: 30,
      },
    },
    {
      role: 'assistant',
      timestamp,
      content: 'The rare migration needle comes from the archived ledger adapter.',
      usage: {
        input_tokens: 40,
        output_tokens: 90,
      },
    },
  ]
  await writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)
  return filePath
}

describe('AppService archive vault', () => {
  it('archives sessions into the vault without dropping indexed stats or search text', async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-archive-fixture-'))
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), 'clean-my-agent-archive-user-data-'))
    const filePath = await writeJsonlSession(fixtureRoot, 'codex')

    const service = new AppService({
      userDataPath,
      openPath: async () => undefined,
    })
    await service.init()
    service.updateSettings({
      scanRoots: Object.fromEntries(
        agentSources.map((source) => [source, [path.join(fixtureRoot, source)]]),
      ),
      exportDirectory: path.join(userDataPath, 'Exports'),
    })

    const initial = await service.rescan()
    const session = initial.sessions.find((item) => item.source === 'codex')
    assert.ok(session)
    expect(session.storageState).toBe('live')
    expect(session.searchText).toContain('rare migration needle')

    const archive = await service.archiveSession(session.id)
    expect(archive.originalPath).toBe(filePath)
    expect(archive.originalBytes).toBeGreaterThan(0)
    expect(archive.compressedBytes).toBeGreaterThan(0)
    expect(archive.compressedBytes).toBeLessThan(archive.originalBytes)

    await expect(stat(filePath)).rejects.toThrow()
    expect((await stat(archive.archivePath)).size).toBe(archive.compressedBytes)

    const archivedSnapshot = await service.getSnapshot(false)
    expect(archivedSnapshot.archives).toHaveLength(1)
    expect(archivedSnapshot.sessions).toHaveLength(1)
    expect(archivedSnapshot.sessions[0].storageState).toBe('archived')
    expect(archivedSnapshot.sessions[0].searchText).toContain('rare migration needle')
    expect(archivedSnapshot.overview.totalTokens).toBe(initial.overview.totalTokens)
    expect(archivedSnapshot.overview.totalSizeBytes).toBe(archive.compressedBytes)
    expect(archivedSnapshot.usage.find((point) => point.date === '2026-02-01')?.total).toBe(
      initial.overview.totalTokens,
    )

    const relayPath = await service.exportUniversalRelay(session.id)
    const relay = JSON.parse(await readFile(relayPath, 'utf8')) as {
      messages: Array<{ text: string }>
    }
    expect(relay.messages.some((message) => message.text.includes('rare migration needle'))).toBe(
      true,
    )

    await writeFile(filePath, 'new live session should not be overwritten')
    await expect(service.restoreArchive(archive.id)).rejects.toThrow(/already exists/)
    expect(await readFile(filePath, 'utf8')).toBe('new live session should not be overwritten')
    expect((await service.getSnapshot(false)).archives).toHaveLength(1)

    await import('node:fs/promises').then(({ rm }) => rm(filePath))
    await service.restoreArchive(archive.id)
    const restoredSnapshot = await service.getSnapshot(true)
    expect(restoredSnapshot.archives).toHaveLength(0)
    expect(restoredSnapshot.sessions).toHaveLength(1)
    expect(restoredSnapshot.sessions[0].storageState).toBe('live')
    expect(await readFile(filePath, 'utf8')).toContain('rare migration needle')
  })
})
