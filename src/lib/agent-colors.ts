import type { AgentSource } from '@/shared/types'

export const sourceColors: Record<AgentSource, string> = {
  codex: '#a78bfa',
  claude: '#fb923c',
  cursor: '#cbd5e1',
  gemini: '#38bdf8',
  opencode: '#60a5fa',
  pi: '#22d3ee',
  custom: '#34d399',
}

export const sourceIconColors: Record<AgentSource, string> = {
  ...sourceColors,
  cursor: '#f8fafc',
  opencode: '#f8fafc',
}
