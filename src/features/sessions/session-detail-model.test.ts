import { describe, expect, it } from 'vitest'
import type { UniversalRelayDocument } from '@/shared/types'
import {
  buildSessionTimeline,
  countTimelineEvents,
  filterTimelineEvents,
} from './session-detail-model'

function makeDocument(): UniversalRelayDocument {
  return {
    schema: 'clean-my-agent.universal-session.v1',
    exportedAt: '2026-02-01T00:00:00.000Z',
    source: 'codex',
    session: {
      id: 'session-1',
      source: 'codex',
      title: 'Session',
      projectName: 'clean-my-agent',
      storagePath: '/tmp/session.jsonl',
      storageKind: 'file',
      storageState: 'live',
      lastUpdated: '2026-02-01T00:00:00.000Z',
      messageCount: 4,
      tokens: {
        input: 1,
        output: 2,
        cached: 0,
        total: 3,
        estimated: false,
      },
      sizeBytes: 100,
      backupStatus: 'pending',
      tags: [],
      metadata: {},
    },
    messages: [
      {
        id: 'user',
        role: 'user',
        text: 'Please inspect this session.',
      },
      {
        id: 'assistant',
        role: 'assistant',
        text: 'I will inspect the session detail.',
      },
      {
        id: 'reasoning',
        role: 'assistant',
        text: 'Reasoning summary: classify this as a thinking event.',
        raw: { type: 'reasoning' },
      },
      {
        id: 'tool',
        role: 'tool',
        text: 'Read file output',
        raw: { type: 'tool_call', toolName: 'read_file', status: 'completed' },
      },
      {
        id: 'command',
        role: 'tool',
        text: 'pnpm test',
        raw: { type: 'command', command: 'pnpm test', cwd: '/repo', status: 'success' },
      },
    ],
    files: [],
    commands: [{ command: 'pnpm lint', cwd: '/repo' }],
    attachments: [],
    warnings: [],
  }
}

describe('session detail model', () => {
  it('classifies relay messages into timeline event kinds', () => {
    const events = buildSessionTimeline(makeDocument())
    expect(events.map((event) => event.kind)).toEqual([
      'user',
      'assistant',
      'reasoning',
      'tool',
      'command',
      'command',
    ])
    expect(events.find((event) => event.kind === 'tool')?.title).toBe('read_file')
    expect(events.filter((event) => event.kind === 'command').map((event) => event.text)).toEqual([
      'pnpm test',
      'pnpm lint',
    ])
  })

  it('counts and filters timeline events for detail chips', () => {
    const events = buildSessionTimeline(makeDocument())
    const counts = countTimelineEvents(events)

    expect(counts.all).toBe(6)
    expect(counts.user).toBe(1)
    expect(counts.assistant).toBe(1)
    expect(counts.text).toBe(2)
    expect(counts.reasoning).toBe(1)
    expect(counts.tool).toBe(1)
    expect(counts.command).toBe(2)
    expect(filterTimelineEvents(events, 'text').map((event) => event.kind)).toEqual([
      'user',
      'assistant',
    ])
    expect(filterTimelineEvents(events, 'tool')).toHaveLength(1)
  })
})
