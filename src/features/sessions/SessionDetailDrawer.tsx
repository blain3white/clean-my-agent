import { useMemo, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Code2,
  FileText,
  MessageSquareText,
  Sparkles,
  Terminal,
  UserRound,
  Wrench,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { agentLabel, formatBytes, formatTokens } from '@/lib/format'
import type { TranslationKey } from '@/lib/i18n'
import { useI18n } from '@/lib/i18n-context'
import { cn } from '@/lib/utils'
import type { SessionRecord, UniversalRelayDocument } from '@/shared/types'
import {
  buildSessionTimeline,
  countTimelineEvents,
  filterTimelineEvents,
  sessionDetailFilters,
  type SessionDetailFilter,
  type SessionTimelineEvent,
  type SessionTimelineEventKind,
} from './session-detail-model'

type SessionDetailDrawerProps = {
  open: boolean
  session?: SessionRecord
  detail?: UniversalRelayDocument
  loading: boolean
  error?: string
  onOpenChange: (open: boolean) => void
}

const filterIcon: Record<SessionDetailFilter, typeof MessageSquareText> = {
  all: MessageSquareText,
  user: UserRound,
  assistant: Bot,
  text: FileText,
  reasoning: Sparkles,
  tool: Wrench,
  command: Terminal,
}

const eventIcon: Record<SessionTimelineEventKind, typeof MessageSquareText> = {
  user: UserRound,
  assistant: Bot,
  text: FileText,
  reasoning: Sparkles,
  tool: Wrench,
  command: Terminal,
}

const eventTone: Record<SessionTimelineEventKind, string> = {
  user: 'border-sky-300/16 bg-sky-300/7 text-sky-100',
  assistant: 'border-white/10 bg-white/[0.055] text-white/82',
  text: 'border-white/10 bg-white/[0.055] text-white/76',
  reasoning:
    'border-amber-300/34 bg-amber-300/10 text-amber-100 shadow-[0_0_0_1px_rgb(245_158_11_/_0.08)]',
  tool: 'border-violet-300/25 bg-violet-300/10 text-violet-100',
  command: 'border-emerald-300/18 bg-emerald-300/8 text-emerald-100',
}

const filterLabelKey: Record<SessionDetailFilter, TranslationKey> = {
  all: 'sessions.detailFilter.all',
  user: 'sessions.detailFilter.user',
  assistant: 'sessions.detailFilter.assistant',
  text: 'sessions.detailFilter.text',
  reasoning: 'sessions.detailFilter.reasoning',
  tool: 'sessions.detailFilter.tool',
  command: 'sessions.detailFilter.command',
}

function formatClock(value: string | undefined, locale: string): string {
  if (!value) return '--:--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusTone(status: string | undefined): string {
  const normalized = status?.toLowerCase()
  if (!normalized) return 'border-white/10 bg-white/[0.06] text-white/48'
  if (['completed', 'success', 'succeeded', 'done'].some((item) => normalized.includes(item))) {
    return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200'
  }
  if (['failed', 'error'].some((item) => normalized.includes(item))) {
    return 'border-red-300/20 bg-red-300/10 text-red-200'
  }
  return 'border-amber-300/20 bg-amber-300/10 text-amber-200'
}

function TimelineEventCard({ event, locale }: { event: SessionTimelineEvent; locale: string }) {
  const Icon = eventIcon[event.kind]

  return (
    <div className="grid grid-cols-[54px_26px_minmax(0,1fr)] gap-2">
      <div className="pt-2 text-right text-[11px] font-medium text-white/48">
        {formatClock(event.createdAt, locale)}
      </div>
      <div className="relative flex justify-center">
        <span className="absolute top-8 bottom-[-18px] w-px bg-white/10" />
        <span className="relative grid size-5 place-items-center rounded-full border border-white/18 bg-[#171b1f] text-white/56">
          <Circle className="size-2 fill-current" />
        </span>
      </div>
      <article className={cn('rounded-lg border px-3 py-2.5', eventTone[event.kind])}>
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-black/20">
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0 truncate text-xs font-semibold">{event.title}</div>
          {event.status && (
            <span
              className={cn(
                'ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10px] font-semibold',
                statusTone(event.status),
              )}
            >
              <CheckCircle2 className="size-3" />
              {event.status}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-current opacity-80">
          {event.text}
        </p>
        {event.meta && (
          <div className="mt-2 truncate rounded-md bg-black/18 px-2 py-1 font-mono text-[10px] text-current opacity-60">
            {event.meta}
          </div>
        )}
      </article>
    </div>
  )
}

export function SessionDetailDrawer({
  open,
  session,
  detail,
  loading,
  error,
  onOpenChange,
}: SessionDetailDrawerProps) {
  const { locale, t } = useI18n()
  const [filter, setFilter] = useState<SessionDetailFilter>('all')
  const events = useMemo(() => (detail ? buildSessionTimeline(detail) : []), [detail])
  const counts = useMemo(() => countTimelineEvents(events), [events])
  const visibleEvents = useMemo(() => filterTimelineEvents(events, filter), [events, filter])
  const projectPath = detail?.git?.projectPath ?? session?.projectPath
  const fileCount = detail?.files.length ?? 0
  const commandCount = detail?.commands.length ?? 0

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="no-drag-region w-[min(720px,calc(100vw-260px))] gap-0 border-white/12 bg-[#111417]/96 p-0 text-white shadow-[-24px_0_70px_rgb(0_0_0_/_0.35)] backdrop-blur-xl sm:max-w-none"
      >
        <SheetHeader className="border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3 pr-9">
            {session && <AgentGlyph source={session.source} />}
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base font-semibold text-white">
                {session?.title ?? t('sessions.detailTitleFallback')}
              </SheetTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/46">
                {session && <span>{agentLabel[session.source]}</span>}
                <span>
                  {t('sessions.detailSessionId', { id: session?.id.slice(0, 16) ?? '-' })}
                </span>
                <span>{session?.projectName ?? t('common.unknownProject')}</span>
                {session?.storageState === 'archived' ? (
                  <Badge className="h-5 bg-emerald-400/10 text-emerald-300">
                    {t('status.vault')}
                  </Badge>
                ) : (
                  <Badge className="h-5 bg-amber-400/10 text-amber-300">{t('status.live')}</Badge>
                )}
              </div>
            </div>
          </div>
          {session && (
            <div className="mt-4 grid grid-cols-4 gap-2">
              <DetailMetric label={t('sessions.detailMessages')} value={session.messageCount} />
              <DetailMetric
                label={t('sessions.detailTokens')}
                value={formatTokens(session.tokens.total)}
              />
              <DetailMetric
                label={t('sessions.detailSize')}
                value={formatBytes(session.sizeBytes)}
              />
              <DetailMetric
                label={t('sessions.detailUpdated')}
                value={formatClock(session.lastUpdated, locale)}
              />
            </div>
          )}
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-white/8 px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {sessionDetailFilters.map((item) => {
                const Icon = filterIcon[item]
                const active = filter === item
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition',
                      active
                        ? 'border-white/24 bg-white/88 text-neutral-900'
                        : 'border-white/10 bg-white/[0.04] text-white/58 hover:border-white/18 hover:bg-white/[0.08] hover:text-white/78',
                    )}
                  >
                    <Icon className="size-3.5" />
                    {t(filterLabelKey[item])}
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10px]',
                        active ? 'bg-black/10 text-neutral-800' : 'bg-white/8 text-white/40',
                      )}
                    >
                      {counts[item]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-20 animate-pulse rounded-lg border border-white/8 bg-white/[0.04]"
                  />
                ))}
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
                {error}
              </div>
            ) : visibleEvents.length > 0 ? (
              <div className="space-y-4">
                {visibleEvents.map((event) => (
                  <TimelineEventCard key={event.id} event={event} locale={locale} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/8 bg-white/[0.04] p-4 text-sm text-white/52">
                {t('sessions.detailEmpty')}
              </div>
            )}
          </div>

          <div className="border-t border-white/8 px-5 py-3 text-xs text-white/42">
            <div className="grid grid-cols-3 gap-2">
              <DetailMeta icon={FileText} label={t('sessions.detailFiles')} value={fileCount} />
              <DetailMeta
                icon={Terminal}
                label={t('sessions.detailCommands')}
                value={commandCount}
              />
              <DetailMeta
                icon={Clock3}
                label={t('sessions.detailBranch')}
                value={session?.branch ?? t('common.unknown')}
              />
            </div>
            {projectPath && (
              <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.035] px-2 py-1.5">
                <Code2 className="size-3.5 shrink-0 text-white/35" />
                <span className="truncate font-mono text-[11px] text-white/45">{projectPath}</span>
                <ChevronDown className="ml-auto size-3.5 text-white/24" />
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-2">
      <div className="truncate text-[10px] uppercase text-white/34">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold text-white/78">{value}</div>
    </div>
  )
}

function DetailMeta({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText
  label: string
  value: number | string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.035] px-2 py-1.5">
      <Icon className="size-3.5 shrink-0 text-white/35" />
      <span className="truncate">{label}</span>
      <span className="ml-auto truncate font-semibold text-white/62">{value}</span>
    </div>
  )
}
