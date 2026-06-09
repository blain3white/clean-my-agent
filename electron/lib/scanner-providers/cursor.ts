import type { AgentScannerProvider } from './types'

export const cursorScannerProvider: AgentScannerProvider = {
  source: 'cursor',
  name: 'Cursor',
  roots: [],
  platformRoots: {
    darwin: [
      '~/Library/Application Support/Cursor/User/workspaceStorage',
      '~/Library/Application Support/Cursor/User/globalStorage',
    ],
    linux: ['~/.config/Cursor/User/workspaceStorage', '~/.config/Cursor/User/globalStorage'],
    win32: [
      '~/AppData/Roaming/Cursor/User/workspaceStorage',
      '~/AppData/Roaming/Cursor/User/globalStorage',
    ],
  },
  patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.vscdb', '**/*.log'],
  note: 'Read-only scan of Cursor workspace storage and chat artifacts.',
  parserName: 'generic-json-session-parser',
}
