import type { CleanupCandidate } from '@/shared/types'

export type CleanupPersistedViewState = {
  stage: 'complete'
  savedAt: string
  candidateIds: string[]
}

const cleanupViewStateStorageKey = 'clean-my-agent.cleanupViewState'

export function readCleanupViewState(): CleanupPersistedViewState | null {
  try {
    const raw = globalThis.localStorage?.getItem(cleanupViewStateStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CleanupPersistedViewState>
    if (parsed.stage !== 'complete') return null
    return {
      stage: parsed.stage,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      candidateIds: Array.isArray(parsed.candidateIds)
        ? parsed.candidateIds.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch (error) {
    console.error(error)
    return null
  }
}

export function writeCleanupViewState(candidates: CleanupCandidate[]) {
  try {
    globalThis.localStorage?.setItem(
      cleanupViewStateStorageKey,
      JSON.stringify({
        stage: 'complete',
        savedAt: new Date().toISOString(),
        candidateIds: candidates.map((candidate) => candidate.id),
      } satisfies CleanupPersistedViewState),
    )
  } catch (error) {
    console.error(error)
  }
}

export function clearCleanupViewState() {
  try {
    globalThis.localStorage?.removeItem(cleanupViewStateStorageKey)
  } catch (error) {
    console.error(error)
  }
}
