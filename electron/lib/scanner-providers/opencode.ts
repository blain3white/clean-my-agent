import type { AgentScannerProvider } from './types'

export const opencodeScannerProvider: AgentScannerProvider = {
  source: 'opencode',
  name: 'OpenCode',
  roots: ['~/.opencode'],
  platformRoots: {
    darwin: ['~/Library/Application Support/opencode', '~/.local/share/opencode'],
    linux: ['~/.local/share/opencode'],
    win32: [
      '~/AppData/Local/opencode',
      '~/AppData/Roaming/opencode',
      '~/AppData/Roaming/ai.opencode.desktop/opencode',
      '~/AppData/Roaming/ai.opencode.desktop.beta/opencode',
      '~/AppData/Roaming/ai.opencode.desktop.dev/opencode',
    ],
  },
  patterns: ['**/*.json', '**/*.jsonl', '**/*.db', '**/*.sqlite', '**/*.md', '**/*.log'],
  note: 'Scans OpenCode data roots using a generic session parser.',
  parserName: 'generic-json-session-parser',
}
