import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { mockSnapshot } from '@/lib/mock-data'
import { agentSources, type AgentSource, type DashboardSnapshot, type ExportFormat } from '@/shared/types'

type DashboardState = {
  snapshot: DashboardSnapshot
  loading: boolean
  usingMockData: boolean
  rescan: () => Promise<void>
  backupSession: (sessionId: string) => Promise<void>
  exportSession: (sessionId: string, format: ExportFormat) => Promise<void>
  exportUniversalRelay: (sessionId: string) => Promise<void>
  moveCleanupToTrash: (candidateIds: string[]) => Promise<void>
}

const agentNames: Record<AgentSource, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
}

const emptySnapshot = (): DashboardSnapshot => ({
  generatedAt: new Date().toISOString(),
  overview: {
    totalSessions: 0,
    backedUpSessions: 0,
    reclaimableBytes: 0,
    totalTokens: 0,
    totalSizeBytes: 0,
    highRiskCleanupCount: 0,
  },
  agents: agentSources.map((source) => ({
    source,
    name: agentNames[source],
    installed: false,
    readable: false,
    rootPaths: [],
    sessionCount: 0,
    sizeBytes: 0,
  })),
  sessions: [],
  cleanup: [],
  backups: [],
  trash: [],
  usage: [],
  storage: [],
})

export function useDashboard(): DashboardState {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => mockSnapshot)
  const [loading, setLoading] = useState(true)
  const [usingMockData, setUsingMockData] = useState(false)

  const load = useCallback(async (force = false) => {
    if (!window.cleanMyAgent) {
      setSnapshot(mockSnapshot)
      setUsingMockData(true)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = force ? await window.cleanMyAgent.rescan() : await window.cleanMyAgent.getSnapshot()
      setSnapshot(next)
      setUsingMockData(false)
    } catch (error) {
      console.error(error)
      toast.error('Could not read local agent data.')
      setSnapshot(emptySnapshot())
      setUsingMockData(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const actions = useMemo(
    () => ({
      rescan: async () => {
        await load(true)
        toast.success('Agent data scanned')
      },
      backupSession: async (sessionId: string) => {
        if (!window.cleanMyAgent) {
          toast.info('Backup is available in the desktop app')
          return
        }
        const record = await window.cleanMyAgent.backupSession(sessionId)
        toast.success(`Backup created: ${record.title}`)
        await load(false)
      },
      exportSession: async (sessionId: string, format: ExportFormat) => {
        if (!window.cleanMyAgent) {
          toast.info('Export is available in the desktop app')
          return
        }
        const exportPath = await window.cleanMyAgent.exportSession(sessionId, format)
        toast.success(`Exported to ${exportPath}`)
      },
      exportUniversalRelay: async (sessionId: string) => {
        if (!window.cleanMyAgent) {
          toast.info('Universal relay export is available in the desktop app')
          return
        }
        const exportPath = await window.cleanMyAgent.exportUniversalRelay(sessionId)
        toast.success(`Universal JSON exported to ${exportPath}`)
      },
      moveCleanupToTrash: async (candidateIds: string[]) => {
        if (!window.cleanMyAgent) {
          toast.info('Trash cleanup is available in the desktop app')
          return
        }
        const records = await window.cleanMyAgent.moveCleanupToTrash(candidateIds)
        toast.success(`${records.length} cleanup item${records.length === 1 ? '' : 's'} moved to Trash`)
        await load(true)
      },
    }),
    [load],
  )

  return {
    snapshot,
    loading,
    usingMockData,
    ...actions,
  }
}
