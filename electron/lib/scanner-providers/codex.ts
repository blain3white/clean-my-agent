import type { AgentScannerProvider } from './types'

export const codexScannerProvider: AgentScannerProvider = {
  source: 'codex',
  name: 'Codex',
  roots: ['~/.codex/sessions', '~/.codex/tasks', '~/.codex/archived_sessions'],
  patterns: ['**/*.jsonl', '**/*.json'],
  note: 'Scans Codex CLI/App session JSONL data.',
  parserName: 'generic-json-session-parser',
}
