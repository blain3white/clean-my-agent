import {
  ArrowLeft,
  Archive,
  Bell,
  Circle,
  Code2,
  Database,
  Download,
  EyeOff,
  Filter,
  KeyRound,
  Lock,
  Palette,
  Radio,
  RefreshCcw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { navItems, type ViewId } from '@/app/navigation'
import type { DashboardSnapshot } from '@/shared/types'

const settingsNavItems: Array<{ label: string; icon: LucideIcon; active?: boolean }> = [
  { label: 'General', icon: Settings },
  { label: 'Providers', icon: Database, active: true },
  { label: 'Scan', icon: Search },
  { label: 'Filters & Rules', icon: Filter },
  { label: 'Cleanup', icon: Trash2 },
  { label: 'Safety', icon: Shield },
  { label: 'Backups', icon: Archive },
  { label: 'Vault', icon: Lock },
  { label: 'Export', icon: Download },
  { label: 'Relay', icon: Radio },
  { label: 'Privacy', icon: EyeOff },
  { label: 'Permissions', icon: KeyRound },
  { label: 'Appearance', icon: Palette },
  { label: 'Notifications', icon: Bell },
  { label: 'Updates', icon: RefreshCcw },
  { label: 'Advanced', icon: Code2 },
]

export function Sidebar({
  activeView,
  setActiveView,
  snapshot,
  onBackToApp,
}: {
  activeView: ViewId
  setActiveView: (view: ViewId) => void
  snapshot: DashboardSnapshot
  onBackToApp: () => void
}) {
  if (activeView === 'settings') {
    return (
      <aside className="sidebar-glass settings-sidebar-glass drag-region flex w-[340px] shrink-0 flex-col px-4 pb-4 pt-5">
        <div className="no-drag-region mb-6 pl-2 pt-10">
          <button
            type="button"
            onClick={onBackToApp}
            className="flex h-8 items-center gap-3 rounded-md px-1 text-sm text-white/66 transition hover:text-white"
          >
            <ArrowLeft className="size-4" />
            <span>Back to app</span>
          </button>
        </div>

        <div className="no-drag-region relative mb-5">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-white/48" />
          <input
            aria-label="Search settings"
            placeholder="Search settings"
            className="h-10 w-full rounded-lg border border-white/10 bg-white/[0.055] px-11 pr-11 text-sm text-white/80 outline-none transition placeholder:text-white/38 focus:border-white/18 focus:bg-white/[0.075]"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-white/35">
            ⌘F
          </span>
        </div>

        <nav className="no-drag-region no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto">
          {settingsNavItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                type="button"
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition ${
                  item.active
                    ? 'bg-white/12 text-white shadow-inner'
                    : 'text-white/70 hover:bg-white/7 hover:text-white'
                }`}
              >
                <Icon className="size-[18px]" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="no-drag-region mt-5 border-t border-white/9 pt-4">
          <div className="flex items-center gap-3 rounded-xl p-1.5">
            <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.06] text-white shadow-inner">
              <Sparkles className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium text-white/84">Clean My Agent</div>
              <div className="mt-1 text-sm text-white/44">Version 0.1.0</div>
            </div>
          </div>
        </div>
      </aside>
    )
  }

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
