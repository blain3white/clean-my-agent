import type { DashboardSnapshot } from '@/shared/types'
import type { TranslationKey } from '@/lib/i18n'
import type { ViewId } from './navigation'

export const sidebarUtilityItems: Array<{
  id: ViewId
  labelKey: TranslationKey
}> = [
  { id: 'health', labelKey: 'nav.health' },
  { id: 'relay', labelKey: 'nav.relay' },
]

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

export function agentHealthStatusKey(agent: DashboardSnapshot['agents'][number]): TranslationKey {
  if (agent.readable) return 'status.readable'
  if (agent.installed) return 'status.unreadable'
  return 'status.notFound'
}
