import { stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentSource,
  AppSettings,
  ManagedSkill,
  SkillCategory,
  SkillStatus,
  SkillsSnapshot,
  SkillsSummary,
} from '../../src/shared/types'
import { exists, expandHome, hashId, listFiles, safeReadText } from './files'

type SkillAccent = ManagedSkill['accent']
type SkillIcon = ManagedSkill['icon']

export type SkillRoot = {
  source: AgentSource
  root: string
  primary?: boolean
}

type SkillDraft = ManagedSkill & {
  normalizedName: string
  primary: boolean
}

const maxSkillFilesPerRoot = 500
const recentWindowMs = 7 * 24 * 60 * 60 * 1000
const skillFilePattern = '*/SKILL.md'

const rootCandidates: SkillRoot[] = [
  { source: 'codex', root: '~/.codex/skills', primary: true },
  { source: 'claude', root: '~/.cc-switch/skills', primary: true },
  { source: 'gemini', root: '~/.gemini/skills', primary: true },
  { source: 'opencode', root: '~/.opencode/skills', primary: true },
  { source: 'claude', root: '~/.claude/skills', primary: false },
  { source: 'claude', root: '~/.agents/skills', primary: false },
  { source: 'cursor', root: '~/.cursor/skills', primary: false },
]

const categoryStyles: Record<SkillCategory, { accent: SkillAccent; icon: SkillIcon }> = {
  engineering: { accent: 'violet', icon: 'code' },
  docs: { accent: 'green', icon: 'notes' },
  productivity: { accent: 'blue', icon: 'search' },
  design: { accent: 'pink', icon: 'image' },
  data: { accent: 'cyan', icon: 'data' },
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function titleFromSlug(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function cleanFrontmatterValue(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
}

export function parseSkillMetadata(markdown: string, fallbackName: string) {
  const metadata = new Map<string, string>()
  const normalizedFallback = titleFromSlug(fallbackName)
  let body = markdown

  if (markdown.startsWith('---')) {
    const endIndex = markdown.indexOf('\n---', 3)
    if (endIndex > -1) {
      const frontmatter = markdown.slice(3, endIndex).split(/\r?\n/)
      frontmatter.forEach((line) => {
        const match = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/.exec(line)
        if (match) metadata.set(match[1].toLowerCase(), cleanFrontmatterValue(match[2]))
      })
      body = markdown.slice(endIndex + 4)
    } else {
      markdown
        .slice(3)
        .split(/\r?\n/)
        .forEach((line) => {
          const match = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/.exec(line)
          if (match) metadata.set(match[1].toLowerCase(), cleanFrontmatterValue(match[2]))
        })
      body = ''
    }
  }

  const bodyDescription =
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('---') && !line.startsWith('#')) ?? ''

  const name = metadata.get('name') || normalizedFallback
  const description =
    metadata.get('description') ||
    bodyDescription ||
    `Local skill discovered from ${fallbackName}/SKILL.md.`

  return {
    name,
    description: description.slice(0, 220),
  }
}

export function inferSkillCategory(name: string, description: string): SkillCategory {
  const text = `${name} ${description}`.toLowerCase()
  if (/(design|ui|ux|image|screenshot|browser|frontend|hero|figma|visual)/.test(text)) {
    return 'design'
  }
  if (/(doc|docs|document|write|copy|release|note|markdown|latex|presentation)/.test(text)) {
    return 'docs'
  }
  if (/(data|csv|sheet|spreadsheet|extract|analytics|query|search|citadel|km)/.test(text)) {
    return 'data'
  }
  if (/(git|pr|review|debug|test|build|deploy|refactor|code|android|ios|expo)/.test(text)) {
    return 'engineering'
  }
  return 'productivity'
}

export function inferSkillIcon(
  category: SkillCategory,
  name: string,
  description: string,
): SkillIcon {
  const text = `${name} ${description}`.toLowerCase()
  if (/(review|pr)/.test(text)) return 'review'
  if (/(debug|bug|fix|doctor)/.test(text)) return 'bug'
  if (/(search|query|find|explor)/.test(text)) return 'search'
  if (/(image|screenshot|visual|design|ui)/.test(text)) return 'image'
  if (/(data|csv|sheet|extract|analytics)/.test(text)) return 'data'
  if (/(spec|doc|markdown|latex|note|write)/.test(text)) return 'spec'
  return categoryStyles[category].icon
}

export function resolveSkillRoots(settings?: Pick<AppSettings, 'scanRoots'>): SkillRoot[] {
  const configuredRoots = Object.entries(settings?.scanRoots ?? {}).flatMap(([source, roots]) =>
    Array.isArray(roots)
      ? roots.map((root) => ({ source: source as AgentSource, root, primary: true }))
      : [],
  )

  const roots = [...configuredRoots, ...rootCandidates]
  const seen = new Set<string>()
  return roots.filter((candidate) => {
    const key = `${candidate.source}:${expandHome(candidate.root)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function formatSkillPathForDisplay(filePath: string): string {
  const home = expandHome('~')
  if (filePath === home) return '~'
  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~/${filePath
      .slice(home.length + 1)
      .split(path.sep)
      .join('/')}`
  }
  return filePath
}

async function safeSkillSize(skillRoot: string): Promise<number> {
  const files = await listFiles(skillRoot, ['**/*'], 200)
  let total = 0
  for (const filePath of files) {
    try {
      total += (await stat(filePath)).size
    } catch {
      continue
    }
  }
  return total
}

async function scanSkillFile(
  filePath: string,
  ownerAgent: AgentSource,
  primary: boolean,
): Promise<SkillDraft> {
  const markdown = await safeReadText(filePath, 160_000)
  const folderName = path.basename(path.dirname(filePath))
  const metadata = parseSkillMetadata(markdown, folderName)
  const info = await stat(filePath)
  const skillRoot = path.dirname(filePath)
  const sizeBytes = await safeSkillSize(skillRoot)
  const category = inferSkillCategory(metadata.name, metadata.description)
  const icon = inferSkillIcon(category, metadata.name, metadata.description)

  return {
    id: hashId([ownerAgent, filePath]),
    name: metadata.name,
    normalizedName: normalizeSkillName(metadata.name),
    primary,
    description: metadata.description,
    content: markdown,
    ownerAgent,
    category,
    updatedAt: info.mtime.toISOString(),
    sizeKb: Math.max(1, Math.round(sizeBytes / 1024)),
    status: 'local',
    linkedAgents: [ownerAgent],
    version: 'local',
    createdAt: info.birthtime.toISOString(),
    usageCount: 0,
    location: formatSkillPathForDisplay(skillRoot),
    accent: categoryStyles[category].accent,
    icon,
  }
}

function applyLinkedSkillStatus(skills: SkillDraft[]): ManagedSkill[] {
  const groups = new Map<string, SkillDraft[]>()
  skills.forEach((skill) => {
    const group = groups.get(skill.normalizedName) ?? []
    group.push(skill)
    groups.set(skill.normalizedName, group)
  })

  const managedSkills: ManagedSkill[] = []
  for (const group of groups.values()) {
    const representative =
      group.find((skill) => skill.primary) ??
      group.slice().sort((a, b) => a.name.localeCompare(b.name))[0]
    if (!representative?.primary) continue

    const linkedAgents = unique(group.map((item) => item.ownerAgent))
    const status: SkillStatus = linkedAgents.length > 1 ? 'synced' : representative.status
    managedSkills.push({
      id: representative.id,
      name: representative.name,
      description: representative.description,
      content: representative.content,
      ownerAgent: representative.ownerAgent,
      category: representative.category,
      updatedAt: representative.updatedAt,
      sizeKb: representative.sizeKb,
      status,
      linkedAgents,
      version: representative.version,
      createdAt: representative.createdAt,
      lastBackupAt: representative.lastBackupAt,
      usageCount: representative.usageCount,
      location: representative.location,
      accent: representative.accent,
      icon: representative.icon,
    })
  }

  return managedSkills.sort((a, b) => a.name.localeCompare(b.name))
}

export function summarizeSkills(skills: ManagedSkill[], now = Date.now()): SkillsSummary {
  const backedUpSkills = skills.filter((skill) => skill.status === 'backed-up')
  const linkedAgentSet = new Set<AgentSource>()
  const linkedSkills = skills.filter((skill) => {
    if (skill.linkedAgents.length <= 1) return false
    skill.linkedAgents.forEach((source) => linkedAgentSet.add(source))
    return true
  })
  const recentlyChanged = skills.filter((skill) => {
    const updated = new Date(skill.updatedAt).getTime()
    return !Number.isNaN(updated) && now - updated <= recentWindowMs
  }).length

  return {
    totalSkills: skills.length,
    weeklyDelta: recentlyChanged,
    linkedAgents: linkedSkills.length,
    linkedAgentTotal: linkedAgentSet.size,
    backups: backedUpSkills.length,
    backupPercent:
      skills.length === 0 ? 0 : Math.round((backedUpSkills.length / skills.length) * 100),
    recentlyChanged,
  }
}

export async function scanSkills(
  settings?: AppSettings,
  roots = resolveSkillRoots(settings),
): Promise<SkillsSnapshot> {
  const drafts: SkillDraft[] = []

  for (const candidate of roots) {
    const root = expandHome(candidate.root)
    const primary = candidate.primary ?? true
    if (!(await exists(root))) continue
    const files = await listFiles(root, [skillFilePattern], maxSkillFilesPerRoot)
    const scanned = await Promise.all(
      files.map(async (filePath) => {
        try {
          return await scanSkillFile(filePath, candidate.source, primary)
        } catch {
          return undefined
        }
      }),
    )
    drafts.push(...scanned.filter((skill): skill is SkillDraft => Boolean(skill)))
  }

  const skills = applyLinkedSkillStatus(drafts)
  return {
    generatedAt: new Date().toISOString(),
    skills,
    summary: summarizeSkills(skills),
  }
}
