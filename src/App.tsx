import { useMemo, useState } from 'react'
import CodexIcon from '@lobehub/icons/es/Codex'
import ClaudeCodeIcon from '@lobehub/icons/es/ClaudeCode'
import CursorIcon from '@lobehub/icons/es/Cursor'
import GeminiIcon from '@lobehub/icons/es/Gemini'
import OpenCodeIcon from '@lobehub/icons/es/OpenCode'
import {
  Activity,
  Archive,
  ArrowRightLeft,
  BarChart3,
  Bot,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  Download,
  FileJson2,
  Gauge,
  HardDrive,
  HeartPulse,
  LayoutDashboard,
  ListFilter,
  Loader2,
  MoreHorizontal,
  Moon,
  Pin,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Toaster } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useDashboard } from '@/hooks/use-dashboard'
import { useTheme } from '@/hooks/use-theme'
import { agentLabel, estimatedCost, formatBytes, formatRelative, formatTokens, riskAccent } from '@/lib/format'
import type { AgentSource, CleanupCandidate, DashboardSnapshot, SessionRecord } from '@/shared/types'
import './App.css'

type ViewId = 'overview' | 'sessions' | 'cleanup' | 'usage' | 'relay' | 'health' | 'settings'

const navItems: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: Database },
  { id: 'cleanup', label: 'Cleanup', icon: Trash2 },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'relay', label: 'Relay JSON', icon: ArrowRightLeft },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const sourceColors: Record<AgentSource, string> = {
  codex: '#54d18b',
  claude: '#ff9b54',
  cursor: '#d3d7df',
  gemini: '#63c7ff',
  opencode: '#a78bfa',
}

function AgentGlyph({ source }: { source: AgentSource }) {
  const iconProps = { size: 16 }
  const icon = {
    codex: <CodexIcon {...iconProps} />,
    claude: <ClaudeCodeIcon {...iconProps} />,
    cursor: <CursorIcon {...iconProps} />,
    gemini: <GeminiIcon {...iconProps} />,
    opencode: <OpenCodeIcon {...iconProps} />,
  }[source]

  return (
    <span className="agent-logo grid size-8 place-items-center" style={{ color: sourceColors[source] }}>
      {icon ?? <Bot className="size-4" />}
    </span>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: string
}) {
  return (
    <Card className="metric-card rounded-lg py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <div className={`grid size-10 place-items-center rounded-lg ${accent}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-white/55">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-normal text-white">{value}</div>
          <div className="mt-0.5 truncate text-xs text-white/45">{detail}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Sidebar({
  activeView,
  setActiveView,
  snapshot,
}: {
  activeView: ViewId
  setActiveView: (view: ViewId) => void
  snapshot: DashboardSnapshot
}) {
  return (
    <aside className="sidebar-glass drag-region flex w-[280px] shrink-0 flex-col px-5 pb-5 pt-5">
      <div className="mb-7 flex h-5 items-center gap-2">
        <span className="size-3.5 rounded-full bg-[#ff5f57] shadow-[0_0_10px_rgb(255_95_87_/_35%)]" />
        <span className="size-3.5 rounded-full bg-[#ffbd2e] shadow-[0_0_10px_rgb(255_189_46_/_30%)]" />
        <span className="size-3.5 rounded-full bg-[#28c840] shadow-[0_0_10px_rgb(40_200_64_/_30%)]" />
      </div>

      <div className="mb-9 flex items-center gap-2.5 pl-2">
        <div className="grid size-10 place-items-center rounded-lg bg-emerald-400/14 text-emerald-300 ring-1 ring-emerald-400/24 shadow-[inset_0_1px_0_rgb(255_255_255_/_12%)]">
          <Sparkles className="size-4" />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-white">Clean My Agent</div>
          <div className="text-[12px] text-white/45">Local session control</div>
        </div>
      </div>

      <nav className="space-y-1.5">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = activeView === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition ${
                active ? 'bg-white/14 text-white shadow-inner' : 'text-white/68 hover:bg-white/7 hover:text-white'
              }`}
            >
              <Icon className="size-[18px]" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-9 flex items-center justify-between px-2 text-[12px] uppercase tracking-wide text-white/38">
        <span>Sources</span>
        <Circle className="size-3 fill-emerald-300/75 text-emerald-300/75" />
      </div>
      <div className="mt-3 space-y-2">
        {snapshot.agents.map((agent) => (
          <div key={agent.source} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-white/70">
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white/86">{agent.name}</div>
              <div className="text-[12px] text-white/48">
                {agent.sessionCount} sessions · {agent.readable ? 'Readable' : 'Not found'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto rounded-lg border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_6%)]">
        <div className="flex items-center gap-2 text-sm font-medium text-white/88">
          <ShieldCheck className="size-4 text-emerald-300" />
          Safe by default
        </div>
        <p className="mt-2 text-[13px] leading-5 text-white/52">Cleanup moves files to app Trash. Session candidates are backed up first.</p>
      </div>
    </aside>
  )
}

function Topbar({
  activeView,
  loading,
  usingMockData,
  resolvedTheme,
  onThemeToggle,
  onRescan,
}: {
  activeView: ViewId
  loading: boolean
  usingMockData: boolean
  resolvedTheme: 'light' | 'dark'
  onThemeToggle: () => void
  onRescan: () => Promise<void>
}) {
  const title = navItems.find((item) => item.id === activeView)?.label ?? 'Overview'
  const ThemeIcon = resolvedTheme === 'dark' ? Sun : Moon
  const nextThemeLabel = resolvedTheme === 'dark' ? 'light' : 'dark'
  const subtitle =
    activeView === 'cleanup'
      ? 'Review and remove safe, backed up, or redundant session data.'
      : usingMockData
        ? 'Previewing demo data in renderer mode'
        : 'Local-first scan of your AI coding sessions'

  if (activeView !== 'cleanup') {
    return (
      <header className="drag-region flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-7">
        <div>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          <p className="mt-0.5 text-xs text-white/42">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={onThemeToggle}
                aria-label={`Switch to ${nextThemeLabel} mode`}
                className="theme-toggle border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <ThemeIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Switch to {nextThemeLabel} mode</TooltipContent>
          </Tooltip>
          <Badge variant="outline" className="border-white/10 bg-white/5 text-white/55">
            {usingMockData ? 'Demo' : 'Desktop'}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" onClick={() => void onRescan()} disabled={loading} className="border-white/10 bg-white/5 text-white hover:bg-white/10">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rescan local agent data</TooltipContent>
          </Tooltip>
        </div>
      </header>
    )
  }

  return (
    <header className="drag-region flex h-[128px] shrink-0 items-start justify-between px-12 pt-11">
      <div>
        <h1 className="text-[38px] font-semibold leading-none tracking-normal text-white">{title}</h1>
        <p className="mt-3 text-[16px] text-white/58">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-sm font-normal text-white/68">
          {usingMockData ? 'Demo' : 'Desktop'}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-lg" onClick={() => void onRescan()} disabled={loading} aria-label="Rescan local agent data" className="rounded-lg border-white/12 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rescan local agent data</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-lg" aria-label="More actions" className="rounded-lg border-white/12 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white">
              <MoreHorizontal className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>More actions</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function OverviewView({ snapshot, onSelectCleanup }: { snapshot: DashboardSnapshot; onSelectCleanup: () => void }) {
  const recentSessions = snapshot.sessions.slice(0, 6)
  const pieData = snapshot.storage.map((slice) => ({
    name: slice.label,
    value: slice.sizeBytes,
    source: slice.source,
  }))

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-4 gap-3">
        <MetricCard icon={Database} label="Total Sessions" value={snapshot.overview.totalSessions.toLocaleString()} detail={`${snapshot.agents.length} agent adapters`} accent="bg-emerald-400/12 text-emerald-300" />
        <MetricCard icon={Archive} label="Backed Up" value={snapshot.overview.backedUpSessions.toLocaleString()} detail={`${Math.round((snapshot.overview.backedUpSessions / Math.max(snapshot.overview.totalSessions, 1)) * 100)}% of total`} accent="bg-blue-400/12 text-blue-300" />
        <MetricCard icon={HardDrive} label="Reclaimable" value={formatBytes(snapshot.overview.reclaimableBytes)} detail={`${snapshot.cleanup.length} cleanup suggestions`} accent="bg-amber-400/12 text-amber-300" />
        <MetricCard icon={Gauge} label="Token Usage" value={formatTokens(snapshot.overview.totalTokens)} detail={`Estimated cost ${estimatedCost(snapshot.overview.totalTokens)}`} accent="bg-violet-400/12 text-violet-300" />
      </section>

      <section className="grid grid-cols-[1fr_400px] gap-4">
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-white">Token Activity</CardTitle>
              <Badge variant="outline" className="border-white/10 text-white/50">30 days</Badge>
            </div>
          </CardHeader>
          <CardContent className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapshot.usage}>
                <defs>
                  <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#63a6ff" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#63a6ff" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,.38)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={18} tickFormatter={(value) => String(value).slice(5)} />
                <YAxis tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
                <ChartTooltip contentStyle={{ background: '#18191b', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }} formatter={(value) => formatTokens(Number(value))} />
                <Area type="monotone" dataKey="total" stroke="#63a6ff" strokeWidth={2} fill="url(#tokenGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm text-white">Storage Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="grid h-[230px] grid-cols-[150px_1fr] items-center gap-3">
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={pieData} innerRadius={44} outerRadius={72} paddingAngle={2} dataKey="value">
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={sourceColors[entry.source as AgentSource] ?? '#8b95a5'} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {snapshot.storage.slice(0, 5).map((slice) => (
                <div key={`${slice.source}-${slice.label}`} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: sourceColors[slice.source as AgentSource] ?? '#8b95a5' }} />
                    <span className="truncate text-white/70">{slice.label}</span>
                  </div>
                  <span className="text-white/48">{formatBytes(slice.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-[1fr_400px] gap-4">
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="flex-row items-center justify-between pb-0">
            <CardTitle className="text-sm text-white">Recent Sessions</CardTitle>
            <Button variant="ghost" size="sm" className="text-blue-300 hover:bg-blue-400/10 hover:text-blue-200">View all</Button>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-white/7">
              {recentSessions.map((session) => (
                <div key={session.id} className="grid grid-cols-[28px_1fr_120px_80px_80px] items-center gap-3 py-2.5 text-xs">
                  <AgentGlyph source={session.source} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white/82">{session.title}</div>
                    <div className="truncate text-white/38">{session.projectName}</div>
                  </div>
                  <span className="truncate text-white/42">{session.branch ?? 'Unknown'}</span>
                  <span className="text-white/42">{formatRelative(session.lastUpdated)}</span>
                  <span className="text-right text-white/50">{formatBytes(session.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="flex-row items-center justify-between pb-0">
            <CardTitle className="text-sm text-white">Smart Cleanup</CardTitle>
            <Button variant="ghost" size="sm" onClick={onSelectCleanup} className="text-blue-300 hover:bg-blue-400/10 hover:text-blue-200">Review</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {snapshot.cleanup.slice(0, 4).map((candidate) => (
                <CleanupMiniRow key={candidate.id} candidate={candidate} />
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function CleanupMiniRow({ candidate }: { candidate: CleanupCandidate }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-white/7 bg-white/[0.03] p-3">
      <div className={`grid size-8 place-items-center rounded-md ring-1 ${riskAccent[candidate.risk]}`}>
        <Trash2 className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-white/82">{candidate.title}</div>
        <div className="truncate text-[11px] text-white/38">{candidate.reason}</div>
      </div>
      <div className="text-right text-xs font-semibold text-amber-300">{formatBytes(candidate.sizeBytes)}</div>
    </div>
  )
}

function SessionsView({
  sessions,
  onBackup,
  onExport,
  onRelay,
}: {
  sessions: SessionRecord[]
  onBackup: (sessionId: string) => Promise<void>
  onExport: (sessionId: string) => Promise<void>
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState<'all' | AgentSource>('all')
  const filtered = sessions.filter((session) => {
    const haystack = `${session.title} ${session.projectName} ${session.branch ?? ''} ${agentLabel[session.source]}`.toLowerCase()
    return haystack.includes(query.toLowerCase()) && (agent === 'all' || session.source === agent)
  })

  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm text-white">Unified Sessions</CardTitle>
            <p className="mt-1 text-xs text-white/42">Codex, Claude Code, Cursor, Gemini, and OpenCode sessions in one index.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/35" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions..." className="h-8 w-64 border-white/10 bg-white/5 pl-8 text-white placeholder:text-white/30" />
            </div>
            <select value={agent} onChange={(event) => setAgent(event.target.value as 'all' | AgentSource)} className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none">
              <option value="all">All Agents</option>
              {Object.entries(agentLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border border-white/8">
          <Table>
            <TableHeader className="bg-white/[0.03]">
              <TableRow className="border-white/8 hover:bg-transparent">
                <TableHead className="text-white/45">Agent</TableHead>
                <TableHead className="text-white/45">Session</TableHead>
                <TableHead className="text-white/45">Project</TableHead>
                <TableHead className="text-white/45">Branch</TableHead>
                <TableHead className="text-white/45">Updated</TableHead>
                <TableHead className="text-right text-white/45">Tokens</TableHead>
                <TableHead className="text-right text-white/45">Size</TableHead>
                <TableHead className="text-white/45">Backup</TableHead>
                <TableHead className="text-right text-white/45">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 80).map((session) => (
                <TableRow key={session.id} className="border-white/7 hover:bg-white/[0.035]">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <AgentGlyph source={session.source} />
                      <span className="text-xs text-white/70">{agentLabel[session.source]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate font-medium text-white/82">{session.title}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-white/55">{session.projectName}</TableCell>
                  <TableCell className="max-w-[160px] truncate text-white/45">{session.branch ?? 'Unknown'}</TableCell>
                  <TableCell className="text-white/45">{formatRelative(session.lastUpdated)}</TableCell>
                  <TableCell className="text-right text-white/60">{formatTokens(session.tokens.total)}</TableCell>
                  <TableCell className="text-right text-white/60">{formatBytes(session.sizeBytes)}</TableCell>
                  <TableCell>
                    {session.backupStatus === 'backed-up' ? (
                      <Badge className="bg-emerald-400/10 text-emerald-300"><CheckCircle2 className="size-3" />Backed Up</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400/20 bg-amber-400/10 text-amber-300">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => void onBackup(session.id)} className="text-white/55 hover:bg-white/10 hover:text-white"><Archive className="size-3.5" /></Button></TooltipTrigger>
                        <TooltipContent>Backup session</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => void onExport(session.id)} className="text-white/55 hover:bg-white/10 hover:text-white"><Download className="size-3.5" /></Button></TooltipTrigger>
                        <TooltipContent>Export Markdown</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" onClick={() => void onRelay(session.id)} className="text-white/55 hover:bg-white/10 hover:text-white"><FileJson2 className="size-3.5" /></Button></TooltipTrigger>
                        <TooltipContent>Export universal relay JSON</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function CleanupView({
  cleanup,
  onMoveToTrash,
}: {
  cleanup: CleanupCandidate[]
  onMoveToTrash: (candidateIds: string[]) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>(cleanup.slice(0, 3).map((item) => item.id))
  const selectedBytes = cleanup.filter((item) => selected.includes(item.id)).reduce((total, item) => total + item.sizeBytes, 0)
  const selectedItems = cleanup.filter((item) => selected.includes(item.id))
  const accentByKind: Record<CleanupCandidate['kind'], string> = {
    'old-session': 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/28',
    'backed-up-session': 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/28',
    'large-log': 'text-amber-300 bg-amber-400/13 ring-amber-400/28',
    'duplicate-backup': 'text-blue-300 bg-blue-400/13 ring-blue-400/28',
    'temp-file': 'text-sky-300 bg-sky-400/13 ring-sky-400/28',
    'orphan-session': 'text-violet-300 bg-violet-400/13 ring-violet-400/28',
    'invalid-cache': 'text-red-300 bg-red-400/13 ring-red-400/28',
  }
  const selectedColor = (index: number) => ['bg-emerald-300', 'bg-amber-300', 'bg-blue-300', 'bg-violet-300', 'bg-sky-300'][index % 5]

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_334px] gap-6 max-[1120px]:grid-cols-1">
      <Card className="glass-panel overflow-hidden rounded-lg py-0">
        <CardHeader className="flex-row items-center justify-between gap-3 px-8 pb-0 pt-8">
          <div>
            <CardTitle className="text-[20px] font-semibold text-white">Cleanup Suggestions</CardTitle>
            <p className="mt-3 text-[15px] text-white/60">Review each suggestion. Items are backed up first and can be recovered.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" className="h-9 rounded-lg border-white/12 bg-white/5 px-3 text-[15px] font-normal text-white/82 hover:bg-white/10">
              <ListFilter className="size-4" />
              Filter
            </Button>
            <select className="h-9 rounded-lg border border-white/12 bg-white/5 px-3 text-[15px] text-white/82 outline-none">
              <option>Sort: Size</option>
              <option>Sort: Risk</option>
              <option>Sort: Agent</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-0 pt-7">
          <div className="space-y-3">
            {cleanup.map((candidate) => {
              const checked = selected.includes(candidate.id)
              return (
                <div
                  key={candidate.id}
                  className={`cleanup-row group grid min-h-[145px] grid-cols-[28px_58px_minmax(0,1fr)_104px] items-center gap-4 rounded-lg border px-4 py-5 text-left transition max-[1280px]:grid-cols-[24px_58px_minmax(0,1fr)] max-[1280px]:items-start ${
                    checked ? 'border-white/12 bg-white/[0.055]' : 'border-white/9 bg-white/[0.03] hover:bg-white/[0.05]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelected((current) => checked ? current.filter((id) => id !== candidate.id) : [...current, candidate.id])}
                    aria-label={`${checked ? 'Deselect' : 'Select'} ${candidate.title}`}
                    className={`grid size-6 place-items-center rounded-md border transition ${
                      checked ? 'border-white/22 bg-white/10 text-white' : 'border-white/16 bg-black/12 text-transparent group-hover:text-white/45'
                    }`}
                  >
                    <CheckCircle2 className="size-4" />
                  </button>
                  <div className={`grid size-[58px] place-items-center rounded-lg ring-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_10%)] ${accentByKind[candidate.kind]}`}>
                    {candidate.kind === 'duplicate-backup' ? (
                      <Archive className="size-7" />
                    ) : checked ? (
                      <CheckCircle2 className="size-7" />
                    ) : (
                      <Trash2 className="size-7" />
                    )}
                  </div>
                  <div className="min-w-0 max-[1280px]:pr-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                      <div className="min-w-0 truncate text-[18px] font-semibold text-white">{candidate.title}</div>
                      <Badge variant="outline" className={`h-6 rounded-full px-3 text-xs capitalize ring-1 ${riskAccent[candidate.risk]}`}>{candidate.risk} risk</Badge>
                      {candidate.backedUp && <Badge className="h-6 rounded-full bg-emerald-400/10 px-3 text-xs text-emerald-300 ring-1 ring-emerald-400/20">Backed up</Badge>}
                    </div>
                    <p className="mt-2 text-[15px] leading-6 text-white/58">{candidate.reason}</p>
                    <div className="mt-4 flex flex-wrap gap-3 text-[13px] text-white/42">
                      <span>{candidate.paths.length} path{candidate.paths.length === 1 ? '' : 's'}</span>
                      <span>·</span>
                      <span>{candidate.recoverable ? 'Recoverable from Trash' : 'Permanent'}</span>
                      {candidate.source && <><span>·</span><span>{agentLabel[candidate.source]}</span></>}
                    </div>
                  </div>
                  <div className="text-right max-[1280px]:col-start-3 max-[1280px]:text-left">
                    <div className={`text-[22px] font-semibold ${candidate.kind === 'duplicate-backup' ? 'text-blue-300' : candidate.risk === 'medium' ? 'text-amber-300' : 'text-emerald-300'}`}>{formatBytes(candidate.sizeBytes)}</div>
                    <div className="mt-2 text-[13px] text-white/48">{candidate.kind.replaceAll('-', ' ')}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-white/8 px-1 py-7">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 size-5 text-emerald-300" />
              <div>
                <div className="text-[16px] font-medium text-white">{selected.length} suggestions selected</div>
                <div className="mt-1 text-sm text-white/52">{formatBytes(selectedBytes)} reclaimable</div>
              </div>
            </div>
            <Button variant="outline" size="lg" onClick={() => setSelected([])} disabled={selected.length === 0} className="h-9 rounded-lg border-white/12 bg-white/5 px-4 text-[15px] font-normal text-white/72 hover:bg-white/10 hover:text-white">
              Deselect all
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-panel sticky top-6 h-fit rounded-lg py-0">
        <CardHeader className="flex-row items-center justify-between px-7 pb-0 pt-8">
          <CardTitle className="text-[20px] font-semibold text-white">Clean Queue</CardTitle>
          <Pin className="size-5 text-white/82" />
        </CardHeader>
        <CardContent className="px-7 pb-6 pt-7">
          <div>
            <div className="flex items-end gap-2 text-white">
              <span className="text-[46px] font-semibold leading-none">{formatBytes(selectedBytes).split(' ')[0]}</span>
              <span className="pb-1 text-[25px] font-semibold">{formatBytes(selectedBytes).split(' ')[1] ?? ''}</span>
            </div>
            <div className="mt-3 text-[15px] text-white/58">{selected.length} items selected</div>
          </div>
          <Separator className="my-7 bg-white/10" />
          <div className="space-y-5 text-[15px] text-white/62">
            <div className="flex items-center gap-3"><ShieldCheck className="size-5 text-emerald-300" />Backed up before removal</div>
            <div className="flex items-center gap-3"><Trash2 className="size-5 text-blue-300" />Moved to app Trash</div>
            <div className="flex items-center gap-3"><Clock className="size-5 text-amber-300" />Trash retention is configurable</div>
            <div className="flex items-center gap-3"><RefreshCcw className="size-5 text-violet-300" />Easily recoverable</div>
          </div>
          <Separator className="my-7 bg-white/10" />
          <div>
            <div className="text-[15px] font-medium text-white">Selected items</div>
            <div className="mt-4 space-y-3">
              {selectedItems.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2 text-[14px]">
                  <span className={`size-2.5 rounded-full ${selectedColor(index)}`} />
                  <span className="min-w-0 flex-1 truncate text-white/58">{item.kind.replaceAll('-', ' ')}</span>
                  <span className="text-white/58">{formatBytes(item.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </div>
          <Separator className="my-7 bg-white/10" />
          <div className="flex items-center justify-between text-[16px]">
            <span className="text-white">Total reclaimable</span>
            <span className="font-semibold text-white">{formatBytes(selectedBytes)}</span>
          </div>
          <Button onClick={() => void onMoveToTrash(selected)} disabled={selected.length === 0} className="mt-6 h-11 w-full rounded-lg bg-blue-500 text-[16px] font-semibold text-white shadow-[0_10px_24px_rgb(37_99_235_/_28%)] hover:bg-blue-400">
            <Trash2 className="size-5" />
            Move to Trash
          </Button>
          <p className="mt-3 text-center text-[13px] text-white/45">Files will be moved to app Trash</p>
        </CardContent>
      </Card>
    </div>
  )
}

function UsageView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const projectRows = Object.values(
    snapshot.sessions.reduce<Record<string, { project: string; tokens: number; sessions: number }>>((acc, session) => {
      acc[session.projectName] ??= { project: session.projectName, tokens: 0, sessions: 0 }
      acc[session.projectName].tokens += session.tokens.total
      acc[session.projectName].sessions += 1
      return acc
    }, {}),
  ).sort((a, b) => b.tokens - a.tokens)

  const agentRows = snapshot.agents.map((agent) => ({
    agent: agent.name,
    source: agent.source,
    tokens: snapshot.sessions.filter((session) => session.source === agent.source).reduce((total, session) => total + session.tokens.total, 0),
  }))

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Agent Token Comparison</CardTitle>
        </CardHeader>
        <CardContent className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={snapshot.usage.slice(-14)}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,.38)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => String(value).slice(5)} />
              <YAxis tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => formatTokens(Number(value))} />
              <ChartTooltip contentStyle={{ background: '#18191b', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }} formatter={(value) => formatTokens(Number(value))} />
              <Bar dataKey="codex" stackId="a" fill={sourceColors.codex} radius={[0, 0, 0, 0]} />
              <Bar dataKey="claude" stackId="a" fill={sourceColors.claude} />
              <Bar dataKey="cursor" stackId="a" fill={sourceColors.cursor} />
              <Bar dataKey="gemini" stackId="a" fill={sourceColors.gemini} />
              <Bar dataKey="opencode" stackId="a" fill={sourceColors.opencode} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0"><CardTitle className="text-sm text-white">By Agent</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {agentRows.map((row) => (
              <div key={row.source}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-white/70">{row.agent}</span>
                  <span className="text-white/45">{formatTokens(row.tokens)}</span>
                </div>
                <Progress value={(row.tokens / Math.max(snapshot.overview.totalTokens, 1)) * 100} className="h-1.5 bg-white/8" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="glass-panel rounded-lg py-4">
          <CardHeader className="pb-0"><CardTitle className="text-sm text-white">Top Projects</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {projectRows.slice(0, 7).map((row, index) => (
              <div key={row.project} className="flex items-center gap-3 text-xs">
                <span className="grid size-5 place-items-center rounded bg-white/7 text-white/42">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate text-white/70">{row.project}</span>
                <span className="text-white/45">{formatTokens(row.tokens)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function RelayView({
  sessions,
  onRelay,
}: {
  sessions: SessionRecord[]
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [selected, setSelected] = useState(sessions[0]?.id ?? '')
  const session = sessions.find((item) => item.id === selected)

  return (
    <div className="grid grid-cols-[1fr_360px] gap-4">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Universal Relay JSON</CardTitle>
          <p className="mt-1 text-xs text-white/42">V0 extracts chats into a common schema. Agent-specific converters can target Codex, Claude Code, Cursor, Gemini, or OpenCode later.</p>
        </CardHeader>
        <CardContent>
          <pre className="overflow-hidden rounded-lg border border-white/8 bg-black/25 p-4 text-xs leading-5 text-white/58">
{`{
  "schema": "clean-my-agent.universal-session.v1",
  "source": "${session?.source ?? 'codex'}",
  "session": {
    "title": "${session?.title ?? 'Select a session'}",
    "projectPath": "${session?.projectPath ?? ''}",
    "branch": "${session?.branch ?? ''}"
  },
  "messages": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ],
  "files": [],
  "commands": [],
  "git": { "diff": null },
  "attachments": []
}`}
          </pre>
        </CardContent>
      </Card>

      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0"><CardTitle className="text-sm text-white">Export Source</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none">
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>{agentLabel[item.source]} · {item.title}</option>
            ))}
          </select>
          {session && (
            <div className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2"><AgentGlyph source={session.source} /><span className="text-sm font-medium text-white/82">{session.title}</span></div>
              <div className="mt-3 space-y-1 text-xs text-white/42">
                <div>{session.projectName}</div>
                <div>{session.messageCount} messages · {formatTokens(session.tokens.total)} tokens</div>
              </div>
            </div>
          )}
          <Button disabled={!session} onClick={() => session && void onRelay(session.id)} className="w-full bg-blue-500 text-white hover:bg-blue-400">
            <FileJson2 className="size-4" />
            Export Universal JSON
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function HealthView({ snapshot }: { snapshot: DashboardSnapshot }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {snapshot.agents.map((agent) => (
        <Card key={agent.source} className="glass-panel rounded-lg py-4">
          <CardContent className="flex items-start gap-3">
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="font-medium text-white">{agent.name}</div>
                <Badge className={agent.readable ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}>{agent.readable ? 'Readable' : 'Not found'}</Badge>
              </div>
              <div className="mt-2 text-xs text-white/42">{agent.sessionCount} sessions · {formatBytes(agent.sizeBytes)}</div>
              <div className="mt-3 space-y-1">
                {agent.rootPaths.map((root) => (
                  <div key={root} className="truncate rounded border border-white/7 bg-white/[0.03] px-2 py-1 text-[11px] text-white/38">{root}</div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function SettingsView() {
  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm text-white">Settings Scope</CardTitle>
        <p className="mt-1 text-xs text-white/42">The backend already exposes settings for scan roots, cleanup retention, trash retention, auto backup, relay mode, and export directory.</p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {[
          ['Scan directories', 'Configure per-agent roots for Codex, Claude Code, Cursor, Gemini, and OpenCode.'],
          ['Trash retention', 'Keep deleted files recoverable before permanent cleanup.'],
          ['Backup defaults', 'Create raw-copy backups before risky cleanup actions.'],
          ['Relay mode', 'Universal JSON first, target-agent converters later.'],
        ].map(([title, body]) => (
          <div key={title} className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
            <div className="text-sm font-medium text-white/82">{title}</div>
            <div className="mt-2 text-xs leading-5 text-white/42">{body}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function App() {
  const [activeView, setActiveView] = useState<ViewId>('overview')
  const dashboard = useDashboard()
  const theme = useTheme()

  const content = useMemo(() => {
    switch (activeView) {
      case 'overview':
        return <OverviewView snapshot={dashboard.snapshot} onSelectCleanup={() => setActiveView('cleanup')} />
      case 'sessions':
        return <SessionsView sessions={dashboard.snapshot.sessions} onBackup={dashboard.backupSession} onExport={(id) => dashboard.exportSession(id, 'markdown')} onRelay={dashboard.exportUniversalRelay} />
      case 'cleanup':
        return <CleanupView cleanup={dashboard.snapshot.cleanup} onMoveToTrash={dashboard.moveCleanupToTrash} />
      case 'usage':
        return <UsageView snapshot={dashboard.snapshot} />
      case 'relay':
        return <RelayView sessions={dashboard.snapshot.sessions} onRelay={dashboard.exportUniversalRelay} />
      case 'health':
        return <HealthView snapshot={dashboard.snapshot} />
      case 'settings':
        return <SettingsView />
      default:
        return null
    }
  }, [activeView, dashboard])

  return (
    <TooltipProvider>
      <div className={`mac-window theme-${activeView === 'cleanup' ? 'dark' : theme.resolvedTheme} flex h-screen overflow-hidden text-white soft-grid`}>
        <Sidebar activeView={activeView} setActiveView={setActiveView} snapshot={dashboard.snapshot} />
        <main className="flex min-w-0 flex-1 flex-col">
          <Topbar
            activeView={activeView}
            loading={dashboard.loading}
            usingMockData={dashboard.usingMockData}
            resolvedTheme={theme.resolvedTheme}
            onThemeToggle={() => theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark')}
            onRescan={dashboard.rescan}
          />
          <div className="content-scroll no-drag-region min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className={activeView === 'cleanup' ? 'px-7 pb-8' : 'p-5'}>{content}</div>
          </div>
        </main>
      </div>
      <Toaster theme={activeView === 'cleanup' ? 'dark' : theme.resolvedTheme} position="top-right" />
    </TooltipProvider>
  )
}

export default App
