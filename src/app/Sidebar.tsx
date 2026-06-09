import { Circle, ShieldCheck } from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { navItems, type ViewId } from '@/app/navigation'
import {
  agentHealthStatusKey,
  sidebarUtilityItems,
  visibleSidebarAgents,
} from '@/app/sidebar-model'
import { useI18n } from '@/lib/i18n-context'
import type { DashboardSnapshot } from '@/shared/types'

export function Sidebar({
  activeView,
  setActiveView,
  snapshot,
}: {
  activeView: ViewId
  setActiveView: (view: ViewId) => void
  snapshot: DashboardSnapshot
}) {
  const { t } = useI18n()
  const visibleAgents = visibleSidebarAgents(snapshot)

  return (
    <aside className="sidebar-glass drag-region flex w-full shrink-0 flex-col px-3 py-2 md:w-[232px] md:px-4 md:pb-4 md:pt-5">
      <div className="mb-2 flex shrink-0 items-center gap-2 pl-1 md:mb-7 md:pl-2 md:pt-8">
        <img
          src="/app-logo.png"
          alt=""
          className="size-8 shrink-0 object-contain md:size-10"
          draggable={false}
        />
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">Clean My Agent</div>
          <div className="truncate text-[11px] text-white/40">{t('app.tagline')}</div>
        </div>
      </div>

      <nav className="flex min-w-0 gap-1 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
        {navItems
          .filter((item) => !item.hiddenInSidebar)
          .map((item) => {
            const Icon = item.icon
            const active = activeView === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-[13px] transition md:w-full ${
                  active
                    ? 'bg-white/11 text-white shadow-inner'
                    : 'text-white/66 hover:bg-white/7 hover:text-white'
                }`}
              >
                <Icon className="size-4" />
                <span>{t(item.labelKey)}</span>
              </button>
            )
          })}
      </nav>

      <div className="mt-8 hidden items-center justify-between px-2 text-[11px] uppercase tracking-wide text-white/35 md:flex">
        <span>{t('sidebar.sources')}</span>
        <Circle className="size-3 fill-emerald-300/70 text-emerald-300/70" />
      </div>
      <div className="mt-3 hidden space-y-2 md:block">
        {visibleAgents.map((agent) => (
          <div
            key={agent.source}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-white/70"
          >
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white/82">{agent.name}</div>
              <div className="text-[11px] text-white/38">
                {agent.sessionCount} {t('unit.sessions')} · {t(agentHealthStatusKey(agent))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 space-y-3 md:mt-auto">
        <div className="grid grid-cols-2 gap-2">
          {sidebarUtilityItems.map((item) => {
            const navItem = navItems.find((nav) => nav.id === item.id)
            if (!navItem) return null

            const Icon = navItem.icon
            const active = activeView === item.id

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveView(item.id)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] transition ${
                  active
                    ? 'border-white/14 bg-white/11 text-white'
                    : 'border-white/8 bg-black/12 text-white/55 hover:bg-white/7 hover:text-white'
                }`}
              >
                <Icon className="size-3.5" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            )
          })}
        </div>
        <div className="hidden rounded-lg border border-white/8 bg-black/18 p-3 md:block">
          <div className="flex items-center gap-2 text-xs font-medium text-white/80">
            <ShieldCheck className="size-4 text-emerald-300" />
            {t('sidebar.safeTitle')}
          </div>
          <p className="mt-2 text-[11px] leading-4 text-white/42">{t('sidebar.safeBody')}</p>
        </div>
      </div>
    </aside>
  )
}
