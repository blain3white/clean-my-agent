import type { AgentScannerProvider } from './types'

export const opencodeScannerProvider: AgentScannerProvider = {
  source: 'opencode',
  name: 'OpenCode',
  roots: ['~/.local/share/opencode', '~/Library/Application Support/opencode', '~/.opencode'],
  patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.md', '**/*.log'],
  note: 'Scans OpenCode data roots using a generic session parser.',
  parserName: 'generic-json-session-parser',
}
