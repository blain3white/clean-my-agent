import { useMemo, useState } from 'react'
import { GitBranch, FolderTree, HardDrive, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { agentLabel, formatBytes, formatRelative } from '@/lib/format'
import { useI18n } from '@/lib/i18n-context'
import type { WorktreeOwner, WorktreeRecord } from '@/shared/types'

type SortKey = 'size' | 'activity' | 'agent' | 'repo'

function ownerLabel(owner: WorktreeOwner): string {
  if (owner === 'other') return 'Other'
  return agentLabel[owner]
}

function ownerBadgeClass(owner: WorktreeOwner): string {
  if (owner === 'other') return 'bg-sky-400/10 text-sky-300'
  const palette: Record<string, string> = {
    codex: 'bg-emerald-400/10 text-emerald-300',
    claude: 'bg-orange-400/10 text-orange-300',
    cursor: 'bg-blue-400/10 text-blue-300',
    gemini: 'bg-violet-400/10 text-violet-300',
    opencode: 'bg-cyan-400/10 text-cyan-300',
    pi: 'bg-pink-400/10 text-pink-300',
    custom: 'bg-amber-400/10 text-amber-300',
  }
  return palette[owner] ?? 'bg-white/10 text-white/70'
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof HardDrive
  label: string
  value: string
  accent: string
}) {
  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardContent className="flex items-center gap-3">
        <div className={`grid size-9 shrink-0 place-items-center rounded-md ${accent}`}>
          <Icon className="size-[18px]" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div>
          <div className="truncate text-[17px] font-semibold text-white">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export function WorktreesView({ worktrees }: { worktrees: WorktreeRecord[] }) {
  const { t } = useI18n()
  const [sort, setSort] = useState<SortKey>('size')

  const stats = useMemo(() => {
    const total = worktrees.length
    const totalBytes = worktrees.reduce((sum, wt) => sum + wt.sizeBytes, 0)
    const stale = worktrees.filter((wt) => wt.stale).length
    const dirty = worktrees.filter((wt) => !wt.clean).length
    const byOwner = new Map<WorktreeOwner, { count: number; bytes: number }>()
    for (const wt of worktrees) {
      const entry = byOwner.get(wt.ownerAgent) ?? { count: 0, bytes: 0 }
      entry.count += 1
      entry.bytes += wt.sizeBytes
      byOwner.set(wt.ownerAgent, entry)
    }
    return { total, totalBytes, stale, dirty, byOwner }
  }, [worktrees])

  const sorted = useMemo(() => {
    const list = [...worktrees]
    if (sort === 'size') list.sort((a, b) => b.sizeBytes - a.sizeBytes)
    else if (sort === 'activity')
      list.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    else if (sort === 'agent')
      list.sort((a, b) => ownerLabel(a.ownerAgent).localeCompare(ownerLabel(b.ownerAgent)))
    else list.sort((a, b) => a.repoName.localeCompare(b.repoName))
    return list
  }, [worktrees, sort])

  if (worktrees.length === 0) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/55">
        <GitBranch className="mx-auto mb-3 size-7 text-white/30" />
        {t('worktrees.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={FolderTree}
          label={t('worktrees.statTotal')}
          value={String(stats.total)}
          accent="bg-sky-400/12 text-sky-300"
        />
        <StatCard
          icon={HardDrive}
          label={t('worktrees.statSize')}
          value={formatBytes(stats.totalBytes)}
          accent="bg-emerald-400/12 text-emerald-300"
        />
        <StatCard
          icon={AlertTriangle}
          label={t('worktrees.statStale')}
          value={String(stats.stale)}
          accent="bg-amber-400/12 text-amber-300"
        />
        <StatCard
          icon={CheckCircle2}
          label={t('worktrees.statDirty')}
          value={String(stats.dirty)}
          accent="bg-rose-400/12 text-rose-300"
        />
      </div>

      <Card className="glass-panel rounded-lg py-4">
        <CardContent className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-white/45">
            {t('worktrees.byAgent')}
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(stats.byOwner.entries())
              .sort((a, b) => b[1].bytes - a[1].bytes)
              .map(([owner, { count, bytes }]) => (
                <Badge key={owner} className={ownerBadgeClass(owner)}>
                  {ownerLabel(owner)} · {count} · {formatBytes(bytes)}
                </Badge>
              ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-white/80">{t('worktrees.listTitle')}</h2>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/70"
          aria-label={t('worktrees.sort')}
        >
          <option value="size">{t('worktrees.sortSize')}</option>
          <option value="activity">{t('worktrees.sortActivity')}</option>
          <option value="agent">{t('worktrees.sortAgent')}</option>
          <option value="repo">{t('worktrees.sortRepo')}</option>
        </select>
      </div>

      <div className="space-y-2">
        {sorted.map((wt) => (
          <Card key={wt.id} className="glass-panel rounded-lg px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 shrink-0 text-white/40" />
                  <span className="truncate font-medium text-white">
                    {wt.branch || wt.repoName}
                  </span>
                  {wt.stale ? (
                    <Badge className="bg-amber-400/10 text-amber-300">{t('worktrees.stale')}</Badge>
                  ) : (
                    <Badge className="bg-emerald-400/10 text-emerald-300">
                      {t('worktrees.active')}
                    </Badge>
                  )}
                  {wt.clean ? (
                    <Badge className="bg-emerald-400/10 text-emerald-300">
                      {t('worktrees.clean')}
                    </Badge>
                  ) : (
                    <Badge className="bg-rose-400/10 text-rose-300">{t('worktrees.dirty')}</Badge>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-white/42" title={wt.path}>
                  {wt.path}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/50">
                  <Badge className={ownerBadgeClass(wt.ownerAgent)}>
                    {ownerLabel(wt.ownerAgent)}
                  </Badge>
                  <span>{wt.repoName}</span>
                  <span className="text-white/25">•</span>
                  <span>{formatRelative(wt.lastActivity)}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[15px] font-semibold text-white">
                  {formatBytes(wt.sizeBytes)}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
