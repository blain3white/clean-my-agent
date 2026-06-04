import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { mockSnapshot } from '@/lib/mock-data'
import {
  agentSources,
  type AgentSource,
  type AppSettings,
  type DashboardSnapshot,
  type ExportFormat,
} from '@/shared/types'

type DashboardState = {
  snapshot: DashboardSnapshot
  loading: boolean
  mockDataEnabled: boolean
  setMockDataEnabled: (enabled: boolean) => Promise<void>
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

const defaultSettings = (): AppSettings => ({
  scanRoots: {},
  cleanupRetentionDays: 30,
  trashRetentionDays: 14,
  autoBackup: true,
  mockDataEnabled: false,
  defaultRelayMode: 'full-context',
  exportDirectory: '',
})

const mergeSettings = (settings?: Partial<AppSettings>): AppSettings => ({
  ...defaultSettings(),
  ...settings,
  scanRoots: {
    ...defaultSettings().scanRoots,
    ...settings?.scanRoots,
  },
})

const emptySnapshot = (): DashboardSnapshot => ({
  generatedAt: new Date().toISOString(),
  overview: {
    totalSessions: 0,
    backedUpSessions: 0,
    reclaimableBytes: 0,
    totalTokens: 0,
    totalCostUsd: 0,
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
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() => emptySnapshot())
  const [settings, setSettings] = useState<AppSettings>(() => {
    const mockDataEnabled =
      globalThis.localStorage?.getItem('clean-my-agent.mockDataEnabled') === 'true'
    return mergeSettings({ mockDataEnabled })
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const hydrateSettings = async () => {
      if (!window.cleanMyAgent) return
      try {
        const next = await window.cleanMyAgent.getSettings()
        if (!cancelled) setSettings(mergeSettings(next))
      } catch (error) {
        console.error(error)
        toast.error('Could not read app settings.')
      }
    }
    void hydrateSettings()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (force = false) => {
      if (settings.mockDataEnabled) {
        setSnapshot(mockSnapshot)
        setLoading(false)
        return
      }

      if (!window.cleanMyAgent) {
        setSnapshot(emptySnapshot())
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const next = force
          ? await window.cleanMyAgent.rescan()
          : await window.cleanMyAgent.getSnapshot()
        setSnapshot(next)
      } catch (error) {
        console.error(error)
        toast.error('Could not read local agent data.')
        setSnapshot(emptySnapshot())
      } finally {
        setLoading(false)
      }
    },
    [settings.mockDataEnabled],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const actions = useMemo(
    () => ({
      setMockDataEnabled: async (enabled: boolean) => {
        const nextSettings = mergeSettings({ ...settings, mockDataEnabled: enabled })
        setSettings(nextSettings)
        globalThis.localStorage?.setItem('clean-my-agent.mockDataEnabled', String(enabled))

        if (window.cleanMyAgent) {
          try {
            const persisted = await window.cleanMyAgent.updateSettings({ mockDataEnabled: enabled })
            setSettings(mergeSettings(persisted))
          } catch (error) {
            console.error(error)
            toast.error('Could not update demo data setting.')
            setSettings(settings)
            return
          }
        }

        if (enabled) {
          setSnapshot(mockSnapshot)
          setLoading(false)
          toast.success('Demo data enabled')
        } else {
          toast.success('Live local data enabled')
          setLoading(true)
          try {
            const next = window.cleanMyAgent
              ? await window.cleanMyAgent.getSnapshot()
              : emptySnapshot()
            setSnapshot(next)
          } catch (error) {
            console.error(error)
            toast.error('Could not read local agent data.')
            setSnapshot(emptySnapshot())
          } finally {
            setLoading(false)
          }
        }
      },
      rescan: async () => {
        await load(true)
        toast.success(settings.mockDataEnabled ? 'Demo data refreshed' : 'Agent data scanned')
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
        toast.success(
          `${records.length} cleanup item${records.length === 1 ? '' : 's'} moved to Trash`,
        )
        await load(true)
      },
    }),
    [load, settings],
  )

  return {
    snapshot,
    loading,
    mockDataEnabled: settings.mockDataEnabled,
    ...actions,
  }
}
