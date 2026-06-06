import {
  ArrowRightLeft,
  BarChart3,
  Database,
  HeartPulse,
  LayoutDashboard,
  Settings,
  Trash2,
} from 'lucide-react'
import type { TranslationKey } from '@/lib/i18n'

export type ViewId = 'overview' | 'sessions' | 'cleanup' | 'usage' | 'relay' | 'health' | 'settings'

export const navItems: Array<{
  id: ViewId
  labelKey: TranslationKey
  icon: typeof LayoutDashboard
  hiddenInSidebar?: boolean
}> = [
  { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard },
  { id: 'sessions', labelKey: 'nav.sessions', icon: Database },
  { id: 'cleanup', labelKey: 'nav.cleanup', icon: Trash2 },
  { id: 'usage', labelKey: 'nav.usage', icon: BarChart3 },
  { id: 'relay', labelKey: 'nav.relay', icon: ArrowRightLeft, hiddenInSidebar: true },
  { id: 'health', labelKey: 'nav.health', icon: HeartPulse, hiddenInSidebar: true },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
]
