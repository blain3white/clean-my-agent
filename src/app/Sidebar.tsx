import { Circle, ShieldCheck } from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { navItems, type ViewId } from '@/app/navigation'
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
  return (
    <aside className="sidebar-glass drag-region flex w-[232px] shrink-0 flex-col px-4 pb-4 pt-5">
      <div className="mb-7 flex items-center gap-2 pl-2 pt-8">
        <img
          src="/app-logo.png"
          alt=""
          className="size-10 shrink-0 object-contain"
          draggable={false}
        />
        <div>
          <div className="text-sm font-medium text-white">Clean My Agent</div>
          <div className="text-[11px] text-white/40">Local session control</div>
        </div>
      </div>

      <nav className="space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = activeView === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition ${
                active
                  ? 'bg-white/11 text-white shadow-inner'
                  : 'text-white/66 hover:bg-white/7 hover:text-white'
              }`}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-8 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-white/35">
        <span>Sources</span>
        <Circle className="size-3 fill-emerald-300/70 text-emerald-300/70" />
      </div>
      <div className="mt-3 space-y-2">
        {snapshot.agents.map((agent) => (
          <div
            key={agent.source}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-white/70"
          >
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-white/82">{agent.name}</div>
              <div className="text-[11px] text-white/38">
                {agent.sessionCount} sessions · {agent.readable ? 'Readable' : 'Not found'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto rounded-lg border border-white/8 bg-black/18 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-white/80">
          <ShieldCheck className="size-4 text-emerald-300" />
          Safe by default
        </div>
        <p className="mt-2 text-[11px] leading-4 text-white/42">
          Cleanup moves files to app Trash. Session candidates are backed up first.
        </p>
      </div>
    </aside>
  )
}
