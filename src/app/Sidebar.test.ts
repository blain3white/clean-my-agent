import { describe, expect, it } from 'vitest'
import { visibleSidebarAgents } from './sidebar-model'
import type { AgentInstallState, AgentSource, DashboardSnapshot } from '@/shared/types'

function agent(source: AgentSource, patch: Partial<AgentInstallState> = {}): AgentInstallState {
  return {
    source,
    name: source,
    installed: false,
    readable: false,
    rootPaths: [],
    sessionCount: 0,
    sizeBytes: 0,
    ...patch,
  }
}

function snapshot(agents: AgentInstallState[]): DashboardSnapshot {
  return { agents } as DashboardSnapshot
}

describe('visibleSidebarAgents', () => {
  it('keeps built-in agent sources even when they are empty', () => {
    expect(visibleSidebarAgents(snapshot([agent('codex')])).map((item) => item.source)).toEqual([
      'codex',
    ])
  })

  it('hides a custom source until it has configured or discovered data', () => {
    expect(visibleSidebarAgents(snapshot([agent('custom')]))).toEqual([])

    const visibleCustomStates = [
      agent('custom', { rootPaths: ['/tmp/custom'] }),
      agent('custom', { sessionCount: 1 }),
      agent('custom', { installed: true }),
      agent('custom', { readable: true }),
    ]

    visibleCustomStates.forEach((customAgent) => {
      expect(visibleSidebarAgents(snapshot([customAgent]))).toEqual([customAgent])
    })
  })
})
