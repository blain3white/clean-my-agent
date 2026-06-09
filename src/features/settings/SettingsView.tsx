import { useMemo, type ReactNode } from 'react'
import {
  AlertTriangle,
  Bell,
  Clock3,
  Download,
  FileJson,
  Folder,
  FolderX,
  Languages,
  Palette,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Globe2,
  Volume2,
  WifiOff,
  type LucideIcon,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { playCleanupSystemSound } from '@/features/cleanup/cleanup-system-sound'
import { trashPrimaryPath, usageTimezoneSelectOptions } from '@/features/settings/settings-model'
import { agentLabel, formatBytes } from '@/lib/format'
import { languageOptions } from '@/lib/i18n'
import { useI18n } from '@/lib/i18n-context'
import type { AppSettings, ThemePreference } from '@/shared/types'
import type { TranslationKey } from '@/lib/i18n'
import type { DashboardIssue } from '@/hooks/use-dashboard'
import {
  agentSources,
  type AgentSource,
  type AppLanguage,
  type DashboardSnapshot,
} from '@/shared/types'

type SettingsViewProps = {
  snapshot: DashboardSnapshot
  language: AppLanguage
  themePreference: ThemePreference
  launchAtLogin: boolean
  mockDataEnabled: boolean
  settings: AppSettings
  lastIssue: DashboardIssue | null
  checkingForUpdates: boolean
  onLanguageChange: (language: AppLanguage) => Promise<void>
  onThemePreferenceChange: (preference: ThemePreference) => void
  onLaunchAtLoginChange: (enabled: boolean) => Promise<void>
  onMockDataChange: (enabled: boolean) => Promise<void>
  onSettingsChange: (
    patch: Partial<AppSettings>,
    options?: { rescan?: boolean },
  ) => Promise<AppSettings>
  onChooseFolders: () => Promise<string[]>
  onDownloadLatestUpdate: () => Promise<void>
  onExportDiagnostics: () => Promise<void>
  onRescan: () => Promise<void>
  onRestoreTrash: (trashId: string) => Promise<void>
  onPurgeExpiredTrash: () => Promise<void>
}
const themeOptions: Array<{ value: ThemePreference; labelKey: TranslationKey }> = [
  { value: 'system', labelKey: 'theme.system' },
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
]
function latestScanValue(snapshot: DashboardSnapshot): string | undefined {
  const latest = snapshot.agents
    .map((agent) => agent.lastScannedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

  return latest
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="settings-section-title px-0.5 text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="settings-panel overflow-hidden rounded-xl border">{children}</div>
}

function SettingsRow({
  icon: Icon,
  title,
  description,
  trailing,
  children,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  trailing?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="settings-row group flex min-h-[64px] items-center gap-4 border-b px-5 py-3 last:border-b-0">
      {Icon ? (
        <div className="settings-row-icon grid size-6 shrink-0 place-items-center">
          <Icon className="size-[19px]" />
        </div>
      ) : (
        <div className="size-6 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="settings-row-title truncate text-[15px] font-medium">{title}</div>
        {description && (
          <div className="settings-row-description mt-1 truncate text-sm">{description}</div>
        )}
        {children}
      </div>
      {trailing && <div className="flex shrink-0 items-center justify-end gap-3">{trailing}</div>}
    </div>
  )
}

function SwitchControl({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="settings-switch data-checked:bg-blue-500"
      aria-label={label}
      disabled={disabled}
    />
  )
}

function ValueButton({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="settings-value-button inline-flex h-8 min-w-28 items-center justify-between gap-3 rounded-lg border px-3 text-sm transition"
    >
      <span>{children}</span>
    </button>
  )
}

function NativeSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <select
      aria-label={label}
      className="settings-native-select h-8 min-w-36 appearance-auto rounded-lg border px-3 text-sm outline-none transition focus:border-blue-400/70 focus:ring-2 focus:ring-blue-400/25"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="settings-native-option">
          {option.label}
        </option>
      ))}
    </select>
  )
}

function ProviderStatus({
  detected,
  enabled,
  label,
}: {
  detected: boolean
  enabled: boolean
  label: string
}) {
  const color = !enabled
    ? 'settings-provider-dot-disabled'
    : detected
      ? 'settings-provider-dot-detected'
      : 'settings-provider-dot-warning'

  return (
    <span className="settings-provider-status flex min-w-28 items-center gap-2 text-sm">
      <span className={`size-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function settingsIssueCopy(issue: DashboardIssue): {
  icon: LucideIcon
  titleKey: TranslationKey
  bodyKey: TranslationKey
} {
  if (issue.kind === 'network-failed') {
    return {
      icon: WifiOff,
      titleKey: 'settings.issueNetworkTitle',
      bodyKey: 'settings.issueNetworkBody',
    }
  }
  if (issue.kind === 'update-failed') {
    return {
      icon: Download,
      titleKey: 'settings.issueUpdateTitle',
      bodyKey: 'settings.issueUpdateBody',
    }
  }
  if (issue.kind === 'refresh-failed') {
    return {
      icon: RefreshCcw,
      titleKey: 'settings.issueRefreshTitle',
      bodyKey: 'settings.issueRefreshBody',
    }
  }
  return {
    icon: AlertTriangle,
    titleKey: 'settings.issueScanTitle',
    bodyKey: 'settings.issueScanBody',
  }
}

function SettingsIssueBanner({
  issue,
  checkingForUpdates,
  formatRelative,
  t,
  onRetry,
}: {
  issue: DashboardIssue
  checkingForUpdates: boolean
  formatRelative: (value?: string) => string
  t: (key: TranslationKey) => string
  onRetry: () => void
}) {
  const copy = settingsIssueCopy(issue)
  const Icon = copy.icon

  return (
    <div className="settings-issue-banner flex items-start gap-3 rounded-xl border px-4 py-3">
      <div className="settings-issue-icon grid size-9 shrink-0 place-items-center rounded-lg ring-1">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="settings-row-title text-[15px] font-semibold">{t(copy.titleKey)}</div>
        <div className="settings-row-description mt-1 text-sm">{t(copy.bodyKey)}</div>
        <div className="mt-2 truncate text-xs text-white/38">
          {formatRelative(issue.occurredAt)} · {issue.detail}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={checkingForUpdates}
        className="settings-outline-button"
      >
        {checkingForUpdates ? t('settings.checkingUpdates') : t('settings.issueRetry')}
      </Button>
    </div>
  )
}

export function SettingsView({
  snapshot,
  language,
  themePreference,
  launchAtLogin,
  mockDataEnabled,
  settings,
  lastIssue,
  checkingForUpdates,
  onLanguageChange,
  onThemePreferenceChange,
  onLaunchAtLoginChange,
  onMockDataChange,
  onSettingsChange,
  onChooseFolders,
  onDownloadLatestUpdate,
  onExportDiagnostics,
  onRescan,
  onRestoreTrash,
  onPurgeExpiredTrash,
}: SettingsViewProps) {
  const { formatRelative, t } = useI18n()
  const scanLabel = useMemo(
    () => formatRelative(latestScanValue(snapshot)),
    [formatRelative, snapshot],
  )
  const agentBySource = useMemo(
    () => new Map(snapshot.agents.map((agent) => [agent.source, agent])),
    [snapshot.agents],
  )
  const providerSources = useMemo(
    () =>
      agentSources.filter(
        (source) =>
          source !== 'custom' ||
          (settings.scanRoots.custom?.length ?? 0) > 0 ||
          (agentBySource.get('custom')?.sessionCount ?? 0) > 0,
      ),
    [agentBySource, settings.scanRoots.custom],
  )

  const setProvider = (source: AgentSource, enabled: boolean) =>
    onSettingsChange({ enabledProviders: { [source]: enabled } }, { rescan: true })

  const providerStatusLabel = (detected: boolean, enabled: boolean) => {
    if (!enabled) return t('settings.providerDisabled')
    return detected ? t('settings.providerDetected') : t('settings.providerNotFound')
  }

  const providerToggleLabel = (source: AgentSource) =>
    t('settings.toggleProvider', { provider: agentLabel[source] })

  const toggleLabel = (key: TranslationKey) => t(key)
  const languageSelectOptions = languageOptions.map((option) => ({
    value: option.value,
    label: option.nativeLabel,
  }))
  const themeSelectOptions = themeOptions.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }))
  const timezoneSelectOptions = usageTimezoneSelectOptions(settings.usageTimezone)
  const retentionOptions = ['0', '7', '14', '30', '60', '90'].map((value) => ({
    value,
    label: t('settings.daysValue', { days: value }),
  }))
  const excludedCount = settings.excludedFolders.length
  const customProviderCount = settings.scanRoots.custom?.length ?? 0

  const addCustomProvider = async () => {
    const folders = await onChooseFolders()
    if (folders.length === 0) return
    const roots = Array.from(new Set([...(settings.scanRoots.custom ?? []), ...folders]))
    await onSettingsChange(
      {
        scanRoots: { custom: roots },
        enabledProviders: { custom: true },
      },
      { rescan: true },
    )
  }

  const addExcludedFolders = async () => {
    const folders = await onChooseFolders()
    if (folders.length === 0) return
    await onSettingsChange(
      { excludedFolders: Array.from(new Set([...settings.excludedFolders, ...folders])) },
      { rescan: true },
    )
  }

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 pb-8">
      {lastIssue && (
        <SettingsIssueBanner
          issue={lastIssue}
          checkingForUpdates={checkingForUpdates}
          formatRelative={formatRelative}
          t={t}
          onRetry={
            lastIssue.kind === 'update-failed' || lastIssue.kind === 'network-failed'
              ? () => void onDownloadLatestUpdate()
              : () => void onRescan()
          }
        />
      )}

      <SettingsSection title={t('settings.app')}>
        <SettingsPanel>
          <SettingsRow
            icon={Languages}
            title={t('settings.language')}
            description={t('settings.languageDescription')}
            trailing={
              <NativeSelect
                label={t('settings.languageSelectLabel')}
                value={language}
                options={languageSelectOptions}
                onChange={(value) => void onLanguageChange(value)}
              />
            }
          />
          <SettingsRow
            icon={Palette}
            title={t('settings.appearance')}
            trailing={
              <NativeSelect
                label={t('settings.appearanceSelectLabel')}
                value={themePreference}
                options={themeSelectOptions}
                onChange={onThemePreferenceChange}
              />
            }
          />
          <SettingsRow
            icon={Globe2}
            title={t('settings.usageTimezone')}
            description={t('settings.usageTimezoneDescription')}
            trailing={
              <NativeSelect
                label={t('settings.usageTimezoneSelectLabel')}
                value={settings.usageTimezone}
                options={timezoneSelectOptions}
                onChange={(value) =>
                  void onSettingsChange({ usageTimezone: value }, { rescan: true })
                }
              />
            }
          />
          <SettingsRow
            title={t('settings.launchAtLogin')}
            trailing={
              <SwitchControl
                checked={launchAtLogin}
                onCheckedChange={(checked) => void onLaunchAtLoginChange(checked)}
                label={toggleLabel('settings.toggleLaunchAtLogin')}
              />
            }
          />
          <SettingsRow
            icon={Download}
            title={t('settings.checkForUpdates')}
            description={t('settings.checkForUpdatesDescription')}
            trailing={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onDownloadLatestUpdate()}
                  disabled={checkingForUpdates}
                  className="settings-ghost-button"
                >
                  {checkingForUpdates ? t('settings.checkingUpdates') : t('settings.checkNow')}
                </Button>
                <SwitchControl
                  checked={settings.checkForUpdates}
                  onCheckedChange={(checked) => void onSettingsChange({ checkForUpdates: checked })}
                  label={toggleLabel('settings.toggleUpdateChecks')}
                />
              </>
            }
          />
          <SettingsRow
            title={t('settings.showDemoData')}
            description={t('settings.showDemoDataDescription')}
            trailing={
              <SwitchControl
                checked={mockDataEnabled}
                onCheckedChange={(checked) => void onMockDataChange(checked)}
                label={t('settings.toggleDemoData')}
              />
            }
          />
          <SettingsRow
            icon={FileJson}
            title={t('settings.exportDiagnostics')}
            description={t('settings.exportDiagnosticsDescription')}
            trailing={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onExportDiagnostics()}
                className="settings-outline-button"
              >
                <Download className="mr-2 size-4" />
                {t('settings.exportDiagnosticsAction')}
              </Button>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title={t('settings.providers')}>
        <SettingsPanel>
          {providerSources.map((source) => {
            const agent = agentBySource.get(source)
            const enabled = settings.enabledProviders[source] !== false
            const detected = enabled && Boolean(agent?.readable)
            const rootIssue = agent?.diagnostics?.find(
              (diagnostic) =>
                diagnostic.code === 'root-permission-blocked' ||
                diagnostic.code === 'root-not-readable',
            )

            return (
              <div
                key={source}
                className="settings-row flex min-h-[72px] items-center gap-4 border-b px-5 py-3 last:border-b-0"
              >
                <AgentGlyph source={source} />
                <div className="min-w-0 flex-1">
                  <div className="settings-row-title truncate text-[15px] font-semibold">
                    {agentLabel[source]}
                  </div>
                  <div className="settings-row-description mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      {t('settings.providerSessionCount', {
                        count: agent?.sessionCount ?? 0,
                      })}
                    </span>
                    <span className="settings-row-separator">•</span>
                    <span>{formatBytes(agent?.sizeBytes ?? 0)}</span>
                  </div>
                  {enabled && rootIssue && (
                    <div className="mt-2 flex max-w-[560px] items-start gap-2 rounded-md border border-amber-300/14 bg-amber-400/[0.055] px-2.5 py-2 text-xs text-amber-100/85">
                      <FolderX className="mt-0.5 size-4 shrink-0 text-amber-300" />
                      <div className="min-w-0">
                        <div className="font-medium">{t('settings.providerFolderBlocked')}</div>
                        <div className="mt-0.5 truncate opacity-70">
                          {rootIssue.path ?? rootIssue.message}
                        </div>
                        <div className="mt-1 leading-relaxed opacity-75">
                          {t('settings.providerFolderBlockedHelp')}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <ProviderStatus
                  detected={detected}
                  enabled={enabled}
                  label={providerStatusLabel(detected, enabled)}
                />
                <SwitchControl
                  checked={enabled}
                  onCheckedChange={(checked) => void setProvider(source, checked)}
                  label={providerToggleLabel(source)}
                />
              </div>
            )
          })}
          <SettingsRow
            icon={Plus}
            title={t('settings.addCustomProvider')}
            description={
              customProviderCount > 0
                ? t('settings.customProviderCount', { count: customProviderCount })
                : undefined
            }
            trailing={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void addCustomProvider()}
                className="settings-ghost-button"
              >
                {t('settings.add')}
              </Button>
            }
          />
          <SettingsRow
            icon={RefreshCcw}
            title={t('settings.rescanProviders')}
            description={t('settings.rescanProvidersDescription')}
            trailing={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onRescan()}
                className="settings-ghost-button"
              >
                {t('settings.scan')}
              </Button>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title={t('settings.scanSection')}>
        <SettingsPanel>
          <SettingsRow
            icon={Play}
            title={t('settings.scanOnLaunch')}
            description={t('settings.scanOnLaunchDescription')}
            trailing={
              <SwitchControl
                checked={settings.scanOnLaunch}
                onCheckedChange={(checked) => void onSettingsChange({ scanOnLaunch: checked })}
                label={toggleLabel('settings.toggleScanOnLaunch')}
              />
            }
          />
          <SettingsRow
            icon={RefreshCcw}
            title={t('settings.backgroundScan')}
            description={t('settings.backgroundScanDescription')}
            trailing={
              <SwitchControl
                checked={settings.backgroundScan}
                onCheckedChange={(checked) => void onSettingsChange({ backgroundScan: checked })}
                label={toggleLabel('settings.toggleBackgroundScan')}
              />
            }
          />
          <SettingsRow
            icon={Clock3}
            title={t('settings.lastScanned')}
            trailing={
              <div className="flex items-center gap-3">
                <span className="settings-trailing-value text-sm">{scanLabel}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onRescan()}
                  className="settings-outline-button"
                >
                  {t('settings.scanNow')}
                </Button>
              </div>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title={t('settings.cleanupSafety')}>
        <SettingsPanel>
          <SettingsRow
            icon={Trash2}
            title={t('settings.moveCleanedToTrash')}
            description={t('settings.moveCleanedToTrashDescription')}
            trailing={
              <SwitchControl
                checked
                disabled
                onCheckedChange={() => undefined}
                label={toggleLabel('settings.toggleMoveToTrash')}
              />
            }
          />
          <SettingsRow
            icon={ShieldCheck}
            title={t('settings.confirmBeforeCleanup')}
            description={t('settings.confirmBeforeCleanupDescription')}
            trailing={
              <SwitchControl
                checked={settings.confirmBeforeCleanup}
                onCheckedChange={(checked) =>
                  void onSettingsChange({ confirmBeforeCleanup: checked })
                }
                label={toggleLabel('settings.toggleCleanupConfirmation')}
              />
            }
          />
          <SettingsRow
            icon={Clock3}
            title={t('settings.purgeExpiredTrash')}
            description={t('settings.purgeExpiredTrashDescription', {
              count: snapshot.trash.length,
              plural: snapshot.trash.length === 1 ? '' : 's',
            })}
            trailing={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onPurgeExpiredTrash()}
                className="settings-outline-button"
              >
                <Trash2 className="mr-2 size-4" />
                {t('settings.purgeExpiredTrashAction')}
              </Button>
            }
          />
          <SettingsRow
            icon={Clock3}
            title={t('settings.protectRecentSessions')}
            description={t('settings.protectRecentSessionsDescription')}
            trailing={
              <NativeSelect
                label={t('settings.protectRecentSessions')}
                value={String(settings.cleanupRetentionDays)}
                options={retentionOptions}
                onChange={(value) => void onSettingsChange({ cleanupRetentionDays: Number(value) })}
              />
            }
          />
          <SettingsRow
            icon={Folder}
            title={t('settings.excludedFolders')}
            description={
              excludedCount > 0
                ? t('settings.excludedFolderCount', { count: excludedCount })
                : t('settings.excludedFoldersDescription')
            }
            trailing={
              <>
                {excludedCount > 0 && (
                  <ValueButton
                    onClick={() => void onSettingsChange({ excludedFolders: [] }, { rescan: true })}
                  >
                    {t('settings.clear')}
                  </ValueButton>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void addExcludedFolders()}
                  className="settings-ghost-button"
                >
                  {t('settings.manage')}
                </Button>
              </>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title={t('settings.trash')}>
        <SettingsPanel>
          {snapshot.trash.length === 0 ? (
            <SettingsRow
              icon={Trash2}
              title={t('settings.trashEmpty')}
              description={t('settings.trashEmptyDescription')}
            />
          ) : (
            snapshot.trash.map((record) => (
              <div
                key={record.id}
                className="settings-row flex min-h-[92px] items-center gap-4 border-b px-5 py-4 last:border-b-0"
              >
                <div className="settings-row-icon grid size-6 shrink-0 place-items-center">
                  <Trash2 className="size-[19px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="settings-row-title truncate text-[15px] font-semibold">
                    {record.title}
                  </div>
                  <div className="settings-row-description mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span>
                      {record.source ? agentLabel[record.source] : t('settings.unknownSource')}
                    </span>
                    <span className="settings-row-separator">•</span>
                    <span>{formatBytes(record.sizeBytes)}</span>
                    <span className="settings-row-separator">•</span>
                    <span>{formatRelative(record.deletedAt)}</span>
                  </div>
                  <div className="settings-row-description mt-1 truncate text-xs">
                    {trashPrimaryPath(record)}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onRestoreTrash(record.id)}
                  className="settings-outline-button"
                >
                  <RefreshCcw className="mr-2 size-4" />
                  {t('settings.restoreTrashAction')}
                </Button>
              </div>
            ))
          )}
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title={t('settings.sounds')}>
        <SettingsPanel>
          <SettingsRow
            icon={Volume2}
            title={t('settings.soundEffects')}
            trailing={
              <SwitchControl
                checked={settings.soundEffects}
                onCheckedChange={(checked) => void onSettingsChange({ soundEffects: checked })}
                label={toggleLabel('settings.toggleSoundEffects')}
              />
            }
          />
          <SettingsRow
            icon={Volume2}
            title={t('settings.volume')}
            trailing={
              <div className="flex w-[330px] items-center justify-end gap-4">
                <input
                  aria-label={t('settings.soundEffectsVolume')}
                  type="range"
                  min="0"
                  max="100"
                  value={settings.soundVolume}
                  onChange={(event) =>
                    void onSettingsChange({ soundVolume: Number(event.target.value) })
                  }
                  className="h-1.5 w-[250px] accent-blue-500"
                />
                <span className="settings-trailing-value w-11 text-right text-sm">
                  {settings.soundVolume}%
                </span>
              </div>
            }
          />
          <SettingsRow
            title={t('settings.cleanupCompleteSound')}
            trailing={
              <SwitchControl
                checked={settings.cleanupSound}
                onCheckedChange={(checked) => void onSettingsChange({ cleanupSound: checked })}
                label={toggleLabel('settings.toggleCleanupCompleteSound')}
              />
            }
          />
          <SettingsRow
            title={t('settings.scanCompleteSound')}
            trailing={
              <SwitchControl
                checked={settings.scanSound}
                onCheckedChange={(checked) => void onSettingsChange({ scanSound: checked })}
                label={toggleLabel('settings.toggleScanCompleteSound')}
              />
            }
          />
          <SettingsRow
            title={t('settings.errorWarningSound')}
            trailing={
              <SwitchControl
                checked={settings.errorSound}
                onCheckedChange={(checked) => void onSettingsChange({ errorSound: checked })}
                label={toggleLabel('settings.toggleErrorWarningSound')}
              />
            }
          />
          <SettingsRow
            icon={Bell}
            title={t('settings.previewSound')}
            trailing={
              <Button
                variant="outline"
                size="sm"
                disabled={!settings.soundEffects}
                onClick={() => void playCleanupSystemSound(settings.soundVolume / 100)}
                className="settings-outline-button"
              >
                {t('settings.play')}
              </Button>
            }
          />
        </SettingsPanel>
      </SettingsSection>
    </div>
  )
}
