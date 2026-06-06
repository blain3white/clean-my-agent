import { useMemo, useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from '@/app/Sidebar'
import { Topbar } from '@/app/Topbar'
import type { ViewId } from '@/app/navigation'
import { CleanupView } from '@/features/cleanup/CleanupView'
import { HealthView } from '@/features/health/HealthView'
import { OverviewView } from '@/features/overview/OverviewView'
import { RelayView } from '@/features/relay/RelayView'
import { SessionsView } from '@/features/sessions/SessionsView'
import { SettingsView } from '@/features/settings/SettingsView'
import { UsageView } from '@/features/usage/UsageView'
import { exportUsageCsv } from '@/features/usage/usage-analytics'
import type { UsagePageRange, UsageRange } from '@/features/usage/ranges'
import { useDashboard } from '@/hooks/use-dashboard'
import { useTheme } from '@/hooks/use-theme'
import { I18nProvider } from '@/lib/i18n-provider'
import './App.css'

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
                {content}
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
