import type { AgentSource, ManagedSkill, SkillCategory, SkillStatus } from '@/shared/types'
import type { TranslationKey } from '@/lib/i18n'

export type { ManagedSkill, SkillCategory, SkillStatus }

export type SkillStatusFilter = 'all' | SkillStatus
export type SkillOwnerFilter = 'all' | AgentSource

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
  return {
    visibleCount: skills.length,
    totalSizeKb: skills.reduce((total, skill) => total + skill.sizeKb, 0),
  }
}

export function statusLabelKey(status: SkillStatus) {
  return `skills.status.${status}` as TranslationKey
}

export function categoryLabelKey(category: SkillCategory) {
  return `skills.category.${category}` as TranslationKey
}
