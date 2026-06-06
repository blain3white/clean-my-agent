import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { defaultLanguage, languageOptions, normalizeLanguage, translate } from '@/lib/i18n'
import { mockSnapshot } from '@/lib/mock-data'
import {
  agentSources,
  type AppLanguage,
  type AgentSource,
  type AppSettings,
  type CleanupCandidate,
  type DashboardSnapshot,
  type ExportFormat,
} from '@/shared/types'

type DashboardState = {
  snapshot: DashboardSnapshot
  loading: boolean
  mockDataEnabled: boolean
  language: AppLanguage
  setMockDataEnabled: (enabled: boolean) => Promise<void>
  setLanguage: (language: AppLanguage) => Promise<void>
  rescan: () => Promise<void>
  refreshRecentSessions: () => Promise<void>
  backupSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  restoreArchive: (archiveId: string) => Promise<void>
  exportSession: (sessionId: string, format: ExportFormat) => Promise<void>
  exportUniversalRelay: (sessionId: string) => Promise<void>
  scanCleanup: () => Promise<CleanupCandidate[]>
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
  language: defaultLanguage,
  defaultRelayMode: 'full-context',
  exportDirectory: '',
})

const mergeSettings = (settings?: Partial<AppSettings>): AppSettings => ({
  ...defaultSettings(),
  ...settings,
  language: normalizeLanguage(settings?.language ?? defaultLanguage),
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
  archives: [],
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
    const language = normalizeLanguage(
      globalThis.localStorage?.getItem('clean-my-agent.language') ??
        globalThis.navigator?.language ??
        defaultLanguage,
    )
    return mergeSettings({ mockDataEnabled, language })
  })
  const [loading, setLoading] = useState(true)
  const t = useCallback(
    (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
      translate(settings.language, key, values),
    [settings.language],
  )

  useEffect(() => {
    let cancelled = false
    const hydrateSettings = async () => {
      if (!window.cleanMyAgent) return
      try {
        const next = await window.cleanMyAgent.getSettings()
        if (!cancelled) setSettings(mergeSettings(next))
      } catch (error) {
        console.error(error)
        toast.error(t('toast.readSettingsError'))
      }
    }
    void hydrateSettings()
    return () => {
      cancelled = true
    }
  }, [t])

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
        toast.error(t('toast.readLocalDataError'))
        setSnapshot(emptySnapshot())
      } finally {
        setLoading(false)
      }
    },
    [settings.mockDataEnabled, t],
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
            toast.error(t('toast.updateDemoError'))
            setSettings(settings)
            return
          }
        }

        if (enabled) {
          setSnapshot(mockSnapshot)
          setLoading(false)
          toast.success(t('toast.demoEnabled'))
        } else {
          toast.success(t('toast.liveEnabled'))
          setLoading(true)
          try {
            const next = window.cleanMyAgent
              ? await window.cleanMyAgent.getSnapshot()
              : emptySnapshot()
            setSnapshot(next)
          } catch (error) {
            console.error(error)
            toast.error(t('toast.readLocalDataError'))
            setSnapshot(emptySnapshot())
          } finally {
            setLoading(false)
          }
        }
      },
      setLanguage: async (language: AppLanguage) => {
        const nextSettings = mergeSettings({ ...settings, language })
        setSettings(nextSettings)
        globalThis.localStorage?.setItem('clean-my-agent.language', language)

        if (window.cleanMyAgent) {
          try {
            const persisted = await window.cleanMyAgent.updateSettings({ language })
            setSettings(mergeSettings(persisted))
          } catch (error) {
            console.error(error)
            toast.error(t('toast.updateLanguageError'))
            setSettings(settings)
            return
          }
        }

        const label = languageOptions.find((option) => option.value === language)?.nativeLabel
        toast.success(translate(language, 'toast.languageUpdated', { language: label ?? language }))
      },
      rescan: async () => {
        await load(true)
        toast.success(settings.mockDataEnabled ? t('toast.demoRefreshed') : t('toast.agentScanned'))
      },
      refreshRecentSessions: async () => {
        if (settings.mockDataEnabled) {
          setSnapshot(mockSnapshot)
          toast.success(t('toast.demoRefreshed'))
          return
        }

        if (!window.cleanMyAgent) {
          toast.info(t('toast.recentDesktopOnly'))
          return
        }

        setLoading(true)
        try {
          const next = await window.cleanMyAgent.refreshRecentSessions()
          setSnapshot(next)
          toast.success(t('toast.recentRefreshed'))
        } catch (error) {
          console.error(error)
          toast.error(t('toast.refreshRecentError'))
        } finally {
          setLoading(false)
        }
      },
      backupSession: async (sessionId: string) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.backupDesktopOnly'))
          return
        }
        const record = await window.cleanMyAgent.backupSession(sessionId)
        toast.success(t('toast.backupCreated', { title: record.title }))
        await load(false)
      },
      archiveSession: async (sessionId: string) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.archiveDesktopOnly'))
          return
        }
        const record = await window.cleanMyAgent.archiveSession(sessionId)
        toast.success(t('toast.archived', { title: record.title }))
        await load(false)
      },
      restoreArchive: async (archiveId: string) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.restoreDesktopOnly'))
          return
        }
        await window.cleanMyAgent.restoreArchive(archiveId)
        toast.success(t('toast.restored'))
        await load(true)
      },
      exportSession: async (sessionId: string, format: ExportFormat) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.exportDesktopOnly'))
          return
        }
        const exportPath = await window.cleanMyAgent.exportSession(sessionId, format)
        toast.success(t('toast.exported', { path: exportPath }))
      },
      exportUniversalRelay: async (sessionId: string) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.relayDesktopOnly'))
          return
        }
        const exportPath = await window.cleanMyAgent.exportUniversalRelay(sessionId)
        toast.success(t('toast.relayExported', { path: exportPath }))
      },
      scanCleanup: async () => {
        if (settings.mockDataEnabled || !window.cleanMyAgent) {
          return snapshot.cleanup
        }

        const cleanup = await window.cleanMyAgent.scanCleanup()
        setSnapshot((current) => ({
          ...current,
          cleanup,
          overview: {
            ...current.overview,
            reclaimableBytes: cleanup.reduce((total, item) => total + item.sizeBytes, 0),
            highRiskCleanupCount: cleanup.filter((item) => item.risk === 'high').length,
          },
        }))
        return cleanup
      },
      moveCleanupToTrash: async (candidateIds: string[]) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.trashDesktopOnly'))
          return
        }
        const records = await window.cleanMyAgent.moveCleanupToTrash(candidateIds)
        toast.success(
          t('toast.cleanupMoved', {
            count: records.length,
            plural: records.length === 1 ? '' : 's',
          }),
        )
        await load(true)
      },
    }),
    [load, settings, snapshot.cleanup, t],
  )

  return {
    snapshot,
    loading,
    mockDataEnabled: settings.mockDataEnabled,
    language: settings.language,
    ...actions,
  }
}
