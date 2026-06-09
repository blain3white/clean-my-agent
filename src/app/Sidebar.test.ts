import { describe, expect, it } from 'vitest'
import { navItems } from './navigation'
import { agentHealthStatusKey, sidebarUtilityItems, visibleSidebarAgents } from './sidebar-model'
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

describe('sidebarUtilityItems', () => {
  it('exposes hidden health and relay views outside the primary nav list', () => {
    const primaryNavIds = navItems.filter((item) => !item.hiddenInSidebar).map((item) => item.id)

    expect(primaryNavIds).not.toContain('health')
    expect(primaryNavIds).not.toContain('relay')
    expect(sidebarUtilityItems.map((item) => item.id)).toEqual(['health', 'relay'])
  })
})

describe('agentHealthStatusKey', () => {
  it('distinguishes missing, installed-unreadable, and readable agents', () => {
    expect(agentHealthStatusKey(agent('codex'))).toBe('status.notFound')
    expect(agentHealthStatusKey(agent('codex', { installed: true }))).toBe('status.unreadable')
    expect(agentHealthStatusKey(agent('codex', { installed: true, readable: true }))).toBe(
      'status.readable',
    )
  })
})
