import { useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Download,
  FileJson2,
  HardDrive,
  RefreshCcw,
  Search,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
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
import { agentLabel, formatBytes, formatRelative, formatTokens } from '@/lib/format'
import type { ArchiveRecord, AgentSource, SessionRecord } from '@/shared/types'

export function SessionsView({
  sessions,
  archives,
  initialQuery = '',
  onBackup,
  onArchive,
  onRestoreArchive,
  onExport,
  onRelay,
}: {
  sessions: SessionRecord[]
  archives: ArchiveRecord[]
  initialQuery?: string
  onBackup: (sessionId: string) => Promise<void>
  onArchive: (sessionId: string) => Promise<void>
  onRestoreArchive: (archiveId: string) => Promise<void>
  onExport: (sessionId: string) => Promise<void>
  onRelay: (sessionId: string) => Promise<void>
}) {
  const [query, setQuery] = useState(initialQuery)
  const [agent, setAgent] = useState<'all' | AgentSource>('all')
  const archivesBySessionId = new Map(archives.map((archive) => [archive.sessionId, archive]))
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

  return (
    <Card className="glass-panel rounded-lg py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm text-white">Unified Sessions</CardTitle>
            <p className="mt-1 text-xs text-white/42">
              Codex, Claude Code, Cursor, Gemini, and OpenCode sessions in one index.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-white/35" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search sessions and previews..."
                className="h-8 w-64 border-white/10 bg-white/5 pl-8 text-white placeholder:text-white/30"
              />
            </div>
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value as 'all' | AgentSource)}
              className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none"
            >
              <option value="all">All Agents</option>
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
                <TableHead className="text-white/45">Agent</TableHead>
                <TableHead className="text-white/45">Session</TableHead>
                <TableHead className="text-white/45">Project</TableHead>
                <TableHead className="text-white/45">Branch</TableHead>
                <TableHead className="text-white/45">Updated</TableHead>
                <TableHead className="text-right text-white/45">Tokens</TableHead>
                <TableHead className="text-right text-white/45">Size</TableHead>
                <TableHead className="text-white/45">State</TableHead>
                <TableHead className="text-right text-white/45">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 80).map((session) => {
                const archive = archivesBySessionId.get(session.id)
                return (
                  <TableRow key={session.id} className="border-white/7 hover:bg-white/[0.035]">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <AgentGlyph source={session.source} />
                        <span className="text-xs text-white/70">{agentLabel[session.source]}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate font-medium text-white/82">
                      {session.title}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-white/55">
                      {session.projectName}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-white/45">
                      {session.branch ?? 'Unknown'}
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
                          Vault
                        </Badge>
                      ) : session.backupStatus === 'backed-up' ? (
                        <Badge className="bg-blue-400/10 text-blue-300">
                          <CheckCircle2 className="size-3" />
                          Live
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-400/20 bg-amber-400/10 text-amber-300"
                        >
                          Live
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void onBackup(session.id)}
                              disabled={session.storageState === 'archived'}
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              <Archive className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Backup session</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
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
                              ? 'Restore from Vault'
                              : 'Archive to Vault'}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void onExport(session.id)}
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              <Download className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Export Markdown</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void onRelay(session.id)}
                              className="text-white/55 hover:bg-white/10 hover:text-white"
                            >
                              <FileJson2 className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Export universal relay JSON</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
