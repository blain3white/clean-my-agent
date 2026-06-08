import { describe, expect, it } from 'vitest'
import type { ManagedSkill } from '@/shared/types'
import {
  categoryLabelKey,
  filterSkills,
  statusLabelKey,
  summarizeVisibleSkills,
} from './skills-data'

const skill = (overrides: Partial<ManagedSkill> = {}): ManagedSkill => ({
  id: 'codex-review',
  name: 'PR Review',
  description: 'Review pull requests before merge.',
  ownerAgent: 'codex',
  category: 'engineering',
  updatedAt: '2026-06-01T12:00:00.000Z',
  sizeKb: 12,
  status: 'synced',
  linkedAgents: ['codex', 'claude'],
  version: 'local',
  createdAt: '2026-05-01T12:00:00.000Z',
  usageCount: 0,
  location: '~/.codex/skills/pr-review',
  accent: 'violet',
  icon: 'review',
  ...overrides,
})

const skills: ManagedSkill[] = [
  skill(),
  skill({
    id: 'claude-docs',
    name: 'Docs Writer',
    description: 'Write project markdown documents.',
    ownerAgent: 'claude',
    category: 'docs',
    status: 'local',
    linkedAgents: ['claude'],
    sizeKb: 20,
  }),
  skill({
    id: 'cursor-data',
    name: 'Data Extractor',
    description: 'Extract CSV and spreadsheet data.',
    ownerAgent: 'cursor',
    category: 'data',
    status: 'backed-up',
    linkedAgents: ['cursor'],
    sizeKb: 30,
  }),
  skill({
    id: 'gemini-ui',
    name: 'UI Screenshot Analyzer',
    description: 'Analyze interface screenshots.',
    ownerAgent: 'gemini',
    category: 'design',
    status: 'local',
    linkedAgents: ['gemini'],
    sizeKb: 40,
  }),
]

describe('skills data model', () => {
  it('filters skills by query, owner agent, and sync status', () => {
    expect(filterSkills(skills, 'review', 'all', 'all').map((item) => item.id)).toEqual([
      'codex-review',
    ])
    expect(filterSkills(skills, '', 'claude', 'local').map((item) => item.id)).toEqual([
      'claude-docs',
    ])
    expect(filterSkills(skills, 'data', 'cursor', 'backed-up').map((item) => item.id)).toEqual([
      'cursor-data',
    ])
  })

  it('returns selected rows and aggregate size for the visible table', () => {
    const summary = summarizeVisibleSkills(skills)

    expect(summary.visibleCount).toBe(4)
    expect(summary.selectedIds).toEqual(['codex-review', 'claude-docs', 'cursor-data'])
    expect(summary.totalSizeKb).toBe(102)
  })

  it('builds stable i18n keys for status and category labels', () => {
    expect(statusLabelKey('synced')).toBe('skills.status.synced')
    expect(statusLabelKey('local')).toBe('skills.status.local')
    expect(statusLabelKey('backed-up')).toBe('skills.status.backed-up')
    expect(categoryLabelKey('engineering')).toBe('skills.category.engineering')
    expect(categoryLabelKey('docs')).toBe('skills.category.docs')
  })
})
