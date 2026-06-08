import type { AgentScannerProvider } from './types'

export const claudeScannerProvider: AgentScannerProvider = {
  source: 'claude',
  name: 'Claude Code',
  roots: ['~/.claude/projects', '~/.claude/transcripts'],
  patterns: ['**/*.jsonl', '**/*.json'],
  note: 'Scans Claude Code project transcripts.',
  parserName: 'generic-json-session-parser',
}
