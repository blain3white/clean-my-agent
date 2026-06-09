import type { AgentScannerProvider } from './types'

export const cursorScannerProvider: AgentScannerProvider = {
  source: 'cursor',
  name: 'Cursor',
  roots: [
    '~/Library/Application Support/Cursor/User/workspaceStorage',
    '~/Library/Application Support/Cursor/User/globalStorage',
  ],
  patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.vscdb', '**/*.log'],
  note: 'Read-only scan of Cursor workspace storage and chat artifacts.',
  parserName: 'generic-json-session-parser',
}
