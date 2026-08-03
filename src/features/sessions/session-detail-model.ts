import { agentLabel } from '@/lib/format'
import type { SessionRecord, UniversalRelayDocument, UniversalRelayMessage } from '@/shared/types'

export const sessionResultRowClassName =
  'cursor-pointer border-white/7 outline-none hover:bg-transparent focus-visible:bg-transparent hover:[&>td]:bg-white/[0.035] focus-visible:[&>td]:bg-white/[0.05]'

export const sessionDetailFilters = [
  'all',
  'user',
  'assistant',
  'text',
  'reasoning',
  'tool',
  'command',
] as const

export type SessionDetailFilter = (typeof sessionDetailFilters)[number]

export type SessionTimelineEventKind =
  | 'user'
  | 'assistant'
  | 'text'
  | 'reasoning'
  | 'tool'
  | 'command'

export type SessionTimelineEvent = {
  id: string
  kind: SessionTimelineEventKind
  role: UniversalRelayMessage['role']
  createdAt?: string
  title: string
  text: string
  meta?: string
  status?: string
}

export type SessionTimelineCounts = Record<SessionDetailFilter, number>

export function sessionActionLabel(action: string, session: SessionRecord): string {
  const title = session.title.trim() || session.id
  const agent = agentLabel[session.source]
  return `${action} for ${title} (${agent})`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function rawRecord(message: UniversalRelayMessage): Record<string, unknown> | undefined {
  const raw = isRecord(message.raw) ? message.raw : undefined
  const payload = isRecord(raw?.payload) ? raw.payload : undefined
  const item = isRecord(raw?.item) ? raw.item : undefined
  const messageRecord = isRecord(raw?.message) ? raw.message : undefined
  return item ?? messageRecord ?? payload ?? raw
}

function rawType(record: Record<string, unknown> | undefined): string {
  return [
    record?.type,
    record?.kind,
    record?.name,
    record?.subtype,
    isRecord(record?.payload) ? record.payload.type : undefined,
    isRecord(record?.message) ? record.message.type : undefined,
  ]
    .map((value) => String(value ?? '').toLowerCase())
    .join(' ')
}

function toolName(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined
  const payload = isRecord(record.payload) ? record.payload : undefined
  const input = isRecord(record.input) ? record.input : undefined
  return (
    stringValue(record.toolName) ??
    stringValue(record.tool_name) ??
    stringValue(record.name) ??
    stringValue(record.command) ??
    stringValue(payload?.toolName) ??
    stringValue(payload?.tool_name) ??
    stringValue(payload?.name) ??
    stringValue(input?.command)
  )
}

function commandText(record: Record<string, unknown> | undefined, fallback: string): string {
  if (!record) return fallback
  const payload = isRecord(record.payload) ? record.payload : undefined
  const input = isRecord(record.input) ? record.input : undefined
  return (
    stringValue(record.command) ??
    stringValue(record.cmd) ??
    stringValue(record.shell_command) ??
    stringValue(payload?.command) ??
    stringValue(payload?.cmd) ??
    stringValue(input?.command) ??
    fallback
  )
}

function eventKind(message: UniversalRelayMessage): SessionTimelineEventKind {
  const record = rawRecord(message)
  const type = rawType(record)
  const text = message.text.toLowerCase()

  if (type.includes('reason') || type.includes('thinking') || text.startsWith('reasoning summary'))
    return 'reasoning'
  if (type.includes('command') || Boolean(stringValue(record?.command))) return 'command'
  if (
    message.role === 'tool' ||
    type.includes('tool') ||
    type.includes('function') ||
    Boolean(toolName(record))
  ) {
    return 'tool'
  }
  if (message.role === 'user') return 'user'
  if (message.role === 'assistant') return 'assistant'
  return 'text'
}

function roleTitle(kind: SessionTimelineEventKind): string {
  return {
    user: 'User',
    assistant: 'Assistant',
    text: 'Text',
    reasoning: 'Reasoning',
    tool: 'Tool call',
    command: 'Command',
  }[kind]
}

function statusFromRecord(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined
  return (
    stringValue(record.status) ??
    stringValue(record.state) ??
    stringValue(isRecord(record.payload) ? record.payload.status : undefined)
  )
}

export function buildSessionTimeline(document: UniversalRelayDocument): SessionTimelineEvent[] {
  const events = document.messages.map((message, index): SessionTimelineEvent => {
    const record = rawRecord(message)
    const kind = eventKind(message)
    const name = toolName(record)
    const text = kind === 'command' ? commandText(record, message.text) : message.text

    return {
      id: message.id || `${document.session.id}-${index}`,
      kind,
      role: message.role,
      createdAt: message.createdAt,
      title: name && (kind === 'tool' || kind === 'command') ? name : roleTitle(kind),
      text,
      meta:
        kind === 'tool' || kind === 'command'
          ? (stringValue(record?.id) ??
            stringValue(isRecord(record?.payload) ? record.payload.id : ''))
          : undefined,
      status: statusFromRecord(record),
    }
  })

  document.commands.forEach((command, index) => {
    if (events.some((event) => event.kind === 'command' && event.text === command.command)) return
    events.push({
      id: `${document.session.id}-command-${index}`,
      kind: 'command',
      role: 'tool',
      createdAt: command.createdAt,
      title: 'Command',
      text: command.command,
      meta: command.cwd,
    })
  })

  return events
}

export function countTimelineEvents(events: SessionTimelineEvent[]): SessionTimelineCounts {
  const counts = sessionDetailFilters.reduce((acc, filter) => {
    acc[filter] = filter === 'all' ? events.length : 0
    return acc
  }, {} as SessionTimelineCounts)

  events.forEach((event) => {
    counts[event.kind] += 1
    if (event.kind === 'user' || event.kind === 'assistant') counts.text += 1
  })

  return counts
}

export function filterTimelineEvents(
  events: SessionTimelineEvent[],
  filter: SessionDetailFilter,
): SessionTimelineEvent[] {
  if (filter === 'all') return events
  if (filter === 'text') {
    return events.filter((event) => ['user', 'assistant', 'text'].includes(event.kind))
  }
  return events.filter((event) => event.kind === filter)
}
