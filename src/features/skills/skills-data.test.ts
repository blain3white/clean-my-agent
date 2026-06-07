import { describe, expect, it } from 'vitest'
import {
  categoryLabelKey,
  filterSkills,
  managedSkills,
  skillsSummary,
  statusLabelKey,
  summarizeVisibleSkills,
} from './skills-data'

describe('skills data model', () => {
  it('matches the dashboard summary shown in the skills panel', () => {
    expect(skillsSummary).toEqual({
      totalSkills: 48,
      weeklyDelta: 6,
      linkedAgents: 12,
      linkedAgentTotal: 5,
      backups: 37,
      backupPercent: 87,
      recentlyChanged: 8,
    })
  })

  it('filters skills by query, owner agent, and sync status', () => {
    expect(filterSkills(managedSkills, 'review', 'all', 'all').map((skill) => skill.id)).toEqual([
      'pr-review',
    ])
    expect(filterSkills(managedSkills, '', 'claude', 'synced').map((skill) => skill.id)).toEqual([
      'pr-review',
      'bug-triage',
    ])
    expect(
      filterSkills(managedSkills, 'docs', 'cursor', 'backed-up').map((skill) => skill.id),
    ).toEqual(['spec-draft-writer'])
  })

  it('returns default selected rows and aggregate size for the visible table', () => {
    const summary = summarizeVisibleSkills(managedSkills)

    expect(summary.visibleCount).toBe(8)
    expect(summary.selectedIds).toEqual(['commit-message-writer', 'pr-review', 'bug-triage'])
    expect(summary.totalSizeKb).toBe(154)
  })

  it('builds stable i18n keys for status and category labels', () => {
    expect(statusLabelKey('synced')).toBe('skills.status.synced')
    expect(statusLabelKey('local')).toBe('skills.status.local')
    expect(statusLabelKey('backed-up')).toBe('skills.status.backed-up')
    expect(categoryLabelKey('engineering')).toBe('skills.category.engineering')
    expect(categoryLabelKey('docs')).toBe('skills.category.docs')
  })
})
