import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

export function SettingsView({
  mockDataEnabled,
  onMockDataChange,
}: {
  mockDataEnabled: boolean
  onMockDataChange: (enabled: boolean) => Promise<void>
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4 max-[1080px]:grid-cols-1">
      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Display Data</CardTitle>
          <p className="mt-1 text-xs text-white/42">
            Switch between live local scan results and a balanced demo dataset for visual review.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-white/8 bg-white/[0.035] p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white/82">Demo data</div>
              <div className="mt-1 text-xs leading-5 text-white/42">
                Overview, Usage, Cleanup, Sessions, Relay, and Health use curated mock values while
                enabled.
              </div>
            </div>
            <Switch
              checked={mockDataEnabled}
              onCheckedChange={(checked) => void onMockDataChange(checked)}
              className="data-checked:bg-violet-400"
              aria-label="Toggle demo data"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-panel rounded-lg py-4">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm text-white">Settings Scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            ['Scan directories', 'Configure per-agent roots for all supported agents.'],
            ['Trash retention', 'Keep deleted files recoverable before permanent cleanup.'],
            ['Backup defaults', 'Create raw-copy backups before risky cleanup actions.'],
            ['Relay mode', 'Universal JSON first, target-agent converters later.'],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm font-medium text-white/82">{title}</div>
              <div className="mt-2 text-xs leading-5 text-white/42">{body}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
