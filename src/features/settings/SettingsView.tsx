import { useMemo, useState, type ReactNode } from 'react'
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  Palette,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { AgentGlyph } from '@/components/agent-glyph'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { agentLabel, formatBytes, formatRelative } from '@/lib/format'
import { agentSources, type AgentSource, type DashboardSnapshot } from '@/shared/types'

type SettingsViewProps = {
  snapshot: DashboardSnapshot
  mockDataEnabled: boolean
  onMockDataChange: (enabled: boolean) => Promise<void>
  onRescan: () => Promise<void>
}

type ToggleKey =
  | 'scanOnLaunch'
  | 'backgroundScan'
  | 'moveToTrash'
  | 'confirmCleanup'
  | 'soundEffects'
  | 'cleanupSound'
  | 'scanSound'
  | 'errorSound'
  | 'launchAtLogin'
  | 'checkUpdates'

const initialProviderState: Record<AgentSource, boolean> = {
  codex: true,
  claude: true,
  cursor: true,
  gemini: true,
  opencode: true,
}

const initialToggles: Record<ToggleKey, boolean> = {
  scanOnLaunch: true,
  backgroundScan: true,
  moveToTrash: true,
  confirmCleanup: true,
  soundEffects: true,
  cleanupSound: true,
  scanSound: false,
  errorSound: true,
  launchAtLogin: false,
  checkUpdates: true,
}

function latestScanLabel(snapshot: DashboardSnapshot): string {
  const latest = snapshot.agents
    .map((agent) => agent.lastScannedAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

  return formatRelative(latest)
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="px-0.5 text-sm font-medium text-white/54">{title}</h2>
      {children}
    </section>
  )
}

function SettingsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] shadow-[inset_0_1px_0_rgb(255_255_255_/_7%),0_22px_58px_rgb(0_0_0_/_18%)]">
      {children}
    </div>
  )
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
    <div className="group flex min-h-[64px] items-center gap-4 border-b border-white/[0.075] px-5 py-3 last:border-b-0">
      {Icon ? (
        <div className="grid size-6 shrink-0 place-items-center text-white/78">
          <Icon className="size-[19px]" />
        </div>
      ) : (
        <div className="size-6 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-white/86">{title}</div>
        {description && <div className="mt-1 truncate text-sm text-white/46">{description}</div>}
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
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="data-checked:bg-blue-500 data-unchecked:bg-white/18"
      aria-label={label}
    />
  )
}

function ValueButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 min-w-28 items-center justify-between gap-3 rounded-lg border border-white/9 bg-white/[0.055] px-3 text-sm text-white/78 transition hover:bg-white/[0.085]"
    >
      <span>{children}</span>
      <ChevronDown className="size-4 text-white/42" />
    </button>
  )
}

function ActionChevron() {
  return <ChevronRight className="size-4 text-white/42 transition group-hover:text-white/62" />
}

function ProviderStatus({ detected, enabled }: { detected: boolean; enabled: boolean }) {
  const label = !enabled ? 'Disabled' : detected ? 'Detected' : 'Not found'
  const color = !enabled ? 'bg-white/38' : detected ? 'bg-emerald-300' : 'bg-amber-300'

  return (
    <span className="flex min-w-28 items-center gap-2 text-sm text-white/58">
      <span className={`size-1.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}

export function SettingsView({
  snapshot,
  mockDataEnabled,
  onMockDataChange,
  onRescan,
}: SettingsViewProps) {
  const [providers, setProviders] = useState(initialProviderState)
  const [toggles, setToggles] = useState(initialToggles)
  const [volume, setVolume] = useState(35)
  const scanLabel = useMemo(() => latestScanLabel(snapshot), [snapshot])
  const agentBySource = useMemo(
    () => new Map(snapshot.agents.map((agent) => [agent.source, agent])),
    [snapshot.agents],
  )

  const setProvider = (source: AgentSource, enabled: boolean) => {
    setProviders((current) => ({ ...current, [source]: enabled }))
  }

  const setToggle = (key: ToggleKey, enabled: boolean) => {
    setToggles((current) => ({ ...current, [key]: enabled }))
  }

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-5 pb-8">
      <SettingsSection title="Providers">
        <SettingsPanel>
          {agentSources.map((source) => {
            const agent = agentBySource.get(source)
            const enabled = providers[source]
            const detected = enabled && Boolean(agent?.readable)

            return (
              <div
                key={source}
                className="flex min-h-[72px] items-center gap-4 border-b border-white/[0.075] px-5 py-3 last:border-b-0"
              >
                <AgentGlyph source={source} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-white/90">
                    {agentLabel[source]}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/50">
                    <span>{agent?.sessionCount ?? 0} sessions</span>
                    <span className="text-white/32">•</span>
                    <span>{formatBytes(agent?.sizeBytes ?? 0)}</span>
                  </div>
                </div>
                <ProviderStatus detected={detected} enabled={enabled} />
                <SwitchControl
                  checked={enabled}
                  onCheckedChange={(checked) => setProvider(source, checked)}
                  label={`Toggle ${agentLabel[source]} provider`}
                />
              </div>
            )
          })}
          <SettingsRow icon={Plus} title="Add custom provider" trailing={<ActionChevron />} />
          <SettingsRow
            icon={RefreshCcw}
            title="Rescan providers"
            description="Search for new or changed providers"
            trailing={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void onRescan()}
                className="text-white/58 hover:bg-white/8 hover:text-white"
              >
                Scan
              </Button>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title="Scan">
        <SettingsPanel>
          <SettingsRow
            icon={Play}
            title="Scan on launch"
            description="Automatically scan providers when Clean My Agent starts"
            trailing={
              <SwitchControl
                checked={toggles.scanOnLaunch}
                onCheckedChange={(checked) => setToggle('scanOnLaunch', checked)}
                label="Toggle scan on launch"
              />
            }
          />
          <SettingsRow
            icon={RefreshCcw}
            title="Background scan"
            description="Keep scanning in the background for changes"
            trailing={
              <SwitchControl
                checked={toggles.backgroundScan}
                onCheckedChange={(checked) => setToggle('backgroundScan', checked)}
                label="Toggle background scan"
              />
            }
          />
          <SettingsRow
            icon={Clock3}
            title="Last scanned"
            trailing={
              <div className="flex items-center gap-3">
                <span className="text-sm text-white/58">{scanLabel}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onRescan()}
                  className="border-white/10 bg-white/[0.045] text-white/72 hover:bg-white/[0.085] hover:text-white"
                >
                  Scan now
                </Button>
              </div>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title="Cleanup & Safety">
        <SettingsPanel>
          <SettingsRow
            icon={Trash2}
            title="Move cleaned sessions to App Trash"
            description="Keep cleanup recoverable instead of deleting files permanently"
            trailing={
              <SwitchControl
                checked={toggles.moveToTrash}
                onCheckedChange={(checked) => setToggle('moveToTrash', checked)}
                label="Toggle app trash cleanup"
              />
            }
          />
          <SettingsRow
            icon={ShieldCheck}
            title="Confirm before cleanup"
            description="Review selected candidates before moving anything"
            trailing={
              <SwitchControl
                checked={toggles.confirmCleanup}
                onCheckedChange={(checked) => setToggle('confirmCleanup', checked)}
                label="Toggle cleanup confirmation"
              />
            }
          />
          <SettingsRow
            icon={Clock3}
            title="Protect recent sessions"
            description="Recent sessions are never suggested for cleanup"
            trailing={<ValueButton>7 days</ValueButton>}
          />
          <SettingsRow
            icon={Folder}
            title="Excluded folders"
            description="Manage custom scan exclusions"
            trailing={<ActionChevron />}
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title="Sounds">
        <SettingsPanel>
          <SettingsRow
            icon={Volume2}
            title="Sound effects"
            trailing={
              <SwitchControl
                checked={toggles.soundEffects}
                onCheckedChange={(checked) => setToggle('soundEffects', checked)}
                label="Toggle sound effects"
              />
            }
          />
          <SettingsRow
            icon={Volume2}
            title="Volume"
            trailing={<span className="w-11 text-right text-sm text-white/58">{volume}%</span>}
          >
            <div className="mt-3 flex max-w-[260px] items-center gap-3">
              <input
                aria-label="Sound effects volume"
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="h-1.5 w-full accent-blue-500"
              />
            </div>
          </SettingsRow>
          <SettingsRow
            title="Cleanup complete sound"
            trailing={
              <SwitchControl
                checked={toggles.cleanupSound}
                onCheckedChange={(checked) => setToggle('cleanupSound', checked)}
                label="Toggle cleanup complete sound"
              />
            }
          />
          <SettingsRow
            title="Scan complete sound"
            trailing={
              <SwitchControl
                checked={toggles.scanSound}
                onCheckedChange={(checked) => setToggle('scanSound', checked)}
                label="Toggle scan complete sound"
              />
            }
          />
          <SettingsRow
            title="Error warning sound"
            trailing={
              <SwitchControl
                checked={toggles.errorSound}
                onCheckedChange={(checked) => setToggle('errorSound', checked)}
                label="Toggle error warning sound"
              />
            }
          />
          <SettingsRow
            icon={Bell}
            title="Preview sound"
            trailing={
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-white/[0.045] text-white/72 hover:bg-white/[0.085] hover:text-white"
              >
                Play
              </Button>
            }
          />
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title="App">
        <SettingsPanel>
          <SettingsRow
            icon={Palette}
            title="Appearance"
            trailing={<ValueButton>System</ValueButton>}
          />
          <SettingsRow
            title="Launch at login"
            trailing={
              <SwitchControl
                checked={toggles.launchAtLogin}
                onCheckedChange={(checked) => setToggle('launchAtLogin', checked)}
                label="Toggle launch at login"
              />
            }
          />
          <SettingsRow
            title="Check for updates"
            trailing={
              <SwitchControl
                checked={toggles.checkUpdates}
                onCheckedChange={(checked) => setToggle('checkUpdates', checked)}
                label="Toggle update checks"
              />
            }
          />
          <SettingsRow
            title="Show demo data"
            description="Use curated values for visual review"
            trailing={
              <SwitchControl
                checked={mockDataEnabled}
                onCheckedChange={(checked) => void onMockDataChange(checked)}
                label="Toggle demo data"
              />
            }
          />
        </SettingsPanel>
      </SettingsSection>
    </div>
  )
}
