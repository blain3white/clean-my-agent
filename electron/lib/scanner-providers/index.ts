import type { AgentSource } from '../../../src/shared/types'
import { claudeScannerProvider } from './claude'
import { codexScannerProvider } from './codex'
import { cursorScannerProvider } from './cursor'
import { customScannerProvider } from './custom'
import { geminiScannerProvider } from './gemini'
import { opencodeScannerProvider } from './opencode'
import type { AgentScannerProvider } from './types'

export type {
  AgentScannerProvider,
  ScannerProviderCandidate,
  ScannerProviderParsedSession,
} from './types'

export const scannerProviders: AgentScannerProvider[] = [
  codexScannerProvider,
  claudeScannerProvider,
  cursorScannerProvider,
  geminiScannerProvider,
  opencodeScannerProvider,
  customScannerProvider,
]

export function scannerProviderFor(source: AgentSource): AgentScannerProvider | undefined {
  return scannerProviders.find((provider) => provider.source === source)
}
