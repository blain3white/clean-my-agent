import type { DashboardSnapshot } from '@/shared/types'

export function visibleSidebarAgents(snapshot: DashboardSnapshot): DashboardSnapshot['agents'] {
  return snapshot.agents.filter(
    (agent) =>
      agent.source !== 'custom' ||
      agent.rootPaths.length > 0 ||
      agent.sessionCount > 0 ||
      agent.installed ||
      agent.readable,
  )
}
