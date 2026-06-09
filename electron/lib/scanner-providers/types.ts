import type {
  AgentSource,
  TokenUsage,
  UniversalRelayDocument,
  UniversalRelayMessage,
} from '../../../src/shared/types'
import type { JsonRecord } from '../agent-storage-formats'

export type ScannerProviderParsedSession = {
  title?: string
  projectPath?: string
  branch?: string
  messages: UniversalRelayMessage[]
  files: UniversalRelayDocument['files']
  commands: UniversalRelayDocument['commands']
  attachments: UniversalRelayDocument['attachments']
  gitDiff?: string
  tokens: TokenUsage
  usageByDate: Record<string, number>
  usageEvents: Array<{ timestamp: string; tokens: number }>
  metadata: JsonRecord
}

export type ScannerProviderCandidate = {
  path: string
  root?: string
  relativePath?: string
  sizeBytes: number
  createdAt: string
  lastUpdated: string
  mtimeMs: number
}

export type ScannerPlatform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export type AgentScannerProvider = {
  source: AgentSource
  name: string
  roots: string[]
  platformRoots?: Partial<Record<ScannerPlatform, string[]>>
  patterns: string[]
  note: string
  parserName?: string
  parseSession?: (filePath: string) => Promise<ScannerProviderParsedSession>
}
