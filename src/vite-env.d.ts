/// <reference types="vite/client" />

import type { CleanMyAgentApi } from './shared/types'

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }

  interface Window {
    cleanMyAgent?: CleanMyAgentApi
  }
}
