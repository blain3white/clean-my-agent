import type { AgentScannerProvider } from './types'

export const geminiScannerProvider: AgentScannerProvider = {
  source: 'gemini',
  name: 'Gemini',
  roots: ['~/.gemini', '~/.config/gemini', '~/Library/Application Support/Gemini'],
  patterns: ['**/*.json', '**/*.jsonl', '**/*.md', '**/*.log'],
  note: 'Scans configurable Gemini CLI/session storage roots.',
  parserName: 'generic-json-session-parser',
}
