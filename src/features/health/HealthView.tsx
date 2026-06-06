import { AgentGlyph } from '@/components/agent-glyph'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatBytes } from '@/lib/format'
import type { DashboardSnapshot } from '@/shared/types'

export function HealthView({ snapshot }: { snapshot: DashboardSnapshot }) {
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
                  {agent.readable ? 'Readable' : 'Not found'}
                </Badge>
              </div>
              <div className="mt-2 text-xs text-white/42">
                {agent.sessionCount} sessions · {formatBytes(agent.sizeBytes)}
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
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
