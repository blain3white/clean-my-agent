import { Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof Activity
  label: string
  value: string
  detail: string
  accent: string
}) {
  return (
    <Card className="metric-card rounded-lg py-4">
      <CardContent className="flex items-center gap-3 px-4">
        <div className={`grid size-10 place-items-center rounded-lg ${accent}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-white/55">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-normal text-white">{value}</div>
          <div className="mt-0.5 truncate text-xs text-white/45">{detail}</div>
        </div>
      </CardContent>
    </Card>
  )
}
