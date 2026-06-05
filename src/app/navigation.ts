import {
  ArrowRightLeft,
  BarChart3,
  Database,
  HeartPulse,
  LayoutDashboard,
  Settings,
  Trash2,
} from 'lucide-react'

export type ViewId = 'overview' | 'sessions' | 'cleanup' | 'usage' | 'relay' | 'health' | 'settings'

export const navItems: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: Database },
  { id: 'cleanup', label: 'Cleanup', icon: Trash2 },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'relay', label: 'Relay JSON', icon: ArrowRightLeft },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'settings', label: 'Settings', icon: Settings },
]
