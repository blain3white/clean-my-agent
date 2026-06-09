import { describe, expect, it } from 'vitest'
import type { ManagedSkill } from '@/shared/types'
import {
  categoryLabelKey,
  filterSkills,
  getSkillsEmptyStateKind,
  shouldShowSkillsPagination,
  skillsEmptyStateBodyKey,
  skillsEmptyStateTitleKey,
  statusLabelKey,
  summarizeVisibleSkills,
} from './skills-data'
import { mockSkillsSnapshot } from '@/lib/mock-data'

const skill = (overrides: Partial<ManagedSkill> = {}): ManagedSkill => ({
  id: 'codex-review',
  name: 'PR Review',
  description: 'Review pull requests before merge.',
  content: '# PR Review\n\nReview pull requests before merge.',
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

  it('returns aggregate data for the visible table', () => {
    const summary = summarizeVisibleSkills(skills)

    expect(summary.visibleCount).toBe(4)
    expect(summary.totalSizeKb).toBe(102)
  })

  it('provides demo skills for renderer-only fallback', () => {
    expect(mockSkillsSnapshot.skills.length).toBeGreaterThan(0)
    expect(mockSkillsSnapshot.summary.totalSkills).toBe(mockSkillsSnapshot.skills.length)
    expect(mockSkillsSnapshot.skills.some((item) => item.content.includes('SKILL.md'))).toBe(true)
    expect(mockSkillsSnapshot.skills.some((item) => item.location.length > 80)).toBe(true)
  })

  it('separates scan errors, empty roots, and no-match states', () => {
    expect(getSkillsEmptyStateKind(true, 0, 0)).toBe('scan-error')
    expect(skillsEmptyStateTitleKey('scan-error')).toBe('skills.scanErrorTitle')
    expect(skillsEmptyStateBodyKey('scan-error')).toBe('skills.scanErrorBody')

    expect(getSkillsEmptyStateKind(false, 0, 0)).toBe('empty')
    expect(skillsEmptyStateTitleKey('empty')).toBe('skills.emptyTitle')
    expect(skillsEmptyStateBodyKey('empty')).toBe('skills.emptyBody')

    expect(getSkillsEmptyStateKind(false, 4, 0)).toBe('no-matches')
    expect(skillsEmptyStateTitleKey('no-matches')).toBe('skills.noMatchesTitle')
    expect(skillsEmptyStateBodyKey('no-matches')).toBe('skills.noMatchesBody')
    expect(getSkillsEmptyStateKind(false, 4, 2)).toBeUndefined()
  })

  it('hides pagination for empty, error, and no-match results', () => {
    expect(shouldShowSkillsPagination(0, 0)).toBe(false)
    expect(shouldShowSkillsPagination(4, 0)).toBe(false)
    expect(shouldShowSkillsPagination(4, 2)).toBe(true)
  })

  it('builds stable i18n keys for status and category labels', () => {
    expect(statusLabelKey('synced')).toBe('skills.status.synced')
    expect(statusLabelKey('local')).toBe('skills.status.local')
    expect(statusLabelKey('backed-up')).toBe('skills.status.backed-up')
    expect(categoryLabelKey('engineering')).toBe('skills.category.engineering')
    expect(categoryLabelKey('docs')).toBe('skills.category.docs')
  })
})
