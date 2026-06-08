import { lazy, Suspense, useMemo, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from '@/app/Sidebar'
import { Topbar } from '@/app/Topbar'
import type { ViewId } from '@/app/navigation'
import { exportUsageCsv } from '@/features/usage/usage-analytics'
import type { UsagePageRange, UsageRange } from '@/features/usage/ranges'
import { useDashboard } from '@/hooks/use-dashboard'
import { useTheme } from '@/hooks/use-theme'
import { I18nProvider } from '@/lib/i18n-provider'
import './App.css'

const CleanupView = lazy(() =>
  import('@/features/cleanup/CleanupView').then((module) => ({ default: module.CleanupView })),
)
const HealthView = lazy(() =>
  import('@/features/health/HealthView').then((module) => ({ default: module.HealthView })),
)
const OverviewView = lazy(() =>
  import('@/features/overview/OverviewView').then((module) => ({ default: module.OverviewView })),
)
const RelayView = lazy(() =>
  import('@/features/relay/RelayView').then((module) => ({ default: module.RelayView })),
)
const SessionsView = lazy(() =>
  import('@/features/sessions/SessionsView').then((module) => ({ default: module.SessionsView })),
)
const SettingsView = lazy(() =>
  import('@/features/settings/SettingsView').then((module) => ({ default: module.SettingsView })),
)
const SkillsView = lazy(() =>
  import('@/features/skills/SkillsView').then((module) => ({ default: module.SkillsView })),
)
const UsageView = lazy(() =>
  import('@/features/usage/UsageView').then((module) => ({ default: module.UsageView })),
)

const viewFallback = (
  <div className="flex min-h-[320px] items-center justify-center text-sm text-white/45">
    Loading...
  </div>
)

function App() {
  const [activeView, setActiveView] = useState<ViewId>('overview')
  const [overviewRange, setOverviewRange] = useState<UsageRange>(30)
  const [usageRange, setUsageRange] = useState<UsagePageRange>('7d')
  const [sessionProjectQuery, setSessionProjectQuery] = useState('')
  const dashboard = useDashboard()
  const theme = useTheme()

  const content = useMemo(() => {
    switch (activeView) {
      case 'overview':
        return (
          <OverviewView
            snapshot={dashboard.snapshot}
            usageRange={overviewRange}
            loading={dashboard.loading}
            onRefresh={dashboard.refreshRecentSessions}
            onSelectCleanup={() => setActiveView('cleanup')}
          />
        )
      case 'sessions':
        return (
          <SessionsView
            key={sessionProjectQuery || 'all-sessions'}
            sessions={dashboard.snapshot.sessions}
            archives={dashboard.snapshot.archives}
            initialQuery={sessionProjectQuery}
            onBackup={dashboard.backupSession}
            onArchive={dashboard.archiveSession}
            onRestoreArchive={dashboard.restoreArchive}
            onExport={(id) => dashboard.exportSession(id, 'markdown')}
            onRelay={dashboard.exportUniversalRelay}
            onSessionDetail={dashboard.getSessionDetail}
          />
        )
      case 'cleanup':
        return (
          <CleanupView
            cleanup={dashboard.snapshot.cleanup}
            agents={dashboard.snapshot.agents}
            sessions={dashboard.snapshot.sessions}
            settings={dashboard.settings}
            onScanCleanup={dashboard.scanCleanup}
            onMoveToTrash={dashboard.moveCleanupToTrash}
          />
        )
      case 'skills':
        return <SkillsView />
      case 'usage':
        return (
          <UsageView
            snapshot={dashboard.snapshot}
            range={usageRange}
            loading={dashboard.loading}
            onSelectProject={(project) => {
              setSessionProjectQuery(project?.projectPath ?? project?.project ?? '')
              setActiveView('sessions')
            }}
          />
        )
      case 'relay':
        return (
          <RelayView
            sessions={dashboard.snapshot.sessions}
            onRelay={dashboard.exportUniversalRelay}
          />
        )
      case 'health':
        return <HealthView snapshot={dashboard.snapshot} />
      case 'settings':
        return (
          <SettingsView
            snapshot={dashboard.snapshot}
            language={dashboard.language}
            themePreference={theme.preference}
            launchAtLogin={dashboard.launchAtLogin}
            mockDataEnabled={dashboard.mockDataEnabled}
            settings={dashboard.settings}
            checkingForUpdates={dashboard.checkingForUpdates}
            onLanguageChange={dashboard.setLanguage}
            onThemePreferenceChange={theme.setPreference}
            onLaunchAtLoginChange={dashboard.setLaunchAtLogin}
            onMockDataChange={dashboard.setMockDataEnabled}
            onSettingsChange={dashboard.updateSettings}
            onChooseFolders={dashboard.chooseFolders}
            onDownloadLatestUpdate={dashboard.downloadLatestUpdate}
            onRescan={dashboard.rescan}
            onRestoreTrash={dashboard.restoreTrash}
            onPurgeExpiredTrash={dashboard.purgeExpiredTrash}
          />
        )
      default:
        return null
    }
  }, [
    activeView,
    dashboard,
    overviewRange,
    sessionProjectQuery,
    theme.preference,
    theme.setPreference,
    usageRange,
  ])

  return (
    <I18nProvider language={dashboard.language}>
      <TooltipProvider>
        <div
          className={`mac-window theme-${theme.resolvedTheme} flex h-screen overflow-hidden text-white`}
        >
          <Sidebar
            activeView={activeView}
            setActiveView={setActiveView}
            snapshot={dashboard.snapshot}
          />
          <main className="main-surface soft-grid flex min-w-0 flex-1 flex-col">
            <Topbar
              activeView={activeView}
              loading={dashboard.loading}
              mockDataEnabled={dashboard.mockDataEnabled}
              overviewRange={overviewRange}
              usageRange={usageRange}
              resolvedTheme={theme.resolvedTheme}
              onThemeToggle={() =>
                theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark')
              }
              onOverviewRangeChange={setOverviewRange}
              onUsageRangeChange={setUsageRange}
              onUsageExport={() => exportUsageCsv(dashboard.snapshot, usageRange)}
              onRescan={dashboard.rescan}
            />
            <div
              className={`content-scroll no-drag-region min-h-0 min-w-0 flex-1 ${
                activeView === 'cleanup' ? 'overflow-hidden' : 'overflow-auto'
              }`}
            >
              <div
                className={
                  activeView === 'cleanup'
                    ? 'cleanup-app-panel h-full min-w-0'
                    : 'min-w-[1120px] p-5'
                }
              >
                <Suspense fallback={viewFallback}>{content}</Suspense>
              </div>
            </div>
          </main>
        </div>
        <Toaster theme={theme.resolvedTheme} position="top-right" />
      </TooltipProvider>
    </I18nProvider>
  )
}

export default App
