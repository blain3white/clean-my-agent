import { describe, expect, it, vi } from 'vitest'
import type { CleanMyAgentApi, UniversalRelayDocument } from '@/shared/types'
import { hasSessionDetailApi, loadSessionDetail } from './session-detail-api'

function makeDocument(sessionId: string): UniversalRelayDocument {
  return {
    schema: 'clean-my-agent.universal-session.v1',
    exportedAt: '2026-06-08T00:00:00.000Z',
    source: 'codex',
    session: {
      id: sessionId,
      source: 'codex',
      title: 'Session detail',
      projectName: 'clean-my-agent',
      storagePath: '/tmp/session.jsonl',
      storageKind: 'file',
      storageState: 'live',
      lastUpdated: '2026-06-08T00:00:00.000Z',
      messageCount: 1,
      tokens: { input: 1, output: 1, cached: 0, total: 2, estimated: false },
      sizeBytes: 128,
      backupStatus: 'pending',
      tags: [],
      metadata: {},
    },
    messages: [],
    files: [],
    commands: [],
    attachments: [],
    warnings: [],
  }
}

describe('session detail API loader', () => {
  it('detects whether the desktop preload exposes session detail', () => {
    expect(hasSessionDetailApi(undefined)).toBe(false)
    expect(hasSessionDetailApi({})).toBe(false)
    expect(hasSessionDetailApi({ getSessionDetail: vi.fn() } as Partial<CleanMyAgentApi>)).toBe(
      true,
    )
  })

  it('uses demo session detail when mock data is enabled', async () => {
    const api = { getSessionDetail: vi.fn() } as Partial<CleanMyAgentApi>
    const detail = await loadSessionDetail(api, 'demo-codex-1', 'en', true)

    expect(detail.session.id).toBe('demo-codex-1')
    expect(api.getSessionDetail).not.toHaveBeenCalled()
  })

  it('throws a localized upgrade hint for older preload objects', async () => {
    await expect(loadSessionDetail({}, 'session-1', 'zh-CN', false)).rejects.toThrow(
      '会话详情需要刷新桌面窗口后使用，请重新加载或重启应用。',
    )
  })

  it('delegates to the desktop API when available', async () => {
    const detail = makeDocument('session-1')
    const getSessionDetail = vi.fn().mockResolvedValue(detail)
    const result = await loadSessionDetail(
      { getSessionDetail } as Partial<CleanMyAgentApi>,
      'session-1',
      'en',
      false,
    )

    expect(result).toBe(detail)
    expect(getSessionDetail).toHaveBeenCalledWith('session-1')
  })
})
