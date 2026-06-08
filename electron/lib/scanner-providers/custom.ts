import type { AgentScannerProvider } from './types'

export const customScannerProvider: AgentScannerProvider = {
  source: 'custom',
  name: 'Custom',
  roots: [],
  patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.md', '**/*.log'],
  note: 'Scans user-selected custom session folders with the generic parser.',
  parserName: 'generic-json-session-parser',
}
