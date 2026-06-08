import type { AgentSource, RiskLevel } from '@/shared/types'

export const agentLabel: Record<AgentSource, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  custom: 'Custom',
}

export const agentAccent: Record<AgentSource, string> = {
  codex: 'text-violet-300 bg-violet-400/12 ring-violet-400/20',
  claude: 'text-orange-300 bg-orange-400/12 ring-orange-400/20',
  cursor: 'text-slate-200 bg-slate-400/12 ring-slate-300/22',
  gemini: 'text-sky-300 bg-sky-400/12 ring-sky-400/20',
  opencode: 'text-blue-300 bg-blue-400/12 ring-blue-300/20',
  custom: 'text-emerald-300 bg-emerald-400/12 ring-emerald-400/20',
}

export const riskAccent: Record<RiskLevel, string> = {
  low: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/20',
  medium: 'text-amber-300 bg-amber-400/10 ring-amber-400/20',
  high: 'text-red-300 bg-red-400/10 ring-red-400/20',
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

export function formatRelative(value?: string): string {
  if (!value) return 'Never'
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  if (Number.isNaN(diffMs)) return 'Unknown'
  const minutes = Math.max(0, Math.floor(diffMs / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export function formatCost(dollars: number): string {
  if (!Number.isFinite(dollars) || dollars <= 0) return '$0.00'
  if (dollars < 0.01) return '<$0.01'
  return `$${dollars.toFixed(2)}`
}
