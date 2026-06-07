import type { AgentSource } from '@/shared/types'
import type { TranslationKey } from '@/lib/i18n'

export type SkillStatus = 'synced' | 'local' | 'backed-up'

export type SkillCategory = 'engineering' | 'docs' | 'productivity' | 'design' | 'data'

export type ManagedSkill = {
  id: string
  name: string
  description: string
  ownerAgent: AgentSource
  category: SkillCategory
  updatedLabel: string
  updatedDetail: string
  sizeKb: number
  status: SkillStatus
  linkedAgents: AgentSource[]
  version: string
  createdAt: string
  lastBackupAt?: string
  usageCount: number
  location: string
  accent: 'violet' | 'orange' | 'green' | 'blue' | 'cyan' | 'pink' | 'amber'
  icon: 'code' | 'review' | 'bug' | 'notes' | 'search' | 'image' | 'data' | 'spec'
}

export type SkillsSummary = {
  totalSkills: number
  weeklyDelta: number
  linkedAgents: number
  linkedAgentTotal: number
  backups: number
  backupPercent: number
  recentlyChanged: number
}

export type SkillStatusFilter = 'all' | SkillStatus
export type SkillOwnerFilter = 'all' | AgentSource

export const skillsSummary: SkillsSummary = {
  totalSkills: 48,
  weeklyDelta: 6,
  linkedAgents: 12,
  linkedAgentTotal: 5,
  backups: 37,
  backupPercent: 87,
  recentlyChanged: 8,
}

export const managedSkills: ManagedSkill[] = [
  {
    id: 'commit-message-writer',
    name: 'Commit Message Writer',
    description: 'Generate clear, conventional commit messages based on staged changes.',
    ownerAgent: 'codex',
    category: 'engineering',
    updatedLabel: '2h ago',
    updatedDetail: '2 hours ago',
    sizeKb: 12,
    status: 'synced',
    linkedAgents: ['codex', 'claude', 'cursor', 'gemini'],
    version: '1.4.2',
    createdAt: 'May 8, 2025',
    lastBackupAt: 'May 15, 2025 09:41',
    usageCount: 128,
    location: '~/.cleanmyagent/skills/commit-message-writer',
    accent: 'violet',
    icon: 'code',
  },
  {
    id: 'pr-review',
    name: 'PR Review',
    description: 'Review pull requests and suggest improvements before merge.',
    ownerAgent: 'claude',
    category: 'engineering',
    updatedLabel: '4h ago',
    updatedDetail: '4 hours ago',
    sizeKb: 18,
    status: 'synced',
    linkedAgents: ['claude', 'codex', 'cursor'],
    version: '2.1.0',
    createdAt: 'Apr 20, 2025',
    lastBackupAt: 'May 14, 2025 18:20',
    usageCount: 96,
    location: '~/.cleanmyagent/skills/pr-review',
    accent: 'orange',
    icon: 'review',
  },
  {
    id: 'bug-triage',
    name: 'Bug Triage',
    description: 'Identify, classify, and prioritize bugs from issue context.',
    ownerAgent: 'claude',
    category: 'engineering',
    updatedLabel: '6h ago',
    updatedDetail: '6 hours ago',
    sizeKb: 14,
    status: 'synced',
    linkedAgents: ['claude', 'codex'],
    version: '1.8.5',
    createdAt: 'Mar 26, 2025',
    lastBackupAt: 'May 13, 2025 16:12',
    usageCount: 74,
    location: '~/.cleanmyagent/skills/bug-triage',
    accent: 'orange',
    icon: 'bug',
  },
  {
    id: 'release-notes',
    name: 'Release Notes',
    description: 'Generate changelogs and release notes from merged work.',
    ownerAgent: 'cursor',
    category: 'docs',
    updatedLabel: '1d ago',
    updatedDetail: '1 day ago',
    sizeKb: 16,
    status: 'synced',
    linkedAgents: ['cursor', 'codex', 'claude'],
    version: '1.6.1',
    createdAt: 'Feb 11, 2025',
    lastBackupAt: 'May 12, 2025 10:05',
    usageCount: 52,
    location: '~/.cleanmyagent/skills/release-notes',
    accent: 'green',
    icon: 'notes',
  },
  {
    id: 'code-search-helper',
    name: 'Code Search Helper',
    description: 'Semantic code search and exploration prompts for large repositories.',
    ownerAgent: 'codex',
    category: 'productivity',
    updatedLabel: '1d ago',
    updatedDetail: '1 day ago',
    sizeKb: 22,
    status: 'backed-up',
    linkedAgents: ['codex', 'gemini'],
    version: '0.9.8',
    createdAt: 'Jan 30, 2025',
    lastBackupAt: 'May 15, 2025 07:30',
    usageCount: 41,
    location: '~/.cleanmyagent/skills/code-search-helper',
    accent: 'blue',
    icon: 'search',
  },
  {
    id: 'ui-screenshot-analyzer',
    name: 'UI Screenshot Analyzer',
    description: 'Analyze UI screenshots and suggest visual fixes.',
    ownerAgent: 'claude',
    category: 'design',
    updatedLabel: '2d ago',
    updatedDetail: '2 days ago',
    sizeKb: 28,
    status: 'local',
    linkedAgents: ['claude'],
    version: '0.7.4',
    createdAt: 'Jan 8, 2025',
    usageCount: 33,
    location: '~/.cleanmyagent/skills/ui-screenshot-analyzer',
    accent: 'pink',
    icon: 'image',
  },
  {
    id: 'data-extractor',
    name: 'Data Extractor',
    description: 'Extract structured data from text, files, and transcripts.',
    ownerAgent: 'gemini',
    category: 'data',
    updatedLabel: '2d ago',
    updatedDetail: '2 days ago',
    sizeKb: 24,
    status: 'synced',
    linkedAgents: ['gemini', 'codex', 'claude'],
    version: '1.2.7',
    createdAt: 'Dec 18, 2024',
    lastBackupAt: 'May 10, 2025 12:44',
    usageCount: 58,
    location: '~/.cleanmyagent/skills/data-extractor',
    accent: 'cyan',
    icon: 'data',
  },
  {
    id: 'spec-draft-writer',
    name: 'Spec Draft Writer',
    description: 'Draft technical specifications from requirements and notes.',
    ownerAgent: 'cursor',
    category: 'docs',
    updatedLabel: '3d ago',
    updatedDetail: '3 days ago',
    sizeKb: 20,
    status: 'backed-up',
    linkedAgents: ['cursor', 'claude'],
    version: '1.1.3',
    createdAt: 'Nov 5, 2024',
    lastBackupAt: 'May 9, 2025 15:18',
    usageCount: 46,
    location: '~/.cleanmyagent/skills/spec-draft-writer',
    accent: 'amber',
    icon: 'spec',
  },
]

export function filterSkills(
  skills: ManagedSkill[],
  query: string,
  owner: SkillOwnerFilter,
  status: SkillStatusFilter,
): ManagedSkill[] {
  const normalizedQuery = query.trim().toLowerCase()

  return skills.filter((skill) => {
    const matchesOwner = owner === 'all' || skill.ownerAgent === owner
    const matchesStatus = status === 'all' || skill.status === status
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [skill.name, skill.description, skill.category, skill.ownerAgent]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)

    return matchesOwner && matchesStatus && matchesQuery
  })
}

export function summarizeVisibleSkills(skills: ManagedSkill[]) {
  const selectedDefaults = skills.filter((skill) =>
    ['commit-message-writer', 'pr-review', 'bug-triage'].includes(skill.id),
  )

  return {
    visibleCount: skills.length,
    selectedIds: selectedDefaults.map((skill) => skill.id),
    totalSizeKb: skills.reduce((total, skill) => total + skill.sizeKb, 0),
  }
}

export function statusLabelKey(status: SkillStatus) {
  return `skills.status.${status}` as TranslationKey
}

export function categoryLabelKey(category: SkillCategory) {
  return `skills.category.${category}` as TranslationKey
}
