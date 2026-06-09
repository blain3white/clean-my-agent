import {
  Archive,
  CalendarDays,
  Clock,
  FlaskConical,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import {
  agentSources,
  type AgentSource,
  type CleanupCandidate,
  type SessionRecord,
} from '@/shared/types'

export type CleanupStage = 'idle' | 'scanning' | 'complete' | 'review' | 'failed'
export type CleanupScanStage = Exclude<CleanupStage, 'review' | 'failed'>
export type CleanupOrbPhase = 'initial' | 'scalein' | 'running' | 'scaleout' | 'finish'
export type CleanupFilter = 'all' | 'high' | 'medium' | 'low' | 'recoverable'
export type CleanupSort = 'size' | 'risk' | 'agent'
export type CleanupSourceProgress = {
  source: AgentSource
  scanned: number
  total: number
  status: 'Waiting' | 'Scanning' | 'Complete'
}
export type CleanupCategoryKey = 'large' | 'inactive' | 'test'
export type CleanupCategorySummary = {
  key: CleanupCategoryKey
  title: string
  description: string
  bytes: number
  count: number
  action: 'Recommended' | 'Review' | 'Safe'
  icon: LucideIcon
  accent: string
}
export type CleanupWorkspaceHint = {
  key: string
  label: string
  detail: string
}
export type CleanupCandidateGroup = {
  id: string
  source: AgentSource
  workspace: CleanupWorkspaceHint
  candidates: CleanupCandidate[]
  bytes: number
  latestOpened?: string
}

export const cleanupSourceWeights: Record<AgentSource, { start: number; end: number }> = {
  codex: { start: 0, end: 24 },
  claude: { start: 12, end: 48 },
  cursor: { start: 34, end: 72 },
  gemini: { start: 52, end: 88 },
  opencode: { start: 72, end: 100 },
  custom: { start: 82, end: 100 },
}

export const cleanupRiskRank: Record<CleanupCandidate['risk'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export const cleanupKindMeta: Record<
  CleanupCandidate['kind'],
  { category: CleanupCategoryKey; label: string; icon: LucideIcon; accent: string }
> = {
  'old-session': {
    category: 'inactive',
    label: 'old session',
    icon: CalendarDays,
    accent: 'text-sky-300 bg-sky-400/12 ring-sky-400/22',
  },
  'backed-up-session': {
    category: 'inactive',
    label: 'old session',
    icon: CalendarDays,
    accent: 'text-emerald-300 bg-emerald-400/12 ring-emerald-400/22',
  },
  'large-log': {
    category: 'large',
    label: 'large chat',
    icon: MessageSquare,
    accent: 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/24',
  },
  'duplicate-backup': {
    category: 'test',
    label: 'recoverable',
    icon: Archive,
    accent: 'text-blue-300 bg-blue-400/12 ring-blue-400/24',
  },
  'temp-file': {
    category: 'test',
    label: 'test chat',
    icon: FlaskConical,
    accent: 'text-violet-300 bg-violet-400/13 ring-violet-400/24',
  },
  'orphan-session': {
    category: 'inactive',
    label: 'old session',
    icon: Clock,
    accent: 'text-amber-300 bg-amber-400/13 ring-amber-400/24',
  },
  'invalid-cache': {
    category: 'test',
    label: 'test chat',
    icon: FlaskConical,
    accent: 'text-red-300 bg-red-400/12 ring-red-400/24',
  },
}

export function cleanupCategoryForCandidate(candidate: CleanupCandidate): CleanupCategoryKey {
  return cleanupKindMeta[candidate.kind].category
}

export function defaultCleanupSelection(candidates: CleanupCandidate[]): string[] {
  return candidates
    .filter((candidate) => {
      const category = cleanupCategoryForCandidate(candidate)
      return category === 'inactive' || category === 'test'
    })
    .map((candidate) => candidate.id)
}

export function buildCleanupCategorySummaries(
  candidates: CleanupCandidate[],
): CleanupCategorySummary[] {
  const seed: Record<CleanupCategoryKey, CleanupCategorySummary> = {
    large: {
      key: 'large',
      title: 'Large chats',
      description: 'Sessions with unusually large context or logs',
      bytes: 0,
      count: 0,
      action: 'Recommended',
      icon: MessageSquare,
      accent: 'text-emerald-300 bg-emerald-400/13 ring-emerald-400/24',
    },
    inactive: {
      key: 'inactive',
      title: '90 days inactive',
      description: 'Sessions not opened in over 90 days',
      bytes: 0,
      count: 0,
      action: 'Review',
      icon: CalendarDays,
      accent: 'text-blue-300 bg-blue-400/13 ring-blue-400/24',
    },
    test: {
      key: 'test',
      title: 'Test chats',
      description: 'Short 1-2 message sessions and throwaway prompts',
      bytes: 0,
      count: 0,
      action: 'Safe',
      icon: FlaskConical,
      accent: 'text-violet-300 bg-violet-400/13 ring-violet-400/24',
    },
  }

  for (const candidate of candidates) {
    const category = cleanupCategoryForCandidate(candidate)
    seed[category].bytes += candidate.sizeBytes
    seed[category].count += 1
  }

  return [seed.large, seed.inactive, seed.test]
}

function cleanupTimestamp(value: string | undefined): number {
  if (!value) return 0
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function cleanupSessionForCandidate(
  candidate: CleanupCandidate,
  sessionById: Map<string, SessionRecord>,
): SessionRecord | undefined {
  for (const sessionId of candidate.sessionIds) {
    const session = sessionById.get(sessionId)
    if (session) return session
  }
  return undefined
}

function cleanupDirectoryFromPath(pathValue: string): string {
  const normalized = pathValue.replaceAll('\\', '/').replace(/\/+/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return normalized || 'Unknown path'

  const lastPart = parts.at(-1) ?? ''
  const looksLikeFile = /\.[a-z0-9]{1,12}$/i.test(lastPart)
  const directoryParts = looksLikeFile ? parts.slice(0, -1) : parts
  if (directoryParts.length === 0) return normalized

  const prefix = normalized.startsWith('/') ? '/' : ''
  return `${prefix}${directoryParts.join('/')}`
}

export function cleanupCompactPath(pathValue: string, maxLength = 72): string {
  if (pathValue.length <= maxLength) return pathValue
  const headLength = Math.max(18, Math.floor(maxLength * 0.38))
  const tailLength = Math.max(24, maxLength - headLength - 3)
  return `${pathValue.slice(0, headLength)}...${pathValue.slice(-tailLength)}`
}

function cleanupPathLabel(pathValue: string): string {
  const normalized = pathValue.replaceAll('\\', '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return 'Unknown workspace'
  return parts.slice(-2).join('/')
}

function cleanupWorkspaceForCandidate(
  candidate: CleanupCandidate,
  session: SessionRecord | undefined,
): CleanupWorkspaceHint {
  if (session?.projectPath) {
    return {
      key: session.projectPath,
      label: session.projectName || cleanupPathLabel(session.projectPath),
      detail: session.projectPath,
    }
  }

  if (session?.projectName) {
    return {
      key: `project:${session.projectName}`,
      label: session.projectName,
      detail: 'Project name only',
    }
  }

  const primaryPath = candidate.paths[0]
  if (!primaryPath) {
    return {
      key: 'unknown',
      label: 'Unknown workspace',
      detail: 'No local path available',
    }
  }

  const directory = cleanupDirectoryFromPath(primaryPath)
  return {
    key: directory,
    label: cleanupPathLabel(directory),
    detail: directory,
  }
}

function cleanupCandidateSource(
  candidate: CleanupCandidate,
  session: SessionRecord | undefined,
): AgentSource {
  return candidate.source ?? session?.source ?? 'codex'
}

export function buildCleanupCandidateGroups(
  candidates: CleanupCandidate[],
  sessionById: Map<string, SessionRecord>,
): CleanupCandidateGroup[] {
  const groups = new Map<string, CleanupCandidateGroup>()

  for (const candidate of candidates) {
    const session = cleanupSessionForCandidate(candidate, sessionById)
    const source = cleanupCandidateSource(candidate, session)
    const workspace = cleanupWorkspaceForCandidate(candidate, session)
    const id = `${source}:${workspace.key}`
    const existing =
      groups.get(id) ??
      ({
        id,
        source,
        workspace,
        candidates: [],
        bytes: 0,
      } satisfies CleanupCandidateGroup)

    existing.candidates.push(candidate)
    existing.bytes += candidate.sizeBytes

    const currentLatest = cleanupTimestamp(existing.latestOpened)
    const candidateLatest = cleanupTimestamp(candidate.lastUpdated)
    if (candidateLatest > currentLatest) existing.latestOpened = candidate.lastUpdated

    groups.set(id, existing)
  }

  return Array.from(groups.values()).sort((a, b) => {
    const sourceDelta = agentSources.indexOf(a.source) - agentSources.indexOf(b.source)
    if (sourceDelta !== 0) return sourceDelta
    if (b.bytes !== a.bytes) return b.bytes - a.bytes
    return a.workspace.label.localeCompare(b.workspace.label)
  })
}
