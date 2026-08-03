import { useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Download,
  FileJson2,
  HardDrive,
  RefreshCcw,
  Search,
  SearchX,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n-context'
import { agentLabel, formatBytes, formatRelative, formatTokens } from '@/lib/format'
import type {
  ArchiveRecord,
  AgentSource,
  SessionRecord,
  UniversalRelayDocument,
} from '@/shared/types'
import { SessionDetailDrawer } from './SessionDetailDrawer'
import { sessionActionLabel, sessionResultRowClassName } from './session-detail-model'

export function SessionsView({
  sessions,
  archives,
  initialQuery = '',
  onBackup,
  onArchive,
  onRestoreArchive,
  onExport,
  onRelay,
  onSessionDetail,
}: {
  sessions: SessionRecord[]
  archives: ArchiveRecord[]
  initialQuery?: string
  onBackup: (sessionId: string) => Promise<void>
  onArchive: (sessionId: string) => Promise<void>
  onRestoreArchive: (archiveId: string) => Promise<void>
  onExport: (sessionId: string) => Promise<void>
  onRelay: (sessionId: string) => Promise<void>
  onSessionDetail: (sessionId: string) => Promise<UniversalRelayDocument>
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState(initialQuery)
  const [agent, setAgent] = useState<'all' | AgentSource>('all')
  const [selectedSessionId, setSelectedSessionId] = useState<string>()
  const [detail, setDetail] = useState<UniversalRelayDocument>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string>()
  const archivesBySessionId = new Map(archives.map((archive) => [archive.sessionId, archive]))
  const selectedSession = sessions.find((session) => session.id === selectedSessionId)
  const filtered = sessions.filter((session) => {
    const haystack = [
      session.title,
      session.projectName,
      session.projectPath,
      session.branch,
      agentLabel[session.source],
      session.storageState,
      session.searchText,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return (
      haystack.includes(query.trim().toLowerCase()) && (agent === 'all' || session.source === agent)
    )
  })

  const openSessionDetail = async (session: SessionRecord) => {
    setSelectedSessionId(session.id)
    setDetail(undefined)
    setDetailError(undefined)
    setDetailLoading(true)
    try {
      setDetail(await onSessionDetail(session.id))
    } catch (error) {
      console.error(error)
      setDetailError(error instanceof Error ? error.message : t('sessions.detailError'))
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <>
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm text-white">{t('sessions.title')}</CardTitle>
              <p className="mt-1 text-xs text-white/42">{t('sessions.description')}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/35" />
                <Input
                  aria-label="Search sessions"
                  autoComplete="off"
                  name="session-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('sessions.searchPlaceholder')}
                  className="h-8 w-64 border-white/10 bg-white/5 pl-8 text-white placeholder:text-white/30"
                />
              </div>
              <select
                aria-label="Filter sessions by agent"
                name="session-agent-filter"
                autoComplete="off"
                value={agent}
                onChange={(event) => setAgent(event.target.value as 'all' | AgentSource)}
                className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none"
              >
                <option value="all">{t('sessions.allAgents')}</option>
                {Object.entries(agentLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
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
                  <TableHead className="text-white/45">{t('sessions.agent')}</TableHead>
                  <TableHead className="text-white/45">{t('sessions.session')}</TableHead>
                  <TableHead className="text-white/45">{t('sessions.project')}</TableHead>
                  <TableHead className="text-white/45">{t('sessions.branch')}</TableHead>
                  <TableHead className="text-white/45">{t('sessions.updated')}</TableHead>
                  <TableHead className="text-right text-white/45">{t('sessions.tokens')}</TableHead>
                  <TableHead className="text-right text-white/45">{t('sessions.size')}</TableHead>
                  <TableHead className="text-white/45">{t('sessions.state')}</TableHead>
                  <TableHead className="text-right text-white/45">
                    {t('sessions.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow className="border-white/7 hover:bg-transparent">
                    <TableCell colSpan={9} className="p-0">
                      <EmptyState
                        compact
                        icon={SearchX}
                        tone={sessions.length === 0 ? 'info' : 'neutral'}
                        title={sessions.length === 0 ? 'No sessions scanned' : 'No matches'}
                        body={
                          sessions.length === 0
                            ? 'Run a local scan after granting folder access or adding a provider path.'
                            : 'Try a different search term or agent filter.'
                        }
                        className="min-h-[260px] rounded-none border-0 bg-transparent shadow-none"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, 80).map((session) => {
                    const archive = archivesBySessionId.get(session.id)
                    const backupLabel =
                      session.storageState === 'archived'
                        ? sessionActionLabel('Backup unavailable for archived session', session)
                        : sessionActionLabel(t('sessions.backupTooltip'), session)
                    const vaultAction =
                      session.storageState === 'archived' && archive
                        ? t('sessions.restoreTooltip')
                        : t('sessions.archiveTooltip')
                    const vaultLabel = sessionActionLabel(vaultAction, session)
                    const exportLabel = sessionActionLabel(
                      t('sessions.exportMarkdownTooltip'),
                      session,
                    )
                    const relayLabel = sessionActionLabel(t('sessions.exportRelayTooltip'), session)
                    return (
                      <TableRow
                        key={session.id}
                        tabIndex={0}
                        onClick={() => void openSessionDetail(session)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            void openSessionDetail(session)
                          }
                        }}
                        className={sessionResultRowClassName}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <AgentGlyph source={session.source} />
                            <span className="text-xs text-white/70">
                              {agentLabel[session.source]}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate font-medium text-white/82">
                          {session.title}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-white/55">
                          {session.projectName}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate text-white/45">
                          {session.branch ?? t('common.unknown')}
                        </TableCell>
                        <TableCell className="text-white/45">
                          {formatRelative(session.lastUpdated)}
                        </TableCell>
                        <TableCell className="text-right text-white/60">
                          {formatTokens(session.tokens.total)}
                        </TableCell>
                        <TableCell className="text-right text-white/60">
                          {formatBytes(session.sizeBytes)}
                        </TableCell>
                        <TableCell>
                          {session.storageState === 'archived' ? (
                            <Badge className="bg-emerald-400/10 text-emerald-300">
                              <Archive className="size-3" />
                              {t('status.vault')}
                            </Badge>
                          ) : session.backupStatus === 'backed-up' ? (
                            <Badge className="bg-blue-400/10 text-blue-300">
                              <CheckCircle2 className="size-3" />
                              {t('status.live')}
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-amber-400/20 bg-amber-400/10 text-amber-300"
                            >
                              {t('status.live')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  aria-label={backupLabel}
                                  title={backupLabel}
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => void onBackup(session.id)}
                                  disabled={session.storageState === 'archived'}
                                  className="text-white/55 hover:bg-white/10 hover:text-white"
                                >
                                  <Archive className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('sessions.backupTooltip')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  aria-label={vaultLabel}
                                  title={vaultLabel}
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() =>
                                    session.storageState === 'archived' && archive
                                      ? void onRestoreArchive(archive.id)
                                      : void onArchive(session.id)
                                  }
                                  className="text-white/55 hover:bg-white/10 hover:text-white"
                                >
                                  {session.storageState === 'archived' ? (
                                    <RefreshCcw className="size-3.5" />
                                  ) : (
                                    <HardDrive className="size-3.5" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {session.storageState === 'archived'
                                  ? t('sessions.restoreTooltip')
                                  : t('sessions.archiveTooltip')}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  aria-label={exportLabel}
                                  title={exportLabel}
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => void onExport(session.id)}
                                  className="text-white/55 hover:bg-white/10 hover:text-white"
                                >
                                  <Download className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('sessions.exportMarkdownTooltip')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  aria-label={relayLabel}
                                  title={relayLabel}
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => void onRelay(session.id)}
                                  className="text-white/55 hover:bg-white/10 hover:text-white"
                                >
                                  <FileJson2 className="size-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('sessions.exportRelayTooltip')}</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <SessionDetailDrawer
        open={Boolean(selectedSessionId)}
        session={selectedSession}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSessionId(undefined)
            setDetail(undefined)
            setDetailError(undefined)
            setDetailLoading(false)
          }
        }}
      />
    </>
  )
}
