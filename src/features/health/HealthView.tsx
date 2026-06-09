import { AgentGlyph } from '@/components/agent-glyph'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { agentHealthStatusKey } from '@/app/sidebar-model'
import { formatBytes } from '@/lib/format'
import { useI18n } from '@/lib/i18n-context'
import type { AgentScanDiagnostic, DashboardSnapshot } from '@/shared/types'

function diagnosticTone(level: AgentScanDiagnostic['level']): string {
  if (level === 'error') return 'border-rose-300/15 bg-rose-400/10 text-rose-200'
  if (level === 'warning') return 'border-amber-300/15 bg-amber-400/10 text-amber-200'
  return 'border-sky-300/15 bg-sky-400/10 text-sky-200'
}

export function HealthView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { t } = useI18n()

  if (snapshot.agents.length === 0) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/[0.03] px-4 py-6 text-sm text-white/55">
        {t('health.noAgents')}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {snapshot.agents.map((agent) => (
        <Card key={agent.source} className="glass-panel rounded-lg py-4">
          <CardContent className="flex items-start gap-3">
            <AgentGlyph source={agent.source} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="font-medium text-white">{agent.name}</div>
                <Badge
                  className={
                    agent.readable
                      ? 'bg-emerald-400/10 text-emerald-300'
                      : 'bg-amber-400/10 text-amber-300'
                  }
                >
                  {t(agentHealthStatusKey(agent))}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-white/42">
                {t('health.agentSummary', {
                  count: agent.sessionCount,
                  size: formatBytes(agent.sizeBytes),
                })}
              </div>
              <div className="mt-2 text-xs text-white/42">
                {t('health.scanStats', {
                  scanned: agent.scannedFiles ?? 0,
                  skipped: agent.skippedFiles ?? 0,
                })}
              </div>
              <div className="mt-3 space-y-1">
                {agent.rootPaths.map((root) => (
                  <div
                    key={root}
                    className="truncate rounded border border-white/7 bg-white/[0.03] px-2 py-1 text-[11px] text-white/38"
                  >
                    {root}
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                <div className="text-[11px] font-medium uppercase text-white/35">
                  {t('health.scanDiagnostics')}
                </div>
                {agent.diagnostics?.length ? (
                  <>
                    {agent.diagnostics.slice(0, 4).map((diagnostic, index) => (
                      <div
                        key={`${diagnostic.code}-${diagnostic.path ?? index}`}
                        className={`rounded border px-2.5 py-2 text-[11px] leading-5 ${diagnosticTone(
                          diagnostic.level,
                        )}`}
                      >
                        <div className="font-medium">{diagnostic.message}</div>
                        {diagnostic.path && (
                          <div className="mt-0.5 truncate opacity-70">{diagnostic.path}</div>
                        )}
                      </div>
                    ))}
                    {agent.diagnostics.length > 4 && (
                      <div className="text-[11px] text-white/35">
                        {t('health.moreDiagnostics', { count: agent.diagnostics.length - 4 })}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded border border-emerald-300/10 bg-emerald-400/5 px-2.5 py-2 text-[11px] text-emerald-200/80">
                    {t('health.noDiagnostics')}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
