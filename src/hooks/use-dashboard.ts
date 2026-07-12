import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type RecoveryRecord,
  type UniversalRelayDocument,
} from '@/shared/types'
import { loadSessionDetail } from './session-detail-api'

export type DashboardIssueKind =
  | 'scan-failed'
  | 'refresh-failed'
  | 'update-failed'
  | 'network-failed'

export type DashboardIssue = {
  kind: DashboardIssueKind
  detail: string
  occurredAt: string
}

type DashboardState = {
  snapshot: DashboardSnapshot
  loading: boolean
  lastIssue: DashboardIssue | null
  settings: AppSettings
  mockDataEnabled: boolean
  language: AppLanguage
  launchAtLogin: boolean
  checkingForUpdates: boolean
  updateSettings: (
    patch: Partial<AppSettings>,
    options?: { rescan?: boolean },
  ) => Promise<AppSettings>
  chooseFolders: () => Promise<string[]>
  checkForUpdates: () => Promise<void>
  setMockDataEnabled: (enabled: boolean) => Promise<void>
  setLanguage: (language: AppLanguage) => Promise<void>
  setLaunchAtLogin: (enabled: boolean) => Promise<void>
  downloadLatestUpdate: () => Promise<void>
  rescan: () => Promise<void>
  refreshRecentSessions: () => Promise<void>
  getSessionDetail: (sessionId: string) => Promise<UniversalRelayDocument>
  backupSession: (sessionId: string) => Promise<void>
  archiveSession: (sessionId: string) => Promise<void>
  restoreArchive: (archiveId: string) => Promise<void>
  exportSession: (sessionId: string, format: ExportFormat) => Promise<void>
  exportUniversalRelay: (sessionId: string) => Promise<void>
  exportDiagnostics: () => Promise<void>
  scanCleanup: () => Promise<CleanupCandidate[]>
  moveCleanupToTrash: (candidateIds: string[]) => Promise<void>
  restoreTrash: (trashId: string) => Promise<void>
  purgeExpiredTrash: () => Promise<void>
  diagnoseRecovery: (recoveryId: string) => Promise<RecoveryRecord | undefined>
  undoRecovery: (recoveryId: string) => Promise<void>
}

const agentNames: Record<AgentSource, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  pi: 'Pi',
  custom: 'Custom',
}

const defaultUsageTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const defaultSettings = (): AppSettings => ({
  scanRoots: {},
  cleanupRetentionDays: 7,
  trashRetentionDays: 14,
  autoBackup: true,
  mockDataEnabled: false,
  language: defaultLanguage,
  usageTimezone: defaultUsageTimezone(),
  launchAtLogin: false,
  enabledProviders: Object.fromEntries(
    agentSources.map((source) => [source, true]),
  ) as AppSettings['enabledProviders'],
  scanOnLaunch: true,
  backgroundScan: true,
  confirmBeforeCleanup: true,
  excludedFolders: [],
  soundEffects: true,
  cleanupSound: true,
  scanSound: false,
  errorSound: true,
  soundVolume: 35,
  checkForUpdates: true,
  defaultRelayMode: 'full-context',
  exportDirectory: '',
  worktreeRoots: [],
  worktreeScanDefaultRoots: true,
  worktreeRetentionDays: 30,
})

const mergeSettings = (settings?: Partial<AppSettings>): AppSettings => ({
  ...defaultSettings(),
  ...settings,
  language: normalizeLanguage(settings?.language ?? defaultLanguage),
  scanRoots: {
    ...defaultSettings().scanRoots,
    ...settings?.scanRoots,
  },
  enabledProviders: {
    ...defaultSettings().enabledProviders,
    ...settings?.enabledProviders,
  },
  excludedFolders: Array.isArray(settings?.excludedFolders) ? settings.excludedFolders : [],
  soundVolume: Math.min(
    100,
    Math.max(0, Number.isFinite(settings?.soundVolume) ? Number(settings?.soundVolume) : 35),
  ),
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
  recovery: [],
  usage: [],
  storage: [],
  worktrees: [],
})

const errorMessage = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
  const cleaned = message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
    .trim()
  return cleaned || 'Unknown error'
}

const isNetworkFailure = (error: unknown): boolean =>
  /(network|fetch|offline|timeout|timed out|econn|enotfound|eai_again|etimedout|socket|tls|proxy|rate limit|too many requests|429)/i.test(
    errorMessage(error),
  )

const updateIssueKind = (error: unknown): DashboardIssueKind =>
  isNetworkFailure(error) ? 'network-failed' : 'update-failed'

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
  const [checkingForUpdates, setCheckingForUpdates] = useState(false)
  const [lastIssue, setLastIssue] = useState<DashboardIssue | null>(null)
  const t = useCallback(
    (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
      translate(settings.language, key, values),
    [settings.language],
  )
  const languageRef = useRef(settings.language)

  useEffect(() => {
    languageRef.current = settings.language
  }, [settings.language])

  useEffect(() => {
    let cancelled = false
    const hydrateSettings = async () => {
      if (!window.cleanMyAgent) return
      try {
        const next = await window.cleanMyAgent.getSettings()
        let launchAtLogin = next.launchAtLogin
        try {
          launchAtLogin = await window.cleanMyAgent.getLaunchAtLogin()
        } catch (error) {
          console.error(error)
        }
        if (!cancelled) setSettings(mergeSettings({ ...next, launchAtLogin }))
      } catch (error) {
        console.error(error)
        toast.error(translate(languageRef.current, 'toast.readSettingsError'))
      }
    }
    void hydrateSettings()
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (force = false): Promise<boolean> => {
      if (settings.mockDataEnabled) {
        setSnapshot(mockSnapshot)
        setLoading(false)
        setLastIssue(null)
        return true
      }

      if (!window.cleanMyAgent) {
        setSnapshot(emptySnapshot())
        setLoading(false)
        return true
      }

      setLoading(true)
      try {
        const next = force
          ? await window.cleanMyAgent.rescan()
          : await window.cleanMyAgent.getSnapshot()
        setSnapshot(next)
        setLastIssue((current) =>
          current?.kind === 'scan-failed' || current?.kind === 'refresh-failed' ? null : current,
        )
        return true
      } catch (error) {
        console.error(error)
        toast.error(t('toast.readLocalDataError'))
        setLastIssue({
          kind: 'scan-failed',
          detail: errorMessage(error),
          occurredAt: new Date().toISOString(),
        })
        setSnapshot(emptySnapshot())
        return false
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

  useEffect(() => {
    if (!settings.backgroundScan || settings.mockDataEnabled || !window.cleanMyAgent) return
    const timer = window.setInterval(
      () => {
        void window.cleanMyAgent
          ?.refreshRecentSessions()
          .then((next) => {
            setSnapshot(next)
            setLastIssue((current) => (current?.kind === 'refresh-failed' ? null : current))
          })
          .catch((error) => {
            console.error(error)
            setLastIssue({
              kind: 'refresh-failed',
              detail: errorMessage(error),
              occurredAt: new Date().toISOString(),
            })
            if (settings.soundEffects && settings.errorSound) {
              void import('@/features/cleanup/cleanup-system-sound').then(
                ({ playCleanupSystemSound }) => playCleanupSystemSound(settings.soundVolume / 100),
              )
            }
          })
      },
      5 * 60 * 1000,
    )
    return () => window.clearInterval(timer)
  }, [
    settings.backgroundScan,
    settings.errorSound,
    settings.mockDataEnabled,
    settings.soundEffects,
    settings.soundVolume,
  ])

  useEffect(() => {
    if (!settings.checkForUpdates || !window.cleanMyAgent) return
    void window.cleanMyAgent.checkForUpdates().catch((error) => {
      console.error(error)
    })
  }, [settings.checkForUpdates])

  const runUpdateCheck = useCallback(async () => {
    if (!window.cleanMyAgent) {
      toast.info(t('toast.updateCheckDesktopOnly'))
      return
    }

    setCheckingForUpdates(true)
    try {
      const result = await window.cleanMyAgent.checkForUpdates()
      setLastIssue((current) =>
        current?.kind === 'update-failed' || current?.kind === 'network-failed' ? null : current,
      )
      if (result.available) {
        toast.success(
          t('toast.updateAvailable', {
            version: result.latestVersion,
          }),
        )
        return
      }
      toast.success(
        t('toast.noUpdateAvailable', {
          version: result.currentVersion,
        }),
      )
    } catch (error) {
      console.error(error)
      setLastIssue({
        kind: updateIssueKind(error),
        detail: errorMessage(error),
        occurredAt: new Date().toISOString(),
      })
      toast.error(t('toast.updateCheckError'))
    } finally {
      setCheckingForUpdates(false)
    }
  }, [t])

  const runUpdateDownload = useCallback(async () => {
    if (!window.cleanMyAgent) {
      toast.info(t('toast.updateDesktopOnly'))
      return
    }

    setCheckingForUpdates(true)
    try {
      const result = await window.cleanMyAgent.downloadLatestUpdate()
      setLastIssue((current) =>
        current?.kind === 'update-failed' || current?.kind === 'network-failed' ? null : current,
      )
      if (!result.available) {
        toast.success(
          t('toast.noUpdateAvailable', {
            version: result.currentVersion,
          }),
        )
        return
      }

      if (!result.downloadedPath) {
        toast.info(
          t('toast.updateAvailableNoAsset', {
            version: result.latestVersion,
          }),
        )
        return
      }

      toast.success(
        t('toast.updateDownloaded', {
          version: result.latestVersion,
          path: result.downloadedPath,
        }),
      )
      await window.cleanMyAgent.openPath(result.downloadedPath)
    } catch (error) {
      console.error(error)
      setLastIssue({
        kind: updateIssueKind(error),
        detail: errorMessage(error),
        occurredAt: new Date().toISOString(),
      })
      toast.error(t('toast.updateCheckError'))
    } finally {
      setCheckingForUpdates(false)
    }
  }, [t])

  const actions = useMemo(
    () => ({
      updateSettings: async (
        patch: Partial<AppSettings>,
        options: { rescan?: boolean } = {},
      ): Promise<AppSettings> => {
        const optimistic = mergeSettings({
          ...settings,
          ...patch,
          scanRoots: {
            ...settings.scanRoots,
            ...patch.scanRoots,
          },
          enabledProviders: {
            ...settings.enabledProviders,
            ...patch.enabledProviders,
          },
        })
        setSettings(optimistic)
        if (patch.mockDataEnabled !== undefined) {
          globalThis.localStorage?.setItem(
            'clean-my-agent.mockDataEnabled',
            String(patch.mockDataEnabled),
          )
        }
        if (patch.language) {
          globalThis.localStorage?.setItem('clean-my-agent.language', patch.language)
        }

        try {
          const persisted = window.cleanMyAgent
            ? await window.cleanMyAgent.updateSettings(patch)
            : optimistic
          const nextSettings = mergeSettings(persisted)
          setSettings(nextSettings)
          if (options.rescan && !nextSettings.mockDataEnabled) await load(true)
          return nextSettings
        } catch (error) {
          console.error(error)
          toast.error(t('toast.updateSettingsError'))
          setSettings(settings)
          throw error
        }
      },
      chooseFolders: async () => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.folderPickerDesktopOnly'))
          return []
        }
        return window.cleanMyAgent.chooseFolders()
      },
      checkForUpdates: runUpdateCheck,
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
          setLastIssue(null)
          toast.success(t('toast.demoEnabled'))
        } else {
          toast.success(t('toast.liveEnabled'))
          setLoading(true)
          try {
            const next = window.cleanMyAgent
              ? await window.cleanMyAgent.getSnapshot()
              : emptySnapshot()
            setSnapshot(next)
            setLastIssue((current) => (current?.kind === 'scan-failed' ? null : current))
          } catch (error) {
            console.error(error)
            toast.error(t('toast.readLocalDataError'))
            setLastIssue({
              kind: 'scan-failed',
              detail: errorMessage(error),
              occurredAt: new Date().toISOString(),
            })
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
      setLaunchAtLogin: async (enabled: boolean) => {
        const nextSettings = mergeSettings({ ...settings, launchAtLogin: enabled })
        setSettings(nextSettings)

        try {
          const actual = window.cleanMyAgent
            ? await window.cleanMyAgent.setLaunchAtLogin(enabled)
            : enabled
          const persisted = window.cleanMyAgent
            ? await window.cleanMyAgent.updateSettings({ launchAtLogin: actual })
            : mergeSettings({ ...nextSettings, launchAtLogin: actual })
          setSettings(mergeSettings(persisted))
          toast.success(t(actual ? 'toast.launchAtLoginEnabled' : 'toast.launchAtLoginDisabled'))
        } catch (error) {
          console.error(error)
          toast.error(t('toast.updateLaunchAtLoginError'))
          setSettings(settings)
        }
      },
      downloadLatestUpdate: runUpdateDownload,
      rescan: async () => {
        const didScan = await load(true)
        if (!didScan) return
        if (!settings.mockDataEnabled && settings.soundEffects && settings.scanSound) {
          const { playCleanupSystemSound } = await import('@/features/cleanup/cleanup-system-sound')
          await playCleanupSystemSound(settings.soundVolume / 100)
        }
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
          setLastIssue((current) => (current?.kind === 'refresh-failed' ? null : current))
          if (settings.soundEffects && settings.scanSound) {
            const { playCleanupSystemSound } =
              await import('@/features/cleanup/cleanup-system-sound')
            await playCleanupSystemSound(settings.soundVolume / 100)
          }
          toast.success(t('toast.recentRefreshed'))
        } catch (error) {
          console.error(error)
          setLastIssue({
            kind: 'refresh-failed',
            detail: errorMessage(error),
            occurredAt: new Date().toISOString(),
          })
          if (settings.soundEffects && settings.errorSound) {
            const { playCleanupSystemSound } =
              await import('@/features/cleanup/cleanup-system-sound')
            await playCleanupSystemSound(settings.soundVolume / 100)
          }
          toast.error(t('toast.refreshRecentError'))
        } finally {
          setLoading(false)
        }
      },
      getSessionDetail: async (sessionId: string) => {
        return loadSessionDetail(
          window.cleanMyAgent,
          sessionId,
          settings.language,
          settings.mockDataEnabled,
        )
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
      exportDiagnostics: async () => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.diagnosticsDesktopOnly'))
          return
        }

        try {
          const exportPath = await window.cleanMyAgent.exportDiagnostics()
          toast.success(t('toast.diagnosticsExported', { path: exportPath }))
        } catch (error) {
          console.error(error)
          toast.error(t('toast.diagnosticsExportError'))
        }
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
      restoreTrash: async (trashId: string) => {
        if (settings.mockDataEnabled) {
          toast.info(t('toast.trashRestoreLiveOnly'))
          return
        }

        if (!window.cleanMyAgent) {
          toast.info(t('toast.trashDesktopOnly'))
          return
        }

        try {
          const restoredKind = await window.cleanMyAgent.restoreTrash(trashId)
          if (restoredKind === 'stale-worktree' || restoredKind === 'dirty-worktree') {
            toast.success(t('toast.worktreeRestored'))
          } else {
            toast.success(t('toast.trashRestored'))
          }
          await load(true)
        } catch (error) {
          console.error(error)
          toast.error(t('toast.trashRestoreError'))
        }
      },
      purgeExpiredTrash: async () => {
        if (settings.mockDataEnabled) {
          toast.info(t('toast.trashPurgeLiveOnly'))
          return
        }

        if (!window.cleanMyAgent) {
          toast.info(t('toast.trashDesktopOnly'))
          return
        }

        try {
          const records = await window.cleanMyAgent.purgeExpiredTrash()
          toast.success(
            t('toast.trashPurged', {
              count: records.length,
              plural: records.length === 1 ? '' : 's',
            }),
          )
          await load(false)
        } catch (error) {
          console.error(error)
          toast.error(t('toast.trashPurgeError'))
        }
      },
      diagnoseRecovery: async (recoveryId: string) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.recoveryDesktopOnly'))
          return undefined
        }

        try {
          const record = await window.cleanMyAgent.diagnoseRecovery(recoveryId)
          setSnapshot((current) => ({
            ...current,
            recovery: current.recovery.map((item) => (item.id === record.id ? record : item)),
          }))
          toast.success(t('toast.recoveryDiagnosed'))
          return record
        } catch (error) {
          console.error(error)
          toast.error(t('toast.recoveryDiagnoseError'))
          return undefined
        }
      },
      undoRecovery: async (recoveryId: string) => {
        if (!window.cleanMyAgent) {
          toast.info(t('toast.recoveryDesktopOnly'))
          return
        }

        try {
          await window.cleanMyAgent.undoRecovery(recoveryId)
          toast.success(t('toast.recoveryUndoComplete'))
          await load(true)
        } catch (error) {
          console.error(error)
          toast.error(t('toast.recoveryUndoError'))
        }
      },
    }),
    [load, runUpdateCheck, runUpdateDownload, settings, snapshot.cleanup, t],
  )

  return {
    snapshot,
    loading,
    lastIssue,
    settings,
    mockDataEnabled: settings.mockDataEnabled,
    language: settings.language,
    launchAtLogin: settings.launchAtLogin,
    checkingForUpdates,
    ...actions,
  }
}
