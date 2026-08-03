import type { AgentScannerProvider } from './types'

// Roots are deliberately scoped to the `sessions` subdirectory. The parent
// `~/.pi/agent/` directory holds credential-like files (auth.json, models.json,
// trust.json) that must never be scanned, so we never point roots above it.
export const piScannerProvider: AgentScannerProvider = {
  source: 'pi',
  name: 'Pi',
  roots: ['~/.pi/agent/sessions'],
  patterns: ['**/*.jsonl'],
  note: 'Scans Pi agent session JSONL transcripts under ~/.pi/agent/sessions.',
  parserName: 'generic-json-session-parser',
}
