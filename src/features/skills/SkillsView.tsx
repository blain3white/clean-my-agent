import {
  Archive,
  ArrowRightLeft,
  CheckCircle2,
  Circle,
  Copy,
  Database,
  FileJson2,
  HardDrive,
  ListFilter,
  MoreHorizontal,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { AgentGlyph } from '@/components/agent-glyph'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { agentLabel } from '@/lib/format'
import type { TranslationKey } from '@/lib/i18n'
import { useI18n } from '@/lib/i18n-context'
import { agentSources, type SkillsSnapshot, type SkillsSummary } from '@/shared/types'
import {
  categoryLabelKey,
  filterSkills,
  statusLabelKey,
  summarizeVisibleSkills,
  type ManagedSkill,
  type SkillOwnerFilter,
  type SkillStatus,
  type SkillStatusFilter,
} from './skills-data'

type SkillAccentStyle = CSSProperties & {
  '--skill-accent': string
  '--skill-accent-deep': string
}

const accentColors: Record<ManagedSkill['accent'], { color: string; deep: string }> = {
  violet: { color: '#9f7aea', deep: '#51309f' },
  orange: { color: '#fb923c', deep: '#8d3a0f' },
  green: { color: '#22c55e', deep: '#12672e' },
  blue: { color: '#38bdf8', deep: '#075985' },
  cyan: { color: '#2dd4bf', deep: '#0f766e' },
  pink: { color: '#e879f9', deep: '#86198f' },
  amber: { color: '#eab308', deep: '#854d0e' },
}

const statusClasses: Record<SkillStatus, string> = {
  synced: 'bg-emerald-400/12 text-emerald-300',
  local: 'bg-sky-400/12 text-sky-300',
  'backed-up': 'bg-amber-400/12 text-amber-300',
}

const emptySummary: SkillsSummary = {
  totalSkills: 0,
  weeklyDelta: 0,
  linkedAgents: 0,
  linkedAgentTotal: 0,
  backups: 0,
  backupPercent: 0,
  recentlyChanged: 0,
}

const emptySnapshot = (): SkillsSnapshot => ({
  generatedAt: new Date().toISOString(),
  skills: [],
  summary: emptySummary,
})

const summaryCards = [
  {
    key: 'totalSkills',
    labelKey: 'skills.summary.totalSkills',
    icon: Database,
    tone: 'violet',
    detailKey: 'skills.summary.totalDetail',
  },
  {
    key: 'linkedAgents',
    labelKey: 'skills.summary.linkedAgents',
    icon: ArrowRightLeft,
    tone: 'blue',
    detailKey: 'skills.summary.linkedDetail',
  },
  {
    key: 'backups',
    labelKey: 'skills.summary.backups',
    icon: Archive,
    tone: 'green',
    detailKey: 'skills.summary.backupsDetail',
  },
  {
    key: 'recentlyChanged',
    labelKey: 'skills.summary.recentlyChanged',
    icon: RefreshCcw,
    tone: 'orange',
    detailKey: 'skills.summary.changedDetail',
  },
] as const satisfies Array<{
  key: 'totalSkills' | 'linkedAgents' | 'backups' | 'recentlyChanged'
  labelKey: TranslationKey
  icon: typeof Database
  tone: 'violet' | 'blue' | 'green' | 'orange'
  detailKey: TranslationKey
}>

const statusTabs: Array<{ value: SkillStatusFilter; labelKey: TranslationKey }> = [
  { value: 'all', labelKey: 'skills.filter.all' },
  { value: 'synced', labelKey: 'skills.filter.synced' },
  { value: 'local', labelKey: 'skills.filter.localOnly' },
  { value: 'backed-up', labelKey: 'skills.filter.backedUp' },
]

function SkillIcon({ skill }: { skill: ManagedSkill }) {
  const icon = {
    code: FileJson2,
    review: Search,
    bug: HardDrive,
    notes: Database,
    search: Search,
    image: FileJson2,
    data: Database,
    spec: FileJson2,
  }[skill.icon]
  const Icon = icon
  const colors = accentColors[skill.accent]

  return (
    <span
      className="skill-icon-box"
      style={
        {
          '--skill-accent': colors.color,
          '--skill-accent-deep': colors.deep,
        } as SkillAccentStyle
      }
    >
      <Icon className="size-4" />
    </span>
  )
}

function StatusPill({ status }: { status: SkillStatus }) {
  const { t } = useI18n()

  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold ${statusClasses[status]}`}
    >
      <Circle className="size-2 fill-current" />
      {t(statusLabelKey(status))}
    </span>
  )
}

function SkillCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`grid size-[18px] place-items-center rounded-[4px] border ${
        checked
          ? 'border-emerald-300/50 bg-emerald-400/80 text-[#061411]'
          : 'border-white/22 bg-white/[0.02]'
      }`}
    >
      {checked && <CheckCircle2 className="size-3.5" />}
    </span>
  )
}

function summaryValue(summary: SkillsSummary, key: (typeof summaryCards)[number]['key']) {
  return summary[key]
}

function summaryDetailCount(summary: SkillsSummary, key: (typeof summaryCards)[number]['key']) {
  if (key === 'totalSkills') return summary.weeklyDelta
  if (key === 'linkedAgents') return summary.linkedAgentTotal
  if (key === 'backups') return summary.backupPercent
  return 7
}

function SkillsSummaryCards({ summary }: { summary: SkillsSummary }) {
  const { t } = useI18n()

  return (
    <div className="skills-summary-grid">
      {summaryCards.map((card) => {
        const Icon = card.icon
        return (
          <div key={card.key} className={`skills-summary-card skills-summary-card-${card.tone}`}>
            <div className="skills-summary-icon">
              <Icon className="size-5" />
            </div>
            <div>
              <div className="text-xs text-white/45">{t(card.labelKey)}</div>
              <div className="mt-1 text-2xl font-semibold tracking-normal text-white">
                {summaryValue(summary, card.key)}
              </div>
              <div className="mt-3 text-xs text-white/48">
                {t(card.detailKey, {
                  count: summaryDetailCount(summary, card.key),
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SkillRow({
  skill,
  selected,
  active,
  onSelect,
  updatedLabel,
}: {
  skill: ManagedSkill
  selected: boolean
  active: boolean
  onSelect: (skill: ManagedSkill) => void
  updatedLabel: string
}) {
  const { t } = useI18n()

  return (
    <tr
      className={`skills-table-row ${active ? 'bg-white/[0.045]' : ''}`}
      onClick={() => onSelect(skill)}
    >
      <td className="w-11 pl-4">
        <SkillCheckbox checked={selected} />
      </td>
      <td className="w-[310px] py-3">
        <div className="flex min-w-0 items-center gap-3">
          <SkillIcon skill={skill} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">{skill.name}</div>
            <div className="mt-0.5 max-w-[230px] truncate text-[11px] text-white/42">
              {skill.description}
            </div>
          </div>
        </div>
      </td>
      <td className="w-[170px]">
        <div className="flex items-center gap-2">
          <AgentGlyph source={skill.ownerAgent} />
          <span className="text-sm text-white/60">{agentLabel[skill.ownerAgent]}</span>
        </div>
      </td>
      <td className="w-[150px]">
        <span className={`skills-category skills-category-${skill.category}`}>
          {t(categoryLabelKey(skill.category))}
        </span>
      </td>
      <td className="w-[104px] text-sm text-white/55">{updatedLabel}</td>
      <td className="w-[86px] text-sm text-white/55">{skill.sizeKb} KB</td>
      <td className="w-[140px]">
        <StatusPill status={skill.status} />
      </td>
      <td className="w-[86px] pr-4 text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-white/55 hover:bg-white/10 hover:text-white"
              aria-label={t('skills.moreActions', { name: skill.name })}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('skills.moreActions', { name: skill.name })}</TooltipContent>
        </Tooltip>
      </td>
    </tr>
  )
}

function DetailField({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-4 text-sm">
      <dt className="text-white/45">{label}</dt>
      <dd className="text-white/62">{value}</dd>
    </div>
  )
}

function formatAbsoluteDate(value: string, locale: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale)
}

function SkillsDetailPanel({ skill }: { skill: ManagedSkill }) {
  const { locale, t, formatRelative } = useI18n()
  const extraAgents = Math.max(0, skill.linkedAgents.length - 3)

  return (
    <aside className="skills-detail-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <SkillIcon skill={skill} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight text-white">{skill.name}</h2>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-white/45 hover:bg-white/8 hover:text-white"
          aria-label={t('skills.closeDetails')}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <StatusPill status={skill.status} />
      </div>

      <div className="mt-5 border-t border-white/8 pt-4">
        <h3 className="text-sm font-semibold text-white">{t('skills.description')}</h3>
        <p className="mt-3 text-sm leading-6 text-white/55">{skill.description}</p>
      </div>

      <div className="mt-5 border-t border-white/8 pt-4">
        <h3 className="text-sm font-semibold text-white">{t('skills.linkedAgents')}</h3>
        <div className="mt-4 flex items-center gap-4">
          {skill.linkedAgents.slice(0, 3).map((source) => (
            <div key={source} className="grid justify-items-center gap-1.5">
              <AgentGlyph source={source} />
              <span className="text-xs text-white/62">{agentLabel[source]}</span>
            </div>
          ))}
          {extraAgents > 0 && <span className="text-sm text-white/45">+{extraAgents} more</span>}
        </div>
        <p className="mt-3 text-sm text-white/38">
          {t('skills.totalAgents', { count: skill.linkedAgents.length })}
        </p>
      </div>

      <dl className="mt-5 space-y-4 border-t border-white/8 pt-4">
        <DetailField label={t('skills.version')} value={skill.version} />
        <DetailField
          label={t('skills.created')}
          value={formatAbsoluteDate(skill.createdAt, locale)}
        />
        <DetailField label={t('skills.updated')} value={formatRelative(skill.updatedAt)} />
        <DetailField
          label={t('skills.lastBackup')}
          value={
            skill.lastBackupAt ? formatAbsoluteDate(skill.lastBackupAt, locale) : t('time.never')
          }
        />
        <DetailField label={t('skills.usageCount')} value={skill.usageCount} />
        <DetailField label={t('skills.size')} value={`${skill.sizeKb} KB`} />
        <DetailField label={t('skills.category')} value={t(categoryLabelKey(skill.category))} />
        <DetailField label={t('skills.location')} value={skill.location} />
      </dl>

      <div className="mt-6 grid gap-3">
        <Button className="skills-detail-action" variant="outline">
          <ArrowRightLeft className="size-4" />
          {t('skills.transfer')}
        </Button>
        <Button className="skills-detail-action" variant="outline">
          <Copy className="size-4" />
          {t('skills.duplicate')}
        </Button>
        <Button className="skills-detail-action" variant="outline">
          <Archive className="size-4" />
          {t('skills.backupNow')}
        </Button>
        <Button
          className="skills-detail-action border-red-400/45 bg-red-500/10 text-red-300 hover:bg-red-500/16 hover:text-red-200"
          variant="outline"
        >
          <Trash2 className="size-4" />
          {t('skills.deleteSkill')}
        </Button>
      </div>
    </aside>
  )
}

export function SkillsView() {
  const { t, formatRelative } = useI18n()
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState<SkillOwnerFilter>('all')
  const [status, setStatus] = useState<SkillStatusFilter>('all')
  const [snapshot, setSnapshot] = useState<SkillsSnapshot>(() => emptySnapshot())
  const [loading, setLoading] = useState(true)
  const [scanError, setScanError] = useState(false)
  const [activeSkillId, setActiveSkillId] = useState<string>()
  const loadSkills = useCallback(async () => {
    if (!window.cleanMyAgent?.getSkills) {
      setSnapshot(emptySnapshot())
      setScanError(true)
      setLoading(false)
      return
    }

    setLoading(true)
    setScanError(false)
    try {
      const next = await window.cleanMyAgent.getSkills()
      setSnapshot(next)
      setActiveSkillId((current) => current ?? next.skills[0]?.id)
    } catch (error) {
      console.error(error)
      toast.error(t('skills.scanError'))
      setSnapshot(emptySnapshot())
      setScanError(true)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSkills()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadSkills])

  const visibleSkills = useMemo(
    () => filterSkills(snapshot.skills, query, owner, status),
    [owner, query, snapshot.skills, status],
  )
  const visibleSummary = summarizeVisibleSkills(visibleSkills)
  const activeSkill = visibleSkills.find((skill) => skill.id === activeSkillId) ?? visibleSkills[0]
  const selectedIds = new Set(visibleSummary.selectedIds)
  const hasSkills = snapshot.skills.length > 0
  const hasVisibleSkills = visibleSkills.length > 0

  return (
    <div className="skills-page">
      <section className="skills-workbench">
        <div className="skills-toolbar">
          <div className="relative w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('skills.searchPlaceholder')}
              className="h-10 rounded-lg border-white/10 bg-white/5 pl-9 text-sm text-white placeholder:text-white/35"
            />
          </div>
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value as SkillOwnerFilter)}
            className="skills-native-select w-[170px]"
            aria-label={t('skills.ownerFilter')}
          >
            <option value="all">{t('skills.allAgents')}</option>
            {agentSources
              .filter((source) => source !== 'custom')
              .map((source) => (
                <option key={source} value={source}>
                  {agentLabel[source]}
                </option>
              ))}
          </select>
          <div className="ml-auto flex items-center gap-3">
            <div className="skills-segmented">
              {statusTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setStatus(tab.value)}
                  className={status === tab.value ? 'active' : ''}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>
            <div className="h-8 w-px bg-white/8" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="h-10 w-10 border-white/10 bg-white/8 text-white/70 hover:bg-white/12 hover:text-white"
                  aria-label={t('skills.refresh')}
                  onClick={() => void loadSkills()}
                >
                  <RefreshCcw className={`size-5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('skills.refresh')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="h-10 w-10 border-white/10 bg-white/8 text-white/70 hover:bg-white/12 hover:text-white"
                  aria-label={t('skills.viewOptions')}
                >
                  <ListFilter className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('skills.viewOptions')}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <SkillsSummaryCards summary={snapshot.summary} />

        <div className="skills-table-panel">
          <div className="skills-bulkbar">
            <span className="text-sm text-white/55">
              {t('skills.selectedCount', { count: visibleSummary.selectedIds.length })}
            </span>
            <Button variant="ghost" size="sm" className="skills-bulk-button">
              <ArrowRightLeft className="size-4" />
              {t('skills.transfer')}
            </Button>
            <Button variant="ghost" size="sm" className="skills-bulk-button">
              <Copy className="size-4" />
              {t('skills.copy')}
            </Button>
            <Button variant="ghost" size="sm" className="skills-bulk-button">
              <Archive className="size-4" />
              {t('skills.backup')}
            </Button>
            <Button variant="ghost" size="sm" className="skills-bulk-button">
              <Trash2 className="size-4" />
              {t('skills.delete')}
            </Button>
            <button type="button" className="ml-auto text-sm text-white/38 hover:text-white/70">
              {t('skills.clearSelection')}
            </button>
            <X className="size-4 text-white/42" />
          </div>

          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="h-12 border-b border-white/8 text-left text-xs font-medium text-white/45">
                <th className="w-11 pl-4">
                  <SkillCheckbox checked={false} />
                </th>
                <th className="w-[310px]">{t('skills.skill')}</th>
                <th className="w-[170px]">{t('skills.ownerAgent')}</th>
                <th className="w-[150px]">{t('skills.category')}</th>
                <th className="w-[104px]">{t('skills.updated')}</th>
                <th className="w-[86px]">{t('skills.size')}</th>
                <th className="w-[140px]">{t('skills.status')}</th>
                <th className="w-[86px] pr-4 text-right">{t('skills.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleSkills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  selected={selectedIds.has(skill.id)}
                  active={skill.id === activeSkill?.id}
                  updatedLabel={formatRelative(skill.updatedAt)}
                  onSelect={(nextSkill) => {
                    setActiveSkillId(nextSkill.id)
                  }}
                />
              ))}
            </tbody>
          </table>

          {!loading && !hasVisibleSkills && (
            <div className="skills-empty-state">
              <div className="text-sm font-semibold text-white">
                {scanError
                  ? t('skills.scanError')
                  : hasSkills
                    ? t('skills.noMatchesTitle')
                    : t('skills.emptyTitle')}
              </div>
              <p className="mt-2 text-sm text-white/45">
                {scanError
                  ? t('skills.loadingBody')
                  : hasSkills
                    ? t('skills.noMatchesBody')
                    : t('skills.emptyBody')}
              </p>
            </div>
          )}

          {loading && (
            <div className="skills-empty-state">
              <div className="text-sm font-semibold text-white">{t('skills.loadingTitle')}</div>
              <p className="mt-2 text-sm text-white/45">{t('skills.loadingBody')}</p>
            </div>
          )}

          <div className="skills-pagination">
            <span>
              {t('skills.showing', {
                start: visibleSkills.length > 0 ? 1 : 0,
                end: visibleSkills.length,
                count: snapshot.summary.totalSkills,
              })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" className="skills-page-button">
                ‹
              </button>
              {[1, 2, 3].map((page) => (
                <button
                  key={page}
                  type="button"
                  className={`skills-page-button ${page === 1 ? 'active' : ''}`}
                >
                  {page}
                </button>
              ))}
              <button type="button" className="skills-page-button">
                ...
              </button>
              <button type="button" className="skills-page-button">
                6
              </button>
              <button type="button" className="skills-page-button">
                ›
              </button>
            </div>
          </div>
        </div>
      </section>

      {activeSkill ? (
        <SkillsDetailPanel skill={activeSkill} />
      ) : (
        <aside className="skills-detail-panel">
          <div className="text-sm font-semibold text-white">{t('skills.emptyDetailsTitle')}</div>
          <p className="mt-3 text-sm leading-6 text-white/45">{t('skills.emptyDetailsBody')}</p>
        </aside>
      )}
    </div>
  )
}
