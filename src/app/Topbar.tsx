import { Download, Loader2, Moon, RefreshCcw, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { navItems, type ViewId } from '@/app/navigation'
import { UsagePageRangeControl, UsageRangeControl } from '@/features/usage/range-controls'
import type { UsagePageRange, UsageRange } from '@/features/usage/ranges'
import { useI18n } from '@/lib/i18n-context'

export function Topbar({
  activeView,
  loading,
  mockDataEnabled,
  overviewRange,
  usageRange,
  resolvedTheme,
  onThemeToggle,
  onOverviewRangeChange,
  onUsageRangeChange,
  onUsageExport,
  onRescan,
}: {
  activeView: ViewId
  loading: boolean
  mockDataEnabled: boolean
  overviewRange: UsageRange
  usageRange: UsagePageRange
  resolvedTheme: 'light' | 'dark'
  onThemeToggle: () => void
  onOverviewRangeChange: (range: UsageRange) => void
  onUsageRangeChange: (range: UsagePageRange) => void
  onUsageExport: () => void
  onRescan: () => Promise<void>
}) {
  const { t } = useI18n()
  const titleKey = navItems.find((item) => item.id === activeView)?.labelKey ?? 'nav.overview'
  const ThemeIcon = resolvedTheme === 'dark' ? Sun : Moon
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
  const nextThemeLabel = t(nextTheme === 'light' ? 'theme.light' : 'theme.dark')
  const subtitle =
    activeView === 'usage'
      ? t('topbar.usageSubtitle')
      : activeView === 'cleanup'
        ? t('topbar.cleanupSubtitle')
        : activeView === 'skills'
          ? t('topbar.skillsSubtitle')
          : mockDataEnabled
            ? t('topbar.demoSubtitle')
            : t('topbar.localSubtitle')

  return (
    <header className="drag-region flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-7">
      <div>
        <h1 className="text-xl font-semibold text-white">{t(titleKey)}</h1>
        <p className="mt-0.5 text-xs text-white/42">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {mockDataEnabled && (
          <Badge
            variant="outline"
            className="border-violet-300/20 bg-violet-400/10 text-violet-200"
          >
            {t('topbar.demo')}
          </Badge>
        )}
        {activeView === 'overview' && (
          <UsageRangeControl value={overviewRange} onChange={onOverviewRangeChange} />
        )}
        {activeView === 'usage' && (
          <>
            <UsagePageRangeControl value={usageRange} onChange={onUsageRangeChange} />
            <Button
              variant="outline"
              size="sm"
              onClick={onUsageExport}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              <Download className="size-3.5" />
              {t('topbar.export')}
            </Button>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={onThemeToggle}
              aria-label={t('topbar.switchTheme', { theme: nextThemeLabel })}
              className="theme-toggle border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <ThemeIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('topbar.switchTheme', { theme: nextThemeLabel })}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void onRescan()}
              disabled={loading}
              className="border-white/10 bg-white/5 text-white hover:bg-white/10"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCcw className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('topbar.rescan')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
